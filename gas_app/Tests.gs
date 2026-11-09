/**
 * 物品購入届CSV出力アプリ - テストと開発用サンプルデータ (Tests.gs)
 * 版: v1.0 2026/10/31
 *
 * ※ 開発環境のスクリプトにだけ貼る。本番には貼らない（K-46）。
 *    Code.gs はこのファイルの関数を呼ばないので、無くても動く。
 *
 *  - runAllTests()   : すべてのテストを実行し、結果をログに出す（メニュー「開発: テストを実行」）
 *  - seedDevData()   : 開発用のサンプルデータを投入する（メニュー「開発: サンプルデータ投入」。K-48）
 *
 * テストIDは plan/08_テスト計画.md と対応する。
 */

// ---------------------------------------------------------------------
// 開発用サンプルデータの設定（必要に応じて書き換える）
// ---------------------------------------------------------------------

/** 管理者・経理にする社員ID（メールアドレス）。空ならコーポレート部門の社員から自動で選ぶ */
const SEED_ADMIN_IDS = [];
const SEED_ACCOUNTING_IDS = [];
/** 開発用の暗証番号（承認者・管理者・経理の全員に設定する） */
const SEED_PIN = '123456';
/** 各ステータスのサンプル届出を作るか */
const SEED_REQUESTS = true;
/** 有効にする種別（U-02 の仮の値。名称の部分一致） */
const SEED_CATEGORY_NAMES = ['事務用品', 'その他消耗品', '部品', '修繕', '消耗品', '備品'];
/** マスタの件数の期待値（TC-MI。マスタを更新したら書き換える） */
const EXPECTED_MASTER_COUNTS = { MATERIALS: 4823, SUPPLIERS: 885, EMPLOYEES: 83, DEPARTMENTS: 21, CATEGORIES: 73 };

// ---------------------------------------------------------------------
// テストの枠組み
// ---------------------------------------------------------------------

function assertEq_(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + '期待値 ' + e + ' / 実際 ' + a);
}
function assertTrue_(cond, msg) { if (!cond) throw new Error(msg || '条件が成り立ちません'); }
function assertThrows_(fn, code, msg) {
  try { fn(); } catch (e) {
    if (code && e.code !== code) throw new Error((msg ? msg + ': ' : '') + 'エラーコード ' + code + ' を期待しましたが ' + (e.code || e.message) + ' でした');
    return e;
  }
  throw new Error((msg ? msg + ': ' : '') + 'エラーになりませんでした（期待: ' + code + '）');
}

/** テストの一覧 [ID, 名前, 関数, 種類]。種類: pure=GASのサービスを使わない / gas=シートを使う */
function testList_() {
  return [
    ['TC-CSV-09', '月末の補完（通常の月）', test_endOfMonthBasic, 'pure'],
    ['TC-CSV-10', '月末の補完（閏年と平年の2月）', test_endOfMonthLeap, 'pure'],
    ['TC-CSV-11', '月末の補完（月末当日）', test_endOfMonthLastDay, 'pure'],
    ['TC-CSV-08', '納品日ありの納期', test_dueDateWithDelivery, 'pure'],
    ['TC-CSV-01', '初期設定の列順と見出し', test_csvDefaultColumns, 'pure'],
    ['TC-CSV-03', '改行は CRLF で最終行にも付く', test_csvLineEnding, 'pure'],
    ['TC-CSV-04', 'コードの先頭の0が残る', test_csvLeadingZeros, 'pure'],
    ['TC-CSV-05', '手入力・指定なしは発注先コードが空', test_csvBlankSupplier, 'pure'],
    ['TC-CSV-07', '資材が未確定なら資材コード・入数が空', test_csvUnfixedMaterial, 'pure'],
    ['TC-CSV-12', 'MINIMAL の囲みとエスケープ', test_csvEscape, 'pure'],
    ['TC-CSV-13', '列順の変更と見出しなし', test_csvSettingsChange, 'pure'],
    ['TC-CSV-CFG', '列キーの設定エラー', test_csvConfigError, 'pure'],
    ['TC-IN-01', '一時保存は空でも通る', test_validateDraftEmpty, 'pure'],
    ['TC-IN-02', '入力完了は必須チェックが働く', test_validateFullEmpty, 'pure'],
    ['TC-IN-03', '購入物品名は100文字まで', test_validateItemName, 'pure'],
    ['TC-IN-04', '理由は500文字まで（絵文字は1文字）', test_validateReasonSurrogate, 'pure'],
    ['TC-IN-05', '数量の不正値', test_quantityInvalid, 'pure'],
    ['TC-IN-06', '数量の全角は半角になる', test_quantityFullWidth, 'pure'],
    ['TC-IN-07', '数量の先頭の0を除く', test_quantityLeadingZero, 'pure'],
    ['TC-IN-08', '存在しない日付はエラー', test_invalidDate, 'pure'],
    ['TC-IN-09', 'マスタに無い発注先コード', test_validateUnknownSupplier, 'pure'],
    ['TC-IN-10', '手入力の名称が空（入力完了）', test_validateManualEmpty, 'pure'],
    ['TC-IN-11', '指定なしはコードと名称が空', test_validateNone, 'pure'],
    ['TC-IN-12', '単位・補足は20文字まで', test_validateUnitNote, 'pure'],
    ['TC-IN-14', '承認者の候補が0人なら承認依頼できない', test_validateNoApprover, 'pure'],
    ['TC-IN-15', '入力項目シートの設定で必須が変わる', test_requiredFieldsSwitch, 'pure'],
    ['TC-IN-16', '発注先を任意にすると区分が空でも通る', test_requiredPartyOptional, 'pure'],
    ['TC-IN-17', '添付を必須にする', test_requiredAttachment, 'pure'],
    ['TC-MT-01', '購入物品名の完全一致は順位1', test_rank1, 'pure'],
    ['TC-MT-02', '種別・発注先コード・部門の一致は順位2', test_rank2, 'pure'],
    ['TC-MT-04', '資材名の「：」より後ろの略称で発注先が一致', test_rankAbbr, 'pure'],
    ['TC-MT-05', '共通部署コードは順位3（空なら飛ばす）', test_rank3, 'pure'],
    ['TC-MT-06', '部門が違えば順位4', test_rank4, 'pure'],
    ['TC-MT-07', '無効な資材は出ない', test_rankInvalid, 'pure'],
    ['TC-MT-08', '手入力・指定なしの発注先条件', test_rankManualNone, 'pure'],
    ['TC-PM-01', '権限表の全セル', test_permissionMatrix, 'pure'],
    ['TC-PM-02', '自分の届出は自分で承認できない', test_selfApproval, 'pure'],
    ['TC-ST-00', '遷移表（nextStatus）', test_transitions, 'pure'],
    ['TC-DL-03', '同じ日の連番', test_requestIdSequence, 'pure'],
    ['TC-DL-04', '1000件目以降は4桁', test_requestId1000, 'pure'],
    ['TC-CFG-01', '設定の型変換', test_parseSettings, 'pure'],
    ['TC-CFG-02', '入力項目シートの読み取り', test_parseRequiredFields, 'pure'],
    ['TC-AU-09', '指定する暗証番号の形式チェック', test_validatePin, 'pure'],
    ['TC-MI-01', 'マスタの件数（資材・発注先・社員・部署・種別）', test_gas_masterCounts, 'gas'],
    ['TC-MI-02', '資材コードの先頭の0', test_gas_materialLeadingZeros, 'gas'],
    ['TC-AU-01', '暗証番号の発行・認証・誤り・ロック', test_gas_pinFlow, 'gas'],
    ['TC-AU-10', '管理者が番号を指定して設定する', test_gas_adminSpecifyPin, 'gas'],
    ['TC-FLOW', '入力→承認依頼→承認→資材確定→CSV→反映済→承認済に戻す', test_gas_workflow, 'gas'],
    ['TC-DL-05', '古いバージョンでの更新は CONFLICT', test_gas_conflict, 'gas'],
    ['TC-IN-18', '入力項目シートを変えると保存時の必須と画面のバッジが変わる', test_gas_requiredFieldsSheet, 'gas'],
    ['TC-NT-01', '通知が無効なら送らない', test_gas_notifyDisabled, 'gas']
  ];
}

/** すべてのテストを実行する。options.pureOnly=true なら pure だけ */
function runAllTests(options) {
  options = options || {};
  const results = [];
  testList_().forEach(function (t) {
    if (options.pureOnly && t[3] !== 'pure') return;
    if (options.only && options.only.indexOf(t[0]) < 0) return;
    resetExecutionCache_();
    try {
      const note = t[2]();
      results.push({ id: t[0], name: t[1], ok: true, note: note || '' });
    } catch (e) {
      if (e && e.skip) results.push({ id: t[0], name: t[1], ok: true, skipped: true, note: e.message });
      else results.push({ id: t[0], name: t[1], ok: false, note: e && e.message ? e.message : String(e) });
    }
  });
  const failed = results.filter(function (r) { return !r.ok; });
  results.forEach(function (r) {
    console.log((r.ok ? (r.skipped ? 'SKIP' : ' OK ') : ' NG ') + ' ' + r.id + ' ' + r.name + (r.note ? ' — ' + r.note : ''));
  });
  console.log('合計 ' + results.length + ' 件 / NG ' + failed.length + ' 件');
  return { total: results.length, failed: failed.length, results: results };
}

function menuRunAllTests() {
  const r = runAllTests();
  const ng = r.results.filter(function (x) { return !x.ok; });
  alert_('テスト結果: ' + r.total + '件中 NG ' + r.failed + '件' + (ng.length ? '\n\n' + ng.slice(0, 15).map(function (x) { return x.id + ' ' + x.note; }).join('\n') : '') +
    '\n\n詳細は「実行数」または「ログ」を確認してください。');
}

function skip_(msg) { const e = new Error(msg); e.skip = true; return e; }

// ---------------------------------------------------------------------
// テスト用の固定データ（pure テスト用）
// ---------------------------------------------------------------------

function testSettings_(over) {
  const s = parseSettings_({});
  Object.keys(over || {}).forEach(function (k) { s[k] = over[k]; });
  return s;
}

function testMasters_() {
  return {
    departments: [
      { deptCode: '23', deptName: '生産課', division: '生産管理部', commonDeptCode: '94', sortOrder: 10, enabled: true },
      { deptCode: '30', deptName: '品質保証課', division: '品質保証部', commonDeptCode: '', sortOrder: 20, enabled: true },
      { deptCode: '94', deptName: '生産管理部共通', division: '生産管理部', commonDeptCode: '', sortOrder: 30, enabled: true },
      { deptCode: '99', deptName: '本部共通', division: '', commonDeptCode: '', sortOrder: 40, enabled: false }
    ],
    categories: [
      { categoryCode: '42', categoryName: '事務用品', sortOrder: 10, enabled: true },
      { categoryCode: '49', categoryName: 'その他消耗品', sortOrder: 20, enabled: true }
    ],
    employees: [
      { employeeId: 'u1@example.com', name: '入力 一郎', mail: 'u1@example.com', division: '生産管理部', section: '生産課', defaultDeptCode: '23', jobTitle: '', enabled: true },
      { employeeId: 'u2@example.com', name: '承認 二郎', mail: 'u2@example.com', division: '生産管理部', section: '生産課', defaultDeptCode: '23', jobTitle: '課長', enabled: true },
      { employeeId: 'u3@example.com', name: '承認 三郎', mail: 'u3@example.com', division: '生産管理部', section: '生産課', defaultDeptCode: '23', jobTitle: '課長代理', enabled: true },
      { employeeId: 'u4@example.com', name: '管理 四郎', mail: 'u4@example.com', division: 'コーポレート部門', section: '総務課', defaultDeptCode: '', jobTitle: '', enabled: true },
      { employeeId: 'u5@example.com', name: '経理 五郎', mail: 'u5@example.com', division: 'コーポレート部門', section: '経理課', defaultDeptCode: '', jobTitle: '', enabled: true },
      { employeeId: 'u6@example.com', name: '兼務 六子', mail: 'u6@example.com', division: '品質保証部', section: '品質保証課', defaultDeptCode: '30', jobTitle: '課長', enabled: true }
    ],
    approvers: [
      { deptCode: '23', approverId: 'u2@example.com', approverName: '', priority: 1, enabled: true },
      { deptCode: '23', approverId: 'u3@example.com', approverName: '', priority: 2, enabled: true },
      { deptCode: '30', approverId: 'u6@example.com', approverName: '', priority: 1, enabled: true }
    ],
    roles: [
      { employeeId: 'u4@example.com', name: '', role: '管理者', enabled: true },
      { employeeId: 'u5@example.com', name: '', role: '経理', enabled: true }
    ],
    suppliers: [
      { code: '000315', branch: '', name: '株式会社ダイナパック', kana: 'ダイナパック', abbr: 'ダイナパック', account2: '買掛金', visible: true },
      { code: '000501', branch: '', name: '株式会社西本商店', kana: 'ニシモトショウテン', abbr: '西本商店', account2: '未払金', visible: true }
    ],
    deliveries: [{ code: '000244', branch: '', name: 'サカイキャニング かつらぎ工場', sortOrder: 10, enabled: true }]
  };
}

function testMaterials_() {
  return [
    { code: '000000000000001', branch: '', subBranch: '', name: 'コピー用紙A4', nameInCompany: '', type: '42', packQty: '5', makerCode: '', stockCode: '', deptCode: '30', invalid: '0' },
    { code: '000000000001591', branch: '', subBranch: '', name: '消耗品（事務用品）：西本商店（生産管理部共通）', nameInCompany: '', type: '42', packQty: '1', makerCode: '', stockCode: '', deptCode: '94', invalid: '0' },
    { code: '000000000001600', branch: '', subBranch: '', name: '消耗品（事務用品）：ダイナパック（生産課）', nameInCompany: '', type: '42', packQty: '1', makerCode: '000315', stockCode: '', deptCode: '23', invalid: '0' },
    { code: '000000000001700', branch: '', subBranch: '', name: '消耗品（事務用品）：ダイナパック（品質保証課）', nameInCompany: '', type: '42', packQty: '1', makerCode: '000315', stockCode: '', deptCode: '30', invalid: '0' },
    { code: '000000000001800', branch: '', subBranch: '', name: '消耗品（事務用品）：ダイナパック（無効）', nameInCompany: '', type: '42', packQty: '1', makerCode: '000315', stockCode: '', deptCode: '23', invalid: '1' },
    { code: '000000000001900', branch: '', subBranch: '', name: 'その他消耗品：山田商会（生産課）', nameInCompany: '', type: '49', packQty: '1', makerCode: '', stockCode: '', deptCode: '23', invalid: '0' }
  ];
}

function testRequest_(over) {
  const r = {
    requestId: 'PR-20261031-001', status: STATUS.APPROVED, deptCode: '23', categoryCode: '42', applicantId: 'u1@example.com', approverId: 'u2@example.com',
    supplierType: 'マスタ', supplierCode: '000315', supplierBranch: '', supplierName: '株式会社ダイナパック',
    deliveryType: 'マスタ', deliveryCode: '000244', deliveryBranch: '', deliveryName: 'サカイキャニング かつらぎ工場',
    itemName: 'ボールペン', modelNo: '', quantity: '10', unitNote: '本', reason: 'テスト', deliveryDate: '',
    materialCode: '000000000001591', materialBranch: '', materialSubBranch: '', materialName: 'x', packQty: '1', materialFixed: true,
    submittedDate: '2026/10/15', approvedAt: '2026/10/16 10:00:00'
  };
  Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
  return r;
}

function validPayload_(over) {
  const p = {
    deptCode: '23', categoryCode: '42', approverId: 'u2@example.com',
    supplierType: 'マスタ', supplierCode: '000315', supplierBranch: '', supplierName: '',
    deliveryType: 'マスタ', deliveryCode: '000244', deliveryBranch: '', deliveryName: '',
    itemName: 'ボールペン', modelNo: 'AB-1', quantity: '10', unitNote: '本', reason: '在庫切れのため', deliveryDate: '2026/11/15'
  };
  Object.keys(over || {}).forEach(function (k) { p[k] = over[k]; });
  return p;
}

// ---------------------------------------------------------------------
// pure テスト: CSV
// ---------------------------------------------------------------------

function test_endOfMonthBasic() {
  assertEq_(endOfMonth('2026/10/15'), '2026/10/31');
  assertEq_(calcDueDate(testRequest_({ deliveryDate: '', submittedDate: '2026/10/15' }), 'yyyyMMdd'), '20261031');
  assertEq_(endOfMonth('2026/04/01'), '2026/04/30');
}
function test_endOfMonthLeap() {
  assertEq_(calcDueDate(testRequest_({ deliveryDate: '', submittedDate: '2028/02/10' }), 'yyyyMMdd'), '20280229');
  assertEq_(calcDueDate(testRequest_({ deliveryDate: '', submittedDate: '2027/02/10' }), 'yyyyMMdd'), '20270228');
  assertEq_(endOfMonth('2100/02/01'), '2100/02/28');
}
function test_endOfMonthLastDay() {
  assertEq_(calcDueDate(testRequest_({ deliveryDate: '', submittedDate: '2026/04/30' }), 'yyyyMMdd'), '20260430');
  assertEq_(calcDueDate(testRequest_({ deliveryDate: '', submittedDate: '2026/12/31' }), 'yyyyMMdd'), '20261231');
}
function test_dueDateWithDelivery() {
  assertEq_(calcDueDate(testRequest_({ deliveryDate: '2026/11/05' }), 'yyyyMMdd'), '20261105');
  assertEq_(calcDueDate(testRequest_({ deliveryDate: '2026/11/05' }), 'yyyy/MM/dd'), '2026/11/05');
}
function test_csvDefaultColumns() {
  const text = buildCsvText([testRequest_()], testSettings_());
  const lines = text.split('\r\n');
  assertEq_(lines[0], '発注先コード,納入先コード,資材コード,入数,数量,納期');
  assertEq_(lines[1], '000315,000244,000000000001591,1,10,20261031');
}
function test_csvLineEnding() {
  const text = buildCsvText([testRequest_(), testRequest_({ requestId: 'PR-20261031-002' })], testSettings_());
  assertTrue_(/\r\n$/.test(text), '最終行に CRLF がありません');
  assertEq_(text.split('\r\n').length, 4, '見出し＋2行＋末尾');
  assertTrue_(text.replace(/\r\n/g, '').indexOf('\n') < 0, 'LF だけの改行が混ざっています');
}
function test_csvLeadingZeros() {
  const line = buildCsvText([testRequest_()], testSettings_({ CSV_HEADER: false }));
  assertTrue_(line.indexOf('000315,') === 0, '発注先コードの先頭の0');
  assertTrue_(line.indexOf('000000000001591') > 0, '資材コードの先頭の0');
}
function test_csvBlankSupplier() {
  const s = testSettings_({ CSV_HEADER: false });
  assertEq_(buildCsvText([testRequest_({ supplierType: '手入力', supplierCode: '', supplierName: '山田商会' })], s).split(',')[0], '');
  assertEq_(buildCsvText([testRequest_({ supplierType: '指定なし', supplierCode: '', deliveryCode: '' })], s).split(',').slice(0, 2), ['', '']);
}
function test_csvUnfixedMaterial() {
  const line = buildCsvText([testRequest_({ materialFixed: false })], testSettings_({ CSV_HEADER: false })).replace(/\r\n$/, '');
  assertEq_(line, '000315,000244,,,10,20261031');
  const none = buildCsvText([testRequest_({ materialFixed: true, materialCode: '', packQty: '' })], testSettings_({ CSV_HEADER: false })).replace(/\r\n$/, '');
  assertEq_(none, '000315,000244,,,10,20261031', '資材なしで確定');
}
function test_csvEscape() {
  const s = testSettings_();
  assertEq_(escapeCsvValue('a,b', s), '"a,b"');
  assertEq_(escapeCsvValue('say "hi"', s), '"say ""hi"""');
  assertEq_(escapeCsvValue('line1\nline2', s), '"line1\nline2"');
  assertEq_(escapeCsvValue('plain', s), 'plain');
  assertEq_(escapeCsvValue('plain', testSettings_({ CSV_QUOTE_MODE: 'ALL' })), '"plain"');
  const text = buildCsvText([testRequest_({ itemName: 'A4,"高級"' })], testSettings_({ CSV_COLUMNS: 'REQUEST_ID,ITEM_NAME', CSV_HEADER_NAMES: '届出ID,品名' }));
  assertEq_(text.split('\r\n')[1], 'PR-20261031-001,"A4,""高級"""');
}
function test_csvSettingsChange() {
  const s = testSettings_({ CSV_COLUMNS: 'DUE_DATE,QUANTITY,SUPPLIER_CODE,SUPPLIER_BRANCH', CSV_HEADER: false, CSV_DATE_FORMAT: 'yyyy/MM/dd', CSV_LINE_ENDING: 'LF' });
  assertEq_(buildCsvText([testRequest_({ supplierBranch: '01' })], s), '2026/10/31,10,000315,01\n');
}
function test_csvConfigError() {
  assertThrows_(function () { buildCsvText([testRequest_()], testSettings_({ CSV_COLUMNS: 'SUPPLIER_CODE,UNKNOWN' })); }, 'SYSTEM');
  assertThrows_(function () { buildCsvText([testRequest_()], testSettings_({ CSV_COLUMNS: 'SUPPLIER_CODE', CSV_HEADER_NAMES: 'a,b' })); }, 'SYSTEM');
}

// ---------------------------------------------------------------------
// pure テスト: 入力チェック
// ---------------------------------------------------------------------

/** 入力チェック（必須の設定は、省略すると初期値。シートの値に左右されないようにする） */
function vr_(payload, level, masters, applicantId, required) {
  return validateRequest(payload, level, masters, applicantId, required || parseRequiredFields_([]));
}
/** 初期値から一部の項目だけ必須・任意を変えた設定 */
function requiredWith_(over) {
  const r = parseRequiredFields_([]);
  Object.keys(over).forEach(function (k) { r[k] = over[k]; });
  return r;
}

function test_validateDraftEmpty() {
  const v = vr_({}, 'FORMAT', testMasters_(), 'u1@example.com');
  assertEq_(Object.keys(v.errors), []);
}
function test_validateFullEmpty() {
  const v = vr_({}, 'FULL', testMasters_(), 'u1@example.com');
  ['deptCode', 'categoryCode', 'approverId', 'supplierType', 'deliveryType', 'itemName', 'quantity', 'reason'].forEach(function (k) {
    assertTrue_(!!v.errors[k], k + ' のエラーがありません');
  });
  const ok = vr_(validPayload_(), 'FULL', testMasters_(), 'u1@example.com');
  assertEq_(ok.errors, {}, '正しい入力');
  assertEq_(ok.value.supplierName, '株式会社ダイナパック', 'マスタの名称が入る');
}
function test_validateItemName() {
  const long = new Array(102).join('あ'); // 101文字
  assertTrue_(!!vr_(validPayload_({ itemName: long }), 'FORMAT', testMasters_(), 'u1@example.com').errors.itemName);
  assertTrue_(!vr_(validPayload_({ itemName: long.substr(1) }), 'FORMAT', testMasters_(), 'u1@example.com').errors.itemName, '100文字は通る');
  assertTrue_(!!vr_(validPayload_({ modelNo: long }), 'FORMAT', testMasters_(), 'u1@example.com').errors.modelNo, 'TC-IN-13 型番');
}
function test_validateReasonSurrogate() {
  const emoji500 = new Array(501).join('😀'); // 500文字（UTF-16では1000）
  assertTrue_(!vr_(validPayload_({ reason: emoji500 }), 'FULL', testMasters_(), 'u1@example.com').errors.reason, '絵文字500文字は通る');
  assertTrue_(!!vr_(validPayload_({ reason: emoji500 + 'あ' }), 'FULL', testMasters_(), 'u1@example.com').errors.reason, '501文字はエラー');
}
function test_quantityInvalid() {
  ['0', '-1', 'abc', '1.2345', '0.000'].forEach(function (q) {
    assertTrue_(!normalizeQuantity(q, 3).ok, q + ' がエラーになりません');
  });
  assertTrue_(normalizeQuantity('1.234', 3).ok, '小数第3位まで');
}
function test_quantityFullWidth() { assertEq_(normalizeQuantity('１．５', 3).value, '1.5'); }
function test_quantityLeadingZero() {
  assertEq_(normalizeQuantity('007', 3).value, '7');
  assertEq_(normalizeQuantity('0.5', 3).value, '0.5');
}
function test_invalidDate() {
  assertEq_(isValidDate('2026/02/30'), null);
  assertEq_(isValidDate('2028-02-29'), '2028/02/29');
  assertEq_(isValidDate('2026/13/01'), null);
  assertTrue_(!!vr_(validPayload_({ deliveryDate: '2026/02/30' }), 'FORMAT', testMasters_(), 'u1@example.com').errors.deliveryDate);
}
function test_validateUnknownSupplier() {
  assertTrue_(!!vr_(validPayload_({ supplierCode: '999999' }), 'FORMAT', testMasters_(), 'u1@example.com').errors.supplierCode);
}
function test_validateManualEmpty() {
  const v = vr_(validPayload_({ supplierType: '手入力', supplierCode: '', supplierName: '' }), 'FULL', testMasters_(), 'u1@example.com');
  assertTrue_(!!v.errors.supplierName);
  const ok = vr_(validPayload_({ supplierType: '手入力', supplierCode: '000315', supplierName: '山田商会' }), 'FULL', testMasters_(), 'u1@example.com');
  assertEq_([ok.value.supplierCode, ok.value.supplierName], ['', '山田商会'], '手入力はコードを持たない');
}
function test_validateNone() {
  const v = vr_(validPayload_({ supplierType: '指定なし', supplierCode: '000315', supplierName: 'x' }), 'FULL', testMasters_(), 'u1@example.com');
  assertEq_([v.value.supplierCode, v.value.supplierName, Object.keys(v.errors).length], ['', '', 0]);
}
function test_validateUnitNote() {
  assertTrue_(!!vr_(validPayload_({ unitNote: new Array(22).join('a') }), 'FORMAT', testMasters_(), 'u1@example.com').errors.unitNote);
}
function test_validateNoApprover() {
  const m = testMasters_();
  // 品質保証課の承認者は u6 だけ。u6 が入力者なら候補は0人
  const v = vr_(validPayload_({ deptCode: '30', approverId: '' }), 'FULL', m, 'u6@example.com');
  assertTrue_(/登録されていません/.test(v.errors.approverId || ''), v.errors.approverId);
  const self = vr_(validPayload_({ deptCode: '30', approverId: 'u6@example.com' }), 'FULL', m, 'u6@example.com');
  assertTrue_(!!self.errors.approverId, '自分を承認者にできない');
  assertEq_(getApproverCandidates_(m, '23', 'u1@example.com').map(function (c) { return c.employeeId; }), ['u2@example.com', 'u3@example.com'], '優先順');
}

function test_requiredFieldsSwitch() {
  const m = testMasters_();
  const r = requiredWith_({ modelNo: true, quantity: false, reason: false });
  const v = vr_(validPayload_({ modelNo: '', quantity: '', reason: '' }), 'FULL', m, 'u1@example.com', r);
  assertTrue_(!!v.errors.modelNo, '型番を必須にしたのにエラーになりません');
  assertTrue_(!v.errors.quantity && !v.errors.reason, '任意にした数量・理由がエラーになっています: ' + JSON.stringify(v.errors));
  assertTrue_(!!vr_(validPayload_({ quantity: '0' }), 'FULL', m, 'u1@example.com', r).errors.quantity, '任意でも形式は確かめる');
  assertEq_(Object.keys(vr_(validPayload_({ modelNo: '' }), 'FORMAT', m, 'u1@example.com', r).errors), [], '一時保存では必須を見ない');
  const always = vr_(validPayload_({ deptCode: '', approverId: '' }), 'FULL', m, 'u1@example.com', requiredWith_({}));
  assertTrue_(!!always.errors.deptCode && !!always.errors.approverId, '部門・承認者は常に必須');
}
function test_requiredPartyOptional() {
  const m = testMasters_();
  const r = requiredWith_({ supplier: false });
  const v = vr_(validPayload_({ supplierType: '', supplierCode: '000315' }), 'FULL', m, 'u1@example.com', r);
  assertEq_([v.errors.supplierType, v.value.supplierCode], [undefined, ''], '区分が空なら通り、コードは空にする');
  assertTrue_(!!vr_(validPayload_({ supplierType: 'マスタ', supplierCode: '' }), 'FULL', m, 'u1@example.com', r).errors.supplierCode, 'マスタを選んだらコードが要る');
  assertTrue_(!!vr_(validPayload_({ supplierType: '' }), 'FULL', m, 'u1@example.com').errors.supplierType, '初期値では必須');
}
function test_requiredAttachment() {
  const m = testMasters_();
  const r = requiredWith_({ attachment1: true });
  assertTrue_(!!vr_(validPayload_(), 'FULL', m, 'u1@example.com', r).errors.attachment1, '添付が無ければエラー');
  assertTrue_(!vr_(validPayload_({ attachments: { 1: true } }), 'FULL', m, 'u1@example.com', r).errors.attachment1, '添付があれば通る');
  assertTrue_(!vr_(validPayload_(), 'FULL', m, 'u1@example.com').errors.attachment1, '初期値では任意');
  assertTrue_(!vr_(validPayload_(), 'FORMAT', m, 'u1@example.com', r).errors.attachment1, '一時保存では見ない');
}

// ---------------------------------------------------------------------
// pure テスト: 資材候補
// ---------------------------------------------------------------------

function rank_(over) {
  const m = testMasters_();
  return rankMaterials(testRequest_(Object.assign({ itemName: 'ボールペン' }, over || {})), testMaterials_(), m.departments, m.suppliers, 10);
}
function test_rank1() {
  const c = rank_({ itemName: 'コピー用紙Ａ４' });
  assertEq_([c[0].rank, c[0].code], [1, '000000000000001']);
}
function test_rank2() {
  const c = rank_({});
  assertEq_([c[0].rank, c[0].code], [2, '000000000001600']);
}
function test_rankAbbr() {
  const c = rank_({ supplierCode: '000501', supplierName: '株式会社西本商店', deptCode: '94' });
  assertEq_([c[0].rank, c[0].code], [2, '000000000001591'], '略称「西本商店」で一致');
}
function test_rank3() {
  const c = rank_({ supplierCode: '000501', supplierName: '株式会社西本商店' });
  assertEq_([c[0].rank, c[0].code], [3, '000000000001591'], '生産課→共通部署94');
  const m = testMasters_();
  m.departments[0].commonDeptCode = '';
  const c2 = rankMaterials(testRequest_({ supplierCode: '000501' }), testMaterials_(), m.departments, m.suppliers, 10);
  assertEq_(c2[0].rank, 4, '共通部署コードが空なら順位3を飛ばす');
}
function test_rank4() {
  const c = rank_({});
  const r4 = c.filter(function (x) { return x.code === '000000000001700'; })[0];
  assertEq_(r4 && r4.rank, 4);
}
function test_rankInvalid() {
  assertTrue_(!rank_({}).some(function (x) { return x.code === '000000000001800'; }), '無効な資材が出ています');
}
function test_rankManualNone() {
  const manual = rank_({ supplierType: '手入力', supplierCode: '', supplierName: '西本商店' });
  assertEq_(manual.map(function (x) { return x.code; }), ['000000000001591']);
  const none = rank_({ supplierType: '指定なし', supplierCode: '', supplierName: '' });
  assertEq_(none.map(function (x) { return x.rank + ':' + x.code; }), ['2:000000000001600', '3:000000000001591', '4:000000000000001', '4:000000000001700'], '指定なしは種別と部門だけで判定');
  const manualNoHit = rank_({ supplierType: '手入力', supplierCode: '', supplierName: '存在しない商店' });
  assertEq_(manualNoHit.length, 0);
}

// ---------------------------------------------------------------------
// pure テスト: 権限・遷移・採番・設定
// ---------------------------------------------------------------------

/** 04 §3.2 の期待値。A=入力者 P=指定承認者 M=管理者 K=経理 */
const EXPECTED_PERMISSIONS_ = {
  SAVE_DRAFT: { '(新規)': 'A', '一時保存': 'A', '入力完了': 'A' },
  COMPLETE: { '(新規)': 'A', '一時保存': 'A', '入力完了': 'A' },
  REQUEST: { '(新規)': 'A', '一時保存': 'A', '入力完了': 'A', '差し戻し': 'A' },
  EDIT: { '一時保存': 'AM', '入力完了': 'AM', '承認依頼中': 'AP', '差し戻し': 'A', '承認済': 'PM' },
  DELETE: { '一時保存': 'AM', '入力完了': 'AM' },
  CANCEL_REQUEST: { '承認依頼中': 'AP' },
  APPROVE: { '承認依頼中': 'P' },
  REJECT: { '承認依頼中': 'P' },
  CANCEL_APPROVAL: { '承認済': 'PM' },
  FIX_MATERIAL: { '承認済': 'MK' },
  FILL_CODE: { '承認済': 'MK' },
  RECALC_MATERIAL: { '承認済': 'MK' },
  EXPORT_CSV: { '承認済': 'MK', 'システム反映済': 'MK' },
  MARK_REFLECTED: { '承認済': 'MK' },
  REVERT_REFLECTED: { 'システム反映済': 'M' },
  ATTACH: { '一時保存': 'AM', '入力完了': 'AM', '承認依頼中': 'AP', '差し戻し': 'A', '承認済': 'PM' }
};
function test_permissionMatrix() {
  const statuses = [STATUS_NEW].concat(STATUS_ORDER);
  const roleKeys = { A: 'applicant', P: 'approver', M: 'admin', K: 'accounting' };
  let cells = 0;
  Object.keys(EXPECTED_PERMISSIONS_).forEach(function (action) {
    statuses.forEach(function (st) {
      Object.keys(roleKeys).forEach(function (letter) {
        const roles = { applicant: false, approver: false, admin: false, accounting: false };
        roles[roleKeys[letter]] = true;
        const expected = (EXPECTED_PERMISSIONS_[action][st] || '').indexOf(letter) >= 0;
        const actual = canPerform(action, st, roles) !== null;
        if (expected !== actual) throw new Error(action + ' × ' + st + ' × ' + roleKeys[letter] + ': 期待 ' + expected + ' / 実際 ' + actual);
        cells++;
      });
    });
  });
  return cells + 'セルを確認';
}
function test_selfApproval() {
  const m = testMasters_();
  const roles = resolveRoles('u6@example.com', { applicantId: 'u6@example.com', approverId: 'u6@example.com' }, m);
  assertEq_([roles.applicant, roles.approver], [true, false]);
  assertEq_(canPerform('APPROVE', STATUS.REQUESTED, roles), null);
  const other = resolveRoles('u3@example.com', { applicantId: 'u1@example.com', approverId: 'u2@example.com' }, m);
  assertEq_(canPerform('APPROVE', STATUS.REQUESTED, other), null, 'TC-PM-03 指定されていない承認者');
}
function test_transitions() {
  assertEq_(nextStatus('SAVE_DRAFT', STATUS_NEW), STATUS.DRAFT);
  assertEq_(nextStatus('SAVE_DRAFT', STATUS.COMPLETED), STATUS.DRAFT, 'T2 入力完了→一時保存');
  assertEq_(nextStatus('COMPLETE', STATUS.DRAFT), STATUS.COMPLETED);
  assertEq_(nextStatus('REQUEST', STATUS.REJECTED), STATUS.REQUESTED);
  assertEq_(nextStatus('CANCEL_REQUEST', STATUS.REQUESTED), STATUS.COMPLETED);
  assertEq_(nextStatus('APPROVE', STATUS.REQUESTED), STATUS.APPROVED);
  assertEq_(nextStatus('REJECT', STATUS.REQUESTED), STATUS.REJECTED);
  assertEq_(nextStatus('CANCEL_APPROVAL', STATUS.APPROVED), STATUS.REQUESTED);
  assertEq_(nextStatus('MARK_REFLECTED', STATUS.APPROVED), STATUS.REFLECTED);
  assertEq_(nextStatus('REVERT_REFLECTED', STATUS.REFLECTED), STATUS.APPROVED);
  assertEq_(nextStatus('APPROVE', STATUS.DRAFT), null, 'TC-ST-12 表に無い遷移');
}
function test_requestIdSequence() {
  assertEq_(computeNextRequestId_([], 'PR', '20261031'), 'PR-20261031-001');
  assertEq_(computeNextRequestId_(['PR-20261031-001', 'PR-20261031-002', 'PR-20261030-009'], 'PR', '20261031'), 'PR-20261031-003');
}
function test_requestId1000() {
  assertEq_(computeNextRequestId_(['PR-20261031-999'], 'PR', '20261031'), 'PR-20261031-1000');
}
function test_parseSettings() {
  const s = parseSettings_({ PIN_SESSION_MINUTES: '45', CSV_HEADER: 'false', CSV_DELIMITER: '\\t', STATUS_COLORS: '{壊れたJSON' });
  assertEq_([s.PIN_SESSION_MINUTES, s.CSV_HEADER, s.CSV_DELIMITER], [45, false, '\t']);
  assertEq_(s.STATUS_COLORS['承認済'].bg, '#d1fae5', '壊れたJSONは既定値');
  assertEq_(s.QUANTITY_DECIMALS, 3);
  assertEq_(s.LIST_PAGE_SIZE, 50, '一覧の件数の既定値');
  assertEq_([parseSettings_({ LIST_PAGE_SIZE: '20' }).LIST_PAGE_SIZE, parseSettings_({ LIST_PAGE_SIZE: 'abc' }).LIST_PAGE_SIZE], [20, 50], '数値に変換し、壊れた値は既定値');
}
function test_parseRequiredFields() {
  const d = parseRequiredFields_([]);
  assertEq_([d.itemName, d.quantity, d.modelNo, d.attachment1], [true, true, false, false], '行が無ければ初期値');
  const r = parseRequiredFields_([
    { key: 'modelNo', label: '型番（名前を変えても可）', required: true },
    { key: 'quantity', required: 'FALSE' },
    { key: 'deptCode', required: false },
    { key: 'unknown', required: true }
  ]);
  assertEq_([r.modelNo, r.quantity, r.itemName, r.deptCode, r.unknown], [true, false, true, undefined, undefined], 'キーで照合し、知らないキーは無視');
}
function test_validatePin() {
  assertEq_(validatePin_('482913', 6).ok, true, '6桁の数字');
  assertEq_(validatePin_('111111', 6).ok, true, '推測しやすい番号も可');
  assertEq_(validatePin_('123456', 6).ok, true, '推測しやすい番号も可');
  assertEq_(validatePin_('４８２９１３', 6).value, '482913', '全角数字は半角に直す');
  assertEq_(validatePin_('12345', 6).ok, false, '5桁は不可');
  assertEq_(validatePin_('1234567', 6).ok, false, '7桁は不可');
  assertEq_(validatePin_('12a456', 6).ok, false, '英字は不可');
  assertEq_(validatePin_('', 6).ok, false, '空は不可');
  assertEq_(validatePin_('1234', 4).ok, true, 'PIN_LENGTH に合わせる');
}

// ---------------------------------------------------------------------
// gas テスト（開発環境のシートを使う。サンプルデータ投入の後に実行する）
// ---------------------------------------------------------------------

function requireGas_() {
  if (typeof SpreadsheetApp === 'undefined') throw skip_('GAS 環境ではありません');
  if (!getSpreadsheet_().getSheetByName(SHEETS.REQUESTS)) throw skip_('初期セットアップが未実行です');
}

function test_gas_masterCounts() {
  requireGas_();
  const counts = {
    MATERIALS: readAll('MATERIALS').length, SUPPLIERS: readAll('SUPPLIERS').length, EMPLOYEES: readAll('EMPLOYEES').length,
    DEPARTMENTS: readAll('DEPARTMENTS').length, CATEGORIES: readAll('CATEGORIES').length
  };
  if (!counts.MATERIALS) throw skip_('マスタ取込が未実行です');
  Object.keys(EXPECTED_MASTER_COUNTS).forEach(function (k) {
    assertEq_(counts[k], EXPECTED_MASTER_COUNTS[k], k + ' の件数（マスタを更新したら EXPECTED_MASTER_COUNTS を直す）');
  });
  return JSON.stringify(counts);
}

function test_gas_materialLeadingZeros() {
  requireGas_();
  const m = readAll('MATERIALS');
  if (!m.length) throw skip_('マスタ取込が未実行です');
  assertTrue_(m.every(function (x) { return /^\d{15}$/.test(x.code); }), '15桁でない資材コードがあります');
  const s = readAll('SUPPLIERS');
  assertTrue_(s.every(function (x) { return /^\d{6}$/.test(x.code); }), '6桁でない取引先コードがあります');
  return '資材' + m.length + '件・取引先' + s.length + '件';
}

/** テストに使う社員（サンプルデータ投入で作った承認者・管理者・経理） */
function testActors_() {
  const masters = getMasters();
  const admin = masters.roles.filter(function (r) { return r.enabled && r.role === ROLE_ADMIN; })[0];
  const acc = masters.roles.filter(function (r) { return r.enabled && r.role === ROLE_ACCOUNTING; })[0];
  const appr = masters.approvers.filter(function (a) {
    return a.enabled && masters.departments.some(function (d) { return d.enabled && d.deptCode === a.deptCode; });
  })[0];
  if (!admin || !acc || !appr) throw skip_('サンプルデータ投入（管理者・経理・承認者）が未実行です');
  const privileged = [admin.employeeId, acc.employeeId].concat(masters.approvers.map(function (a) { return a.approverId; }));
  const applicant = masters.employees.filter(function (e) { return e.enabled && privileged.indexOf(e.employeeId) < 0; })[0];
  if (!applicant) throw skip_('入力者にできる社員がいません');
  const cat = masters.categories.filter(function (c) { return c.enabled; })[0];
  if (!cat) throw skip_('有効な種別がありません');
  return { masters: masters, admin: admin.employeeId, accounting: acc.employeeId, approver: appr.approverId, deptCode: appr.deptCode, applicant: applicant.employeeId, categoryCode: cat.categoryCode };
}

function markTest_(requestId) {
  const r = findRequest_(requestId);
  r.sysNote = 'TEST';
  writeRows_('REQUESTS', r._row, [r]);
}

function cleanupTestRequests_() {
  resetExecutionCache_();
  const sheet = getSheet('REQUESTS');
  readAll('REQUESTS').filter(function (r) { return r.sysNote === 'TEST'; })
    .map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (row) { sheet.deleteRow(row); });
}

function call_(res) {
  if (!res.ok) { const e = new Error(res.error.code + ': ' + res.error.message + (res.error.fields ? ' ' + JSON.stringify(res.error.fields) : '')); e.code = res.error.code; throw e; }
  return res.data;
}
function expectError_(res, code, msg) {
  if (res.ok) throw new Error((msg || '') + ' エラーになりませんでした（期待: ' + code + '）');
  if (res.error.code !== code) throw new Error((msg || '') + ' 期待 ' + code + ' / 実際 ' + res.error.code + ' ' + res.error.message);
}

function test_gas_pinFlow() {
  requireGas_();
  const a = testActors_();
  const id = a.applicant;
  const r = issuePin(id, 'test');
  assertTrue_(/^\d{6}$/.test(r.pin), '6桁の数字');
  const rec = readAll('PINS').filter(function (x) { return x.employeeId === id; })[0];
  assertTrue_(rec.hash && rec.hash !== r.pin && rec.salt, 'ハッシュとソルトだけが残る');
  call_(authenticate(id, r.pin));
  const max = getSetting('PIN_MAX_FAILS');
  for (let i = 1; i < max; i++) expectError_(authenticate(id, '000000x'), 'AUTH_FAILED', i + '回目');
  expectError_(authenticate(id, '000000x'), 'AUTH_LOCKED', max + '回目でロック');
  expectError_(authenticate(id, r.pin), 'AUTH_LOCKED', 'ロック中は正しくても不可');
  issuePin(id, 'test', SEED_PIN); // 元に戻す（ロックも解除される）
  const noPin = getMasters().employees.filter(function (e) {
    return e.enabled && !readAll('PINS').some(function (p) { return p.employeeId === e.employeeId; });
  })[0];
  if (noPin) expectError_(authenticate(noPin.employeeId, '123456'), 'AUTH_FAILED', 'TC-AU-07 未発行');
}

function test_gas_adminSpecifyPin() {
  requireGas_();
  const a = testActors_();
  const ctxM = { operatorId: a.admin, token: createSession_(a.admin).token };
  const target = a.applicant;
  try {
    // 指定した番号を設定でき、その番号で認証できる。番号は返さない
    const d = call_(adminIssuePin(ctxM, target, '482913'));
    assertEq_([d.specified, d.pin === undefined], [true, true], '指定したときは番号を返さない');
    call_(authenticate(target, '482913'));
    expectError_(authenticate(target, SEED_PIN), 'AUTH_FAILED', '以前の番号は使えない');
    // 操作ログには番号を残さない
    const log = readAll('LOGS').filter(function (l) { return l.action === ACTIONS.ISSUE_PIN; }).pop();
    assertTrue_(log.detail.indexOf('482913') < 0 && log.detail.indexOf('指定') >= 0, 'ログに番号が残っています: ' + log.detail);
    // 形式の誤り
    expectError_(adminIssuePin(ctxM, target, '12345'), 'VALIDATION', '5桁');
    expectError_(adminIssuePin(ctxM, target, 'abc123'), 'VALIDATION', '英字');
    // 推測しやすい番号も設定できる
    call_(adminIssuePin(ctxM, target, '111111'));
    call_(authenticate(target, '111111'));
    // 空ならランダムに発行して番号を返す
    const r = call_(adminIssuePin(ctxM, target, ''));
    assertTrue_(r.specified === false && /^\d{6}$/.test(r.pin), 'ランダム発行');
    // 管理者でなければ設定できない
    const ctxU = { operatorId: target, token: createSession_(target).token };
    expectError_(adminIssuePin(ctxU, a.admin, '222222'), 'FORBIDDEN', '管理者以外');
    return '指定・ランダム・形式チェック・権限を確認';
  } finally {
    issuePin(target, 'test', SEED_PIN); // 元に戻す
  }
}

function test_gas_workflow() {
  requireGas_();
  const a = testActors_();
  const ctxU = { operatorId: a.applicant, token: null };
  const ctxP = { operatorId: a.approver, token: null };
  const ctxM = { operatorId: a.admin, token: null };
  const ctxK = { operatorId: a.accounting, token: null };
  let id = null;
  try {
    const supplier = a.masters.suppliers.filter(function (s) { return s.visible; })[0];
    const payload = {
      deptCode: a.deptCode, categoryCode: a.categoryCode, approverId: a.approver,
      supplierType: supplier ? 'マスタ' : '手入力', supplierCode: supplier ? supplier.code : '', supplierBranch: supplier ? supplier.branch : '', supplierName: supplier ? '' : 'テスト商店',
      deliveryType: '手入力', deliveryName: 'テスト倉庫', itemName: '【テスト】ボールペン', modelNo: 'T-1', quantity: '3', unitNote: '本', reason: '自動テスト', deliveryDate: ''
    };
    // TC-ST-01 一時保存
    let r = call_(saveRequest(ctxU, { deptCode: a.deptCode }, 'DRAFT'));
    id = r.requestId; markTest_(id); // markTest_ はバージョンを上げない
    assertEq_(r.status, STATUS.DRAFT, 'TC-ST-01');
    // TC-ST-02 入力完了
    r = call_(saveRequest(ctxU, Object.assign({ requestId: id, version: r.version }, payload), 'COMPLETE'));
    assertEq_(r.status, STATUS.COMPLETED, 'TC-ST-02');
    // TC-ST-04 承認依頼と提出日
    r = call_(saveRequest(ctxU, Object.assign({ requestId: id, version: r.version }, payload), 'REQUEST'));
    assertEq_(r.status, STATUS.REQUESTED, 'TC-ST-04');
    assertEq_(findRequest_(id).submittedDate, todayString(), 'TC-SD-01 提出日');
    // TC-AU 暗証番号なしの承認は AUTH_REQUIRED
    expectError_(changeStatus(ctxP, id, r.version, 'APPROVE', {}), 'AUTH_REQUIRED', '承認（暗証番号なし）');
    ctxP.token = createSession_(a.approver).token;
    ctxM.token = createSession_(a.admin).token;
    ctxK.token = createSession_(a.accounting).token;
    // TC-PM-05 承認依頼中に部門を変えられない
    expectError_(saveRequest(ctxU, Object.assign({ requestId: id, version: r.version }, payload, { approverId: a.admin }), 'EDIT'), 'VALIDATION', 'TC-PM-05');
    // TC-ST-07 承認（資材候補の計算）
    r = call_(changeStatus(ctxP, id, r.version, 'APPROVE', {}));
    assertEq_(r.status, STATUS.APPROVED, 'TC-ST-07');
    // TC-PM-08 入力者はCSV出力できない
    expectError_(exportCsv(ctxU, [{ requestId: id, version: r.version }]), 'FORBIDDEN', 'TC-PM-08');
    // TC-ST-10 未出力は反映済にできない
    expectError_(markReflected(ctxK, [{ requestId: id, version: r.version }]), 'VALIDATION', 'TC-ST-10');
    // TC-MT-10 資材なしで確定
    r.version = call_(fixMaterial(ctxK, id, r.version, null)).version;
    assertEq_(findRequest_(id).materialFixed, true, 'TC-MT-10');
    // TC-CSV-14 CSV出力
    const out = call_(exportCsv(ctxK, [{ requestId: id, version: r.version }]));
    r.version = out.results[0].version;
    const rec = findRequest_(id);
    assertEq_([rec.csvExported, rec.csvExportCount, rec.status], [true, 1, STATUS.APPROVED], 'TC-CSV-14');
    const text = Utilities.newBlob(Utilities.base64Decode(out.base64)).getDataAsString('Shift_JIS');
    assertTrue_(text.indexOf('発注先コード') === 0, 'TC-CSV-02 Shift_JIS の見出し: ' + text.substr(0, 20));
    // 反映済
    r.version = call_(markReflected(ctxK, [{ requestId: id, version: r.version }])).results[0].version;
    assertEq_(findRequest_(id).status, STATUS.REFLECTED);
    // TC-CSV-15 再出力
    r.version = call_(exportCsv(ctxK, [{ requestId: id, version: r.version }])).results[0].version;
    assertEq_([findRequest_(id).csvExportCount, findRequest_(id).status], [2, STATUS.REFLECTED], 'TC-CSV-15');
    // TC-ST-14 経理は承認済に戻せない / TC-ST-13 管理者は戻せる
    expectError_(changeStatus(ctxK, id, r.version, 'REVERT_REFLECTED', {}), 'FORBIDDEN', 'TC-ST-14');
    r = call_(changeStatus(ctxM, id, r.version, 'REVERT_REFLECTED', {}));
    const back = findRequest_(id);
    assertEq_([back.status, back.reflectedAt, !!back.revertedAt], [STATUS.APPROVED, '', true], 'TC-ST-13');
    // TC-ST-09 承認取消
    r = call_(changeStatus(ctxM, id, r.version, 'CANCEL_APPROVAL', {}));
    assertEq_([r.status, findRequest_(id).csvExported, findRequest_(id).submittedDate], [STATUS.REQUESTED, false, todayString()], 'TC-ST-09 / TC-SD-03');
    // TC-ST-08 差し戻し（理由なしはエラー）
    expectError_(changeStatus(ctxP, id, r.version, 'REJECT', { reason: '' }), 'VALIDATION', 'TC-ST-08');
    r = call_(changeStatus(ctxP, id, r.version, 'REJECT', { reason: 'テストの差し戻し' }));
    assertEq_([r.status, findRequest_(id).rejectReason], [STATUS.REJECTED, 'テストの差し戻し'], 'TC-ST-08');
    // TC-PM-07 差し戻しは削除できない
    expectError_(changeStatus(ctxU, id, r.version, 'DELETE', {}), 'INVALID_STATE', 'TC-PM-07');
    return '届出 ' + id + ' で一連の操作を確認';
  } finally {
    cleanupTestRequests_();
  }
}

function test_gas_conflict() {
  requireGas_();
  const a = testActors_();
  const ctxU = { operatorId: a.applicant, token: null };
  try {
    const r = call_(saveRequest(ctxU, { deptCode: a.deptCode, itemName: '【テスト】競合' }, 'DRAFT'));
    markTest_(r.requestId); // バージョンは上げない
    call_(saveRequest(ctxU, { requestId: r.requestId, version: r.version, deptCode: a.deptCode, itemName: '1回目' }, 'DRAFT'));
    expectError_(saveRequest(ctxU, { requestId: r.requestId, version: r.version, deptCode: a.deptCode, itemName: '2回目' }, 'DRAFT'), 'CONFLICT', 'TC-DL-05');
    return '古いバージョン ' + r.version + ' での保存が CONFLICT になることを確認';
  } finally {
    cleanupTestRequests_();
  }
}

function test_gas_requiredFieldsSheet() {
  requireGas_();
  const a = testActors_();
  const rows = readAll('FIELDS');
  const row = rows.filter(function (r) { return r.key === 'modelNo'; })[0];
  if (!row) throw skip_('入力項目シートが無いか、型番の行がありません（初期セットアップを再実行してください）');
  const original = row.required;
  const ctxU = { operatorId: a.applicant, token: null };
  try {
    row.required = true;
    writeRows_('FIELDS', row._row, [row]);
    resetExecutionCache_();
    assertEq_(buildInitData_().requiredFields.modelNo, true, '画面へ渡す設定');
    const supplier = a.masters.suppliers.filter(function (x) { return x.visible; })[0];
    const payload = {
      deptCode: a.deptCode, categoryCode: a.categoryCode, approverId: a.approver,
      supplierType: supplier ? 'マスタ' : '手入力', supplierCode: supplier ? supplier.code : '', supplierBranch: supplier ? supplier.branch : '', supplierName: supplier ? '' : 'テスト商店',
      deliveryType: '手入力', deliveryName: 'テスト倉庫', itemName: '【テスト】必須の切り替え', modelNo: '', quantity: '1', unitNote: '', reason: '自動テスト', deliveryDate: ''
    };
    const res = saveRequest(ctxU, payload, 'COMPLETE');
    expectError_(res, 'VALIDATION', '型番が空');
    assertTrue_(!!res.error.fields.modelNo, '型番のエラーがありません');
    return '型番を必須にすると、空のまま入力完了にできないことを確認';
  } finally {
    row.required = original;
    writeRows_('FIELDS', row._row, [row]);
    resetExecutionCache_();
    cleanupTestRequests_();
  }
}

function test_gas_notifyDisabled() {
  requireGas_();
  if (getSetting('NOTIFY_ENABLED')) throw skip_('NOTIFY_ENABLED が TRUE です');
  assertEq_(notify('REQUEST', { requestId: 'x', applicantId: '', approverId: '' }, testMasters_()), null);
  assertEq_(notifyRecipients_('APPROVE', { applicantId: 'u1@example.com' }, testMasters_()), ['u1@example.com', 'u5@example.com'], 'TC-NT-02 送り先');
}

// ---------------------------------------------------------------------
// 開発用サンプルデータの投入（K-48）
// ---------------------------------------------------------------------

function menuSeedDevData() {
  try {
    const msg = seedDevData();
    alert_(msg);
  } catch (e) {
    alert_('サンプルデータ投入に失敗しました: ' + (e && e.message ? e.message : e));
  }
}

/**
 * マスタ取込の後に実行する。plan/01 の仮の値で、部署・種別の有効化、承認者対応表、納入先、
 * 権限、暗証番号（全員 123456）、各ステータスのサンプル届出を作る。
 */
function seedDevData() {
  resetExecutionCache_();
  clearMasterCache();
  const employees = readAll('EMPLOYEES').filter(function (e) { return e.enabled; });
  if (!employees.length) throw new Error('社員マスタが空です。先に「マスタ取込 > すべて」を実行してください');
  const lines = [];

  // 1. 部署: 社員の所属課と一致する部署を有効にし、生産管理部の課に共通部署コードを入れる
  const sections = {};
  employees.forEach(function (e) { if (e.section) sections[e.section] = e.division; });
  const depts = readAll('DEPARTMENTS');
  const has94 = depts.some(function (d) { return d.deptCode === '94'; });
  depts.forEach(function (d) {
    if (sections[d.deptName] !== undefined) {
      d.enabled = true;
      if (!d.division) d.division = sections[d.deptName];
      if (has94 && d.division === '生産管理部' && !d.commonDeptCode) d.commonDeptCode = '94';
    }
    if (d.deptCode === '94') d.enabled = true;
  });
  replaceAll_('DEPARTMENTS', depts);
  const enabledDepts = depts.filter(function (d) { return d.enabled; });
  lines.push('部署: ' + enabledDepts.length + '件を有効化' + (has94 ? '（共通部署コード94を設定）' : ''));

  // 2. 種別
  const cats = readAll('CATEGORIES');
  const norm = function (s) { return String(s || '').normalize('NFKC'); };
  cats.forEach(function (c) {
    if (SEED_CATEGORY_NAMES.some(function (n) { return norm(c.categoryName).indexOf(norm(n)) >= 0; })) c.enabled = true;
  });
  if (cats.filter(function (c) { return c.enabled; }).length < 3) cats.forEach(function (c) { c.enabled = true; });
  replaceAll_('CATEGORIES', cats);
  lines.push('種別: ' + cats.filter(function (c) { return c.enabled; }).length + '件を有効化');

  // 3. 承認者対応表
  const approvers = [];
  enabledDepts.forEach(function (d) {
    const inSection = employees.filter(function (e) { return e.section === d.deptName; });
    let picks = inSection.filter(function (e) { return e.jobTitle === '課長'; }).map(function (e) { return [e, 1]; })
      .concat(inSection.filter(function (e) { return e.jobTitle === '課長代理'; }).map(function (e) { return [e, 2]; }));
    if (!picks.length && d.division) {
      picks = employees.filter(function (e) { return e.division === d.division && ['部長', '副部長', '課長'].indexOf(e.jobTitle) >= 0; }).slice(0, 2).map(function (e) { return [e, 3]; });
    }
    if (!picks.length) picks = inSection.filter(function (e) { return e.jobTitle; }).slice(0, 1).map(function (e) { return [e, 5]; });
    picks.forEach(function (p) { approvers.push({ deptCode: d.deptCode, approverId: p[0].employeeId, approverName: p[0].name, priority: p[1], enabled: true }); });
  });
  replaceAll_('APPROVERS', approvers);
  lines.push('承認者対応表: ' + approvers.length + '行（課長=1、課長代理=2、部の役職者=3）');

  // 4. 納入先
  const suppliers = readAll('SUPPLIERS');
  let deliv = suppliers.filter(function (s) { return norm(s.name).indexOf('サカイキャニング') >= 0; }).slice(0, 5);
  if (!deliv.length) deliv = suppliers.slice(0, 2);
  replaceAll_('DELIVERIES', deliv.map(function (s, i) { return { code: s.code, branch: s.branch, name: s.name, sortOrder: (i + 1) * 10, enabled: true }; }));
  lines.push('納入先: ' + deliv.length + '件（' + deliv.map(function (s) { return s.name; }).join('、') + '）');

  // 5. 権限
  const corp = employees.filter(function (e) { return e.division === 'コーポレート部門'; });
  const pool = corp.length ? corp : employees;
  const admins = SEED_ADMIN_IDS.length ? SEED_ADMIN_IDS : [pool[0].employeeId];
  const accs = SEED_ACCOUNTING_IDS.length ? SEED_ACCOUNTING_IDS : [(pool[1] || pool[0]).employeeId];
  const nameOf = function (id) { const e = employees.filter(function (x) { return x.employeeId === id; })[0]; return e ? e.name : id; };
  const roles = admins.map(function (id) { return { employeeId: id, name: nameOf(id), role: ROLE_ADMIN, enabled: true }; })
    .concat(accs.map(function (id) { return { employeeId: id, name: nameOf(id), role: ROLE_ACCOUNTING, enabled: true }; }));
  replaceAll_('ROLES', roles);
  lines.push('管理者: ' + admins.map(nameOf).join('、') + ' / 経理: ' + accs.map(nameOf).join('、'));

  // 6. 暗証番号
  clearMasterCache();
  resetExecutionCache_();
  const pinTargets = {};
  approvers.forEach(function (a) { pinTargets[a.approverId] = true; });
  admins.concat(accs).forEach(function (id) { pinTargets[id] = true; });
  Object.keys(pinTargets).forEach(function (id) { issuePin(id, 'seedDevData', SEED_PIN); });
  lines.push('暗証番号: ' + Object.keys(pinTargets).length + '人に ' + SEED_PIN + ' を設定（開発環境だけ）');
  console.warn('開発用の暗証番号 ' + SEED_PIN + ' を設定しました。本番では使わないでください。');

  // 7. サンプル届出
  if (SEED_REQUESTS) lines.push(seedSampleRequests_(admins[0], accs[0]));

  clearMasterCache();
  return '開発用サンプルデータを投入しました。\n\n' + lines.join('\n');
}

function seedSampleRequests_(adminId, accountingId) {
  resetExecutionCache_();
  const masters = getMasters();
  const appr = masters.approvers[0];
  if (!appr) return 'サンプル届出: 承認者がいないため作りませんでした';
  const privileged = masters.approvers.map(function (a) { return a.approverId; }).concat([adminId, accountingId]);
  const applicant = masters.employees.filter(function (e) { return e.enabled && e.section && privileged.indexOf(e.employeeId) < 0; })[0];
  if (!applicant) return 'サンプル届出: 入力者にできる社員がいないため作りませんでした';
  const cats = masters.categories.filter(function (c) { return c.enabled; });
  const materials = readAll('MATERIALS');
  const visible = masters.suppliers.filter(function (s) { return s.visible; });
  // 有効な種別の資材で、メーカーが表示中の発注先にあるものを探す（資材候補が出るように）
  let pick = null;
  for (let i = 0; i < materials.length && !pick; i++) {
    const m = materials[i];
    if (m.invalid !== '0' || !cats.some(function (c) { return c.categoryCode === m.type; })) continue;
    const s = visible.filter(function (x) { return x.code === m.makerCode; })[0];
    if (s) pick = { material: m, supplier: s };
  }
  const supplier = pick ? pick.supplier : visible[0];
  const category = pick ? pick.material.type : cats[0].categoryCode;
  const delivery = masters.deliveries.filter(function (d) { return d.enabled; })[0];
  const ctxU = { operatorId: applicant.employeeId, token: null };
  const ctxP = { operatorId: appr.approverId, token: createSession_(appr.approverId).token };
  const ctxK = { operatorId: accountingId, token: createSession_(accountingId).token };
  const base = {
    deptCode: appr.deptCode, categoryCode: category, approverId: appr.approverId,
    supplierType: supplier ? 'マスタ' : '手入力', supplierCode: supplier ? supplier.code : '', supplierBranch: supplier ? supplier.branch : '', supplierName: supplier ? '' : 'サンプル商店',
    deliveryType: delivery ? 'マスタ' : '手入力', deliveryCode: delivery ? delivery.code : '', deliveryBranch: delivery ? delivery.branch : '', deliveryName: delivery ? '' : '第2倉庫',
    modelNo: '', unitNote: '個', reason: '開発用サンプルデータ', deliveryDate: ''
  };
  const mk = function (item, qty, mode) { return call_(saveRequest(ctxU, Object.assign({}, base, { itemName: item, quantity: qty }), mode)); };
  const made = [];
  mk('【サンプル】クリアファイル', '1', 'DRAFT'); made.push(STATUS.DRAFT);
  mk('【サンプル】コピー用紙A4', '5', 'COMPLETE'); made.push(STATUS.COMPLETED);
  mk('【サンプル】ボールペン（黒）', '20', 'REQUEST'); made.push(STATUS.REQUESTED);
  let r = mk('【サンプル】電卓', '2', 'REQUEST');
  call_(changeStatus(ctxP, r.requestId, r.version, 'REJECT', { reason: '型番を記入してください' })); made.push(STATUS.REJECTED);
  r = mk('【サンプル】ホワイトボードマーカー', '10', 'REQUEST');
  call_(changeStatus(ctxP, r.requestId, r.version, 'APPROVE', {})); made.push(STATUS.APPROVED);
  r = mk('【サンプル】ガムテープ', '12', 'REQUEST');
  r = call_(changeStatus(ctxP, r.requestId, r.version, 'APPROVE', {}));
  const cand = call_(getMaterialCandidates(ctxK, r.requestId));
  let ver = call_(fixMaterial(ctxK, r.requestId, r.version, cand.candidates[0] || null)).version;
  ver = call_(exportCsv(ctxK, [{ requestId: r.requestId, version: ver }])).results[0].version;
  call_(markReflected(ctxK, [{ requestId: r.requestId, version: ver }])); made.push(STATUS.REFLECTED);
  return 'サンプル届出: ' + made.length + '件（' + made.join('、') + '）。入力者: ' + applicant.name + ' / 承認者: ' + employeeName_(masters, appr.approverId);
}

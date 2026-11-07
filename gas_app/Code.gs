/**
 * 物品購入届CSV出力アプリ - GAS バックエンド (Code.gs)
 * 版: v1.0 2026/10/31
 *
 * GAS エディタにこのファイルの中身を丸ごと貼り付けて使う（clasp は使わない）。
 * セクションの目次（エディタの検索で【名前】を探すと飛べる）
 *   【Api】            doGet / include / 画面から呼ぶ公開関数
 *   【Config】         シート名・列定義・ステータス・設定の既定値
 *   【Utils】          エラー・日付・文字の正規化・キャッシュ
 *   【Repository】     シートの読み書き・ロック・採番・ログ・マスタのキャッシュ
 *   【Auth】           暗証番号・トークン・役割の判定
 *   【Validator】      入力チェック
 *   【Workflow】       権限表・遷移表・保存・状態変更・コード補完
 *   【MaterialMatcher】資材候補の選定・確定・検索
 *   【CsvExport】      CSVの生成と出力の記録
 *   【MasterImport】   マスタCSVの取込
 *   【Attachment】     添付書類
 *   【Notifier】       通知（初版は送信しない）
 *   【Menu】           カスタムメニュー・初期セットアップ・バックアップ
 *
 * 仕様: plan/04_業務ロジック仕様.md、plan/06_サーバーAPI仕様.md
 */

// =====================================================================
// 【Api】 doGet / include / 画面から呼ぶ公開関数
// =====================================================================

function doGet(e) {
  let title = '物品購入届';
  try { title = getSetting('APP_NAME') || title; } catch (err) { /* 初期セットアップ前 */ }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** 公開関数の共通ラッパー。例外を {ok:false, error} に変える */
function handle_(fn) {
  resetExecutionCache_();
  try {
    const data = fn();
    return { ok: true, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) };
  } catch (e) {
    if (e && e.isAppError) {
      return { ok: false, error: { code: e.code, message: e.message, fields: e.fields || null } };
    }
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: { code: 'SYSTEM', message: 'システムエラーが発生しました: ' + (e && e.message ? e.message : String(e)) } };
  }
}

function getInitData() {
  return handle_(function () { return buildInitData_(); });
}
function authenticate(operatorId, pin) {
  return handle_(function () { return authenticateImpl_(operatorId, pin); });
}
function logout(ctx) {
  return handle_(function () { return logoutImpl_(ctx); });
}
function getRequestList(ctx, query) {
  return handle_(function () { return getRequestListImpl_(ctx, query); });
}
function getRequestDetail(ctx, requestId) {
  return handle_(function () { return getRequestDetailImpl_(ctx, requestId); });
}
function getApproverCandidates(ctx, deptCode, applicantId) {
  return handle_(function () {
    const masters = getMasters();
    requireOperator_(ctx, masters);
    return getApproverCandidates_(masters, deptCode, applicantId || ctx.operatorId);
  });
}
function searchSuppliers(ctx, keyword, includeHidden) {
  return handle_(function () { return searchSuppliersImpl_(ctx, keyword, includeHidden); });
}
function saveRequest(ctx, payload, mode) {
  return handle_(function () { return saveRequestImpl_(ctx, payload, mode); });
}
function changeStatus(ctx, requestId, version, action, options) {
  return handle_(function () { return changeStatusImpl_(ctx, requestId, version, action, options); });
}
function markReflected(ctx, items) {
  return handle_(function () { return markReflectedImpl_(ctx, items); });
}
function fillCodes(ctx, requestId, version, codes) {
  return handle_(function () { return fillCodesImpl_(ctx, requestId, version, codes); });
}
function getMaterialCandidates(ctx, requestId) {
  return handle_(function () { return getMaterialCandidatesImpl_(ctx, requestId); });
}
function recalcMaterialCandidates(ctx, requestId, version) {
  return handle_(function () { return recalcMaterialCandidatesImpl_(ctx, requestId, version); });
}
function searchMaterials(ctx, query) {
  return handle_(function () { return searchMaterialsImpl_(ctx, query); });
}
function fixMaterial(ctx, requestId, version, material) {
  return handle_(function () { return fixMaterialImpl_(ctx, requestId, version, material); });
}
function exportCsv(ctx, items) {
  return handle_(function () { return exportCsvImpl_(ctx, items); });
}
function uploadAttachment(ctx, requestId, version, slot, file) {
  return handle_(function () { return uploadAttachmentImpl_(ctx, requestId, version, slot, file); });
}
function deleteAttachment(ctx, requestId, version, slot) {
  return handle_(function () { return deleteAttachmentImpl_(ctx, requestId, version, slot); });
}
function getAttachment(ctx, requestId, slot) {
  return handle_(function () { return getAttachmentImpl_(ctx, requestId, slot); });
}
function adminPing(ctx) {
  return handle_(function () { requirePrivileged_(ctx, ['admin'], getMasters()); return {}; });
}
function adminImportMasters(ctx, target) {
  return handle_(function () {
    requirePrivileged_(ctx, ['admin'], getMasters());
    return { results: importMasters(target, ctx.operatorId) };
  });
}
/** 暗証番号の発行。pin を渡すと、その番号を設定する（空ならランダム）。指定したときは番号を返さない */
function adminIssuePin(ctx, employeeId, pin) {
  return handle_(function () {
    const masters = getMasters();
    requirePrivileged_(ctx, ['admin'], masters);
    const emp = findEmployee_(masters, employeeId);
    if (!emp) throw AppError('VALIDATION', '社員が見つかりません');
    const specified = pin !== undefined && pin !== null && String(pin).trim() !== '';
    if (specified) {
      const v = validatePin_(pin, getSetting('PIN_LENGTH'));
      if (!v.ok) throw AppError('VALIDATION', v.message, { pin: v.message });
      issuePin(employeeId, ctx.operatorId, v.value);
      return { employeeId: employeeId, name: emp.name, specified: true };
    }
    const r = issuePin(employeeId, ctx.operatorId);
    return { employeeId: employeeId, name: emp.name, pin: r.pin, specified: false };
  });
}
function adminGetSettings(ctx) {
  return handle_(function () {
    requirePrivileged_(ctx, ['admin'], getMasters());
    const rows = readAll('SETTINGS').map(function (r) { return { key: r.key, value: r.value, description: r.description }; });
    return { settings: rows, spreadsheetUrl: getSpreadsheet_().getUrl() };
  });
}

/** 画面の初期データ（06 §3） */
function buildInitData_() {
  const masters = getMasters();
  const s = getSettings();
  return {
    appName: s.APP_NAME,
    statusColors: s.STATUS_COLORS,
    statuses: STATUS_ORDER,
    statusNew: STATUS_NEW,
    permissions: PERMISSIONS,
    actions: ACTIONS,
    employees: masters.employees.filter(function (e) { return e.enabled; }).map(function (e) {
      return { employeeId: e.employeeId, name: e.name, division: e.division, section: e.section, defaultDeptCode: e.defaultDeptCode, jobTitle: e.jobTitle };
    }),
    departments: masters.departments.filter(function (d) { return d.enabled; }).sort(bySortOrder_).map(function (d) {
      return { deptCode: d.deptCode, deptName: d.deptName, division: d.division, commonDeptCode: d.commonDeptCode };
    }),
    categories: masters.categories.filter(function (c) { return c.enabled; }).sort(bySortOrder_).map(function (c) {
      return { categoryCode: c.categoryCode, categoryName: c.categoryName };
    }),
    approvers: masters.approvers.filter(function (a) { return a.enabled; }).map(function (a) {
      return { deptCode: a.deptCode, approverId: a.approverId, priority: a.priority };
    }),
    suppliers: masters.suppliers.filter(function (x) { return x.visible; }).map(function (x) {
      return { code: x.code, branch: x.branch, name: x.name, kana: x.kana, abbr: x.abbr };
    }),
    deliveries: masters.deliveries.filter(function (x) { return x.enabled; }).sort(bySortOrder_).map(function (x) {
      return { code: x.code, branch: x.branch, name: x.name };
    }),
    roleHolders: {
      admins: masters.roles.filter(function (r) { return r.enabled && r.role === ROLE_ADMIN; }).map(function (r) { return r.employeeId; }),
      accountings: masters.roles.filter(function (r) { return r.enabled && r.role === ROLE_ACCOUNTING; }).map(function (r) { return r.employeeId; })
    },
    limits: {
      attachmentMaxMb: s.ATTACHMENT_MAX_MB,
      attachmentAllowedExt: s.ATTACHMENT_ALLOWED_EXT,
      quantityDecimals: s.QUANTITY_DECIMALS,
      pinSessionMinutes: s.PIN_SESSION_MINUTES,
      pinLength: s.PIN_LENGTH
    },
    requiredFields: getRequiredFields()
  };
}

// =====================================================================
// 【Config】 シート名・列定義・ステータス・設定の既定値
// =====================================================================

const TZ = 'Asia/Tokyo';

const SHEETS = {
  REQUESTS: '届出データ',
  LOGS: '操作ログ',
  DEPARTMENTS: '部署マスタ',
  CATEGORIES: '種別マスタ',
  EMPLOYEES: '社員マスタ',
  APPROVERS: '承認者対応表',
  ROLES: '権限マスタ',
  PINS: '暗証番号',
  SUPPLIERS: '発注先マスタ',
  DELIVERIES: '納入先マスタ',
  MATERIALS: '資材マスタ',
  SETTINGS: '設定',
  FIELDS: '入力項目'
};

/** 列定義 [見出し, キー, 型]。型: T=書式なしテキスト, N=数値, B=TRUE/FALSE（03 データ設計） */
const COLUMNS = {
  REQUESTS: [
    ['届出ID', 'requestId', 'T'], ['ステータス', 'status', 'T'], ['削除フラグ', 'deleted', 'B'], ['バージョン', 'version', 'N'],
    ['部門コード', 'deptCode', 'T'], ['部門名', 'deptName', 'T'], ['種別コード', 'categoryCode', 'T'], ['種別名', 'categoryName', 'T'],
    ['入力者ID', 'applicantId', 'T'], ['入力者名', 'applicantName', 'T'], ['承認者ID', 'approverId', 'T'], ['承認者名', 'approverName', 'T'],
    ['発注先区分', 'supplierType', 'T'], ['発注先コード', 'supplierCode', 'T'], ['発注先枝番', 'supplierBranch', 'T'], ['発注先名', 'supplierName', 'T'],
    ['納入先区分', 'deliveryType', 'T'], ['納入先コード', 'deliveryCode', 'T'], ['納入先枝番', 'deliveryBranch', 'T'], ['納入先名', 'deliveryName', 'T'],
    ['購入物品名', 'itemName', 'T'], ['型番', 'modelNo', 'T'], ['数量', 'quantity', 'T'], ['単位・補足', 'unitNote', 'T'],
    ['理由', 'reason', 'T'], ['納品日', 'deliveryDate', 'T'],
    ['添付1ファイルID', 'att1FileId', 'T'], ['添付1ファイル名', 'att1FileName', 'T'], ['添付2ファイルID', 'att2FileId', 'T'], ['添付2ファイル名', 'att2FileName', 'T'],
    ['資材コード', 'materialCode', 'T'], ['資材枝番', 'materialBranch', 'T'], ['資材サブ枝番', 'materialSubBranch', 'T'], ['資材名', 'materialName', 'T'],
    ['入数', 'packQty', 'T'], ['資材コード確定フラグ', 'materialFixed', 'B'], ['資材確定者', 'materialFixedBy', 'T'], ['資材確定日時', 'materialFixedAt', 'T'],
    ['資材候補JSON', 'materialCandidates', 'T'], ['コード補完者', 'codeFilledBy', 'T'], ['コード補完日時', 'codeFilledAt', 'T'],
    ['作成日時', 'createdAt', 'T'], ['作成者', 'createdBy', 'T'], ['更新日時', 'updatedAt', 'T'], ['更新者', 'updatedBy', 'T'],
    ['提出日', 'submittedDate', 'T'], ['承認依頼日時', 'requestedAt', 'T'], ['承認依頼者', 'requestedBy', 'T'],
    ['承認依頼取消日時', 'requestCanceledAt', 'T'], ['承認依頼取消者', 'requestCanceledBy', 'T'],
    ['承認日時', 'approvedAt', 'T'], ['承認実施者', 'approvedBy', 'T'],
    ['差し戻し日時', 'rejectedAt', 'T'], ['差し戻し実施者', 'rejectedBy', 'T'], ['差し戻し理由', 'rejectReason', 'T'],
    ['承認取消日時', 'approvalCanceledAt', 'T'], ['承認取消者', 'approvalCanceledBy', 'T'],
    ['CSV出力済フラグ', 'csvExported', 'B'], ['CSV出力日時', 'csvExportedAt', 'T'], ['CSV出力者', 'csvExportedBy', 'T'], ['CSV出力回数', 'csvExportCount', 'N'],
    ['反映済日時', 'reflectedAt', 'T'], ['反映操作者', 'reflectedBy', 'T'],
    ['承認済に戻した日時', 'revertedAt', 'T'], ['承認済に戻した者', 'revertedBy', 'T'],
    ['削除日時', 'deletedAt', 'T'], ['削除者', 'deletedBy', 'T'], ['備考（システム）', 'sysNote', 'T']
  ],
  LOGS: [
    ['ログID', 'logId', 'T'], ['日時', 'loggedAt', 'T'], ['操作者ID', 'operatorId', 'T'], ['操作者名', 'operatorName', 'T'],
    ['役割', 'role', 'T'], ['届出ID', 'requestId', 'T'], ['操作', 'action', 'T'],
    ['変更前ステータス', 'statusBefore', 'T'], ['変更後ステータス', 'statusAfter', 'T'], ['詳細JSON', 'detail', 'T']
  ],
  DEPARTMENTS: [
    ['部署コード', 'deptCode', 'T'], ['部署名', 'deptName', 'T'], ['部', 'division', 'T'],
    ['共通部署コード', 'commonDeptCode', 'T'], ['表示順', 'sortOrder', 'N'], ['有効', 'enabled', 'B']
  ],
  CATEGORIES: [
    ['種別コード', 'categoryCode', 'T'], ['種別名', 'categoryName', 'T'], ['表示順', 'sortOrder', 'N'], ['有効', 'enabled', 'B']
  ],
  EMPLOYEES: [
    ['社員ID', 'employeeId', 'T'], ['氏名', 'name', 'T'], ['メール', 'mail', 'T'], ['部', 'division', 'T'], ['課', 'section', 'T'],
    ['既定部署コード', 'defaultDeptCode', 'T'], ['役職', 'jobTitle', 'T'], ['有効', 'enabled', 'B'], ['取込日時', 'importedAt', 'T']
  ],
  APPROVERS: [
    ['部署コード', 'deptCode', 'T'], ['承認者ID', 'approverId', 'T'], ['承認者名', 'approverName', 'T'], ['優先順', 'priority', 'N'], ['有効', 'enabled', 'B']
  ],
  ROLES: [
    ['社員ID', 'employeeId', 'T'], ['氏名', 'name', 'T'], ['役割', 'role', 'T'], ['有効', 'enabled', 'B']
  ],
  PINS: [
    ['社員ID', 'employeeId', 'T'], ['ソルト', 'salt', 'T'], ['ハッシュ', 'hash', 'T'], ['失敗回数', 'failCount', 'N'],
    ['ロック解除日時', 'lockedUntil', 'T'], ['発行日時', 'issuedAt', 'T'], ['発行者', 'issuedBy', 'T']
  ],
  SUPPLIERS: [
    ['取引先コード', 'code', 'T'], ['枝番', 'branch', 'T'], ['名称', 'name', 'T'], ['カナ', 'kana', 'T'], ['略称', 'abbr', 'T'],
    ['科目名2', 'account2', 'T'], ['表示', 'visible', 'B'], ['取込日時', 'importedAt', 'T']
  ],
  DELIVERIES: [
    ['取引先コード', 'code', 'T'], ['枝番', 'branch', 'T'], ['名称', 'name', 'T'], ['表示順', 'sortOrder', 'N'], ['有効', 'enabled', 'B']
  ],
  MATERIALS: [
    ['MaterialCode', 'code', 'T'], ['MaterialBranchCode', 'branch', 'T'], ['MaterialBranchCodeSub', 'subBranch', 'T'],
    ['MaterialName', 'name', 'T'], ['MaterialNameInCompany', 'nameInCompany', 'T'], ['MaterialType', 'type', 'T'], ['資材種別名', 'typeName', 'T'],
    ['入数', 'packQty', 'T'], ['MakerCode', 'makerCode', 'T'], ['MakerBranchCode', 'makerBranch', 'T'], ['メーカー略称', 'makerAbbr', 'T'],
    ['StockCode', 'stockCode', 'T'], ['StockBranchCode', 'stockBranch', 'T'], ['在庫先略称', 'stockAbbr', 'T'],
    ['DepartmentCode', 'deptCode', 'T'], ['DepartmentName', 'deptName', 'T'], ['購入形態名', 'purchaseTypeName', 'T'], ['Invalid', 'invalid', 'T']
  ],
  SETTINGS: [
    ['キー', 'key', 'T'], ['値', 'value', 'T'], ['説明', 'description', 'T']
  ],
  FIELDS: [
    ['キー', 'key', 'T'], ['項目', 'label', 'T'], ['必須', 'required', 'B'], ['説明', 'description', 'T']
  ]
};

/**
 * 必須・任意を「入力項目」シートで切り替えられる項目 [キー, 項目名, 初期値（必須か）, 説明]（03 §3.11）
 * 部門・承認者は承認の流れに必要なため、常に必須でここには載せない。
 */
const FIELD_REQUIREMENTS = [
  ['categoryCode', '種別', true, '資材候補の判定に使う'],
  ['supplier', '発注先', true, '任意にすると、空のとき CSV の発注先コードも空になる'],
  ['delivery', '納入先', true, '任意にすると、空のとき CSV の納入先コードも空になる'],
  ['itemName', '購入物品名', true, ''],
  ['modelNo', '型番', false, ''],
  ['quantity', '数量', true, '任意にすると、空のとき CSV の数量も空になる'],
  ['unitNote', '単位・補足', false, ''],
  ['deliveryDate', '納品日', false, '空なら、CSV の納期は提出日の月末になる'],
  ['reason', '理由', true, ''],
  ['attachment1', '添付1（見積書など）', false, '入力完了・承認依頼のときにファイルが必要になる'],
  ['attachment2', '添付2（納品書）', false, '入力完了・承認依頼のときにファイルが必要になる']
];

const STATUS = {
  DRAFT: '一時保存',
  COMPLETED: '入力完了',
  REQUESTED: '承認依頼中',
  REJECTED: '差し戻し',
  APPROVED: '承認済',
  REFLECTED: 'システム反映済'
};
const STATUS_NEW = '(新規)';
const STATUS_ORDER = [STATUS.DRAFT, STATUS.COMPLETED, STATUS.REQUESTED, STATUS.REJECTED, STATUS.APPROVED, STATUS.REFLECTED];

const ROLE_ADMIN = '管理者';
const ROLE_ACCOUNTING = '経理';
const ROLE_LABELS = { applicant: '入力者', approver: '承認者', admin: '管理者', accounting: '経理', system: 'システム' };

const PARTY_TYPES = { MASTER: 'マスタ', MANUAL: '手入力', NONE: '指定なし' };

/** action キーと操作名（04 §12） */
const ACTIONS = {
  SAVE_DRAFT: '一時保存', COMPLETE: '入力完了', REQUEST: '承認依頼', CANCEL_REQUEST: '承認依頼取消',
  APPROVE: '承認', REJECT: '差し戻し', CANCEL_APPROVAL: '承認取消', EDIT: '修正', DELETE: '削除',
  ATTACH_ADD: '添付追加', ATTACH_REPLACE: '添付差替', ATTACH_DELETE: '添付削除',
  FIX_MATERIAL: '資材確定', RECALC_MATERIAL: '資材候補再計算', FILL_CODE: 'コード補完',
  EXPORT_CSV: 'CSV出力', MARK_REFLECTED: '反映済', REVERT_REFLECTED: '承認済に戻す',
  IMPORT_MASTER: 'マスタ取込', ISSUE_PIN: '暗証番号発行',
  AUTH_SUCCESS: '認証成功', AUTH_FAIL: '認証失敗', AUTH_LOCK: '認証ロック'
};

/** 設定の既定値 [値（文字列）, 説明]（03 §3.10） */
const DEFAULT_SETTINGS = {
  APP_NAME: ['物品購入届', '画面のタイトル'],
  ATTACHMENT_FOLDER_ID: ['', '添付書類フォルダのID（初期セットアップで設定）'],
  IMPORT_FOLDER_ID: ['', 'マスタ取込フォルダのID（初期セットアップで設定）'],
  BACKUP_FOLDER_ID: ['', 'バックアップフォルダのID（初期セットアップで設定）'],
  PIN_LENGTH: ['6', '発行する暗証番号の桁数'],
  PIN_SESSION_MINUTES: ['30', '認証が有効な時間（分）'],
  PIN_MAX_FAILS: ['5', '続けて誤るとロックする回数'],
  PIN_LOCK_MINUTES: ['15', 'ロックする時間（分）'],
  CSV_COLUMNS: ['SUPPLIER_CODE,DELIVERY_CODE,MATERIAL_CODE,PACK_QTY,QUANTITY,DUE_DATE', '出力する列キーと順序'],
  CSV_HEADER_NAMES: ['発注先コード,納入先コード,資材コード,入数,数量,納期', '見出し名（CSV_COLUMNS と同じ数）'],
  CSV_HEADER: ['TRUE', '見出し行を出すか'],
  CSV_DATE_FORMAT: ['yyyyMMdd', '納期の書式'],
  CSV_CHARSET: ['Shift_JIS', '文字コード'],
  CSV_DELIMITER: [',', '区切り文字（タブは \\t と書く）'],
  CSV_LINE_ENDING: ['CRLF', 'CRLF または LF'],
  CSV_QUOTE_MODE: ['MINIMAL', 'MINIMAL（必要なときだけ囲む）または ALL'],
  CSV_FILENAME_PATTERN: ['物品購入届_{yyyyMMddHHmmss}.csv', '{} の中は日時の書式'],
  NOTIFY_ENABLED: ['FALSE', 'メール通知（初版は FALSE）'],
  STATUS_COLORS: ['{"一時保存":{"bg":"#f1f5f9","fg":"#475569"},"入力完了":{"bg":"#e0f2fe","fg":"#0369a1"},"承認依頼中":{"bg":"#fef3c7","fg":"#b45309"},"差し戻し":{"bg":"#fee2e2","fg":"#dc2626"},"承認済":{"bg":"#d1fae5","fg":"#059669"},"システム反映済":{"bg":"#ede9fe","fg":"#6d28d9"}}', 'ステータスごとの地（bg）と文字（fg）の色'],
  ATTACHMENT_MAX_MB: ['10', '添付1ファイルの上限（MB）'],
  ATTACHMENT_ALLOWED_EXT: ['pdf,jpg,jpeg,png,xls,xlsx', '許可する拡張子'],
  QUANTITY_DECIMALS: ['3', '数量の小数の最大桁数'],
  MATERIAL_CANDIDATE_LIMIT: ['10', '保存する資材候補の件数'],
  REQUEST_ID_PREFIX: ['PR', '届出IDの接頭辞'],
  MASTER_CACHE_SECONDS: ['21600', 'マスタをキャッシュする秒数（上限21600）'],
  SUPPLIER_VISIBLE_ACCOUNTS: ['買掛金,未払金', '新しく取り込んだ発注先を表示にする科目名2']
};
const NUMBER_SETTING_KEYS = ['PIN_LENGTH', 'PIN_SESSION_MINUTES', 'PIN_MAX_FAILS', 'PIN_LOCK_MINUTES', 'ATTACHMENT_MAX_MB', 'QUANTITY_DECIMALS', 'MATERIAL_CANDIDATE_LIMIT', 'MASTER_CACHE_SECONDS'];
const BOOL_SETTING_KEYS = ['CSV_HEADER', 'NOTIFY_ENABLED'];
const JSON_SETTING_KEYS = ['STATUS_COLORS'];

/** 取込ファイル名と文字コード（K-19） */
const IMPORT_FILES = {
  MATERIALS: { fileName: '資材マスター.csv', charset: 'MS932' },
  SUPPLIERS: { fileName: '取引先マスター.csv', charset: 'MS932' },
  EMPLOYEES: { fileName: '365User.csv', charset: 'UTF-8' }
};

function getSettings() {
  if (EXEC_.settings) return EXEC_.settings;
  const raw = {};
  try {
    readAll('SETTINGS').forEach(function (r) { if (r.key) raw[r.key] = r.value; });
  } catch (e) { /* シートが無いときは既定値 */ }
  EXEC_.settings = parseSettings_(raw);
  return EXEC_.settings;
}

/** 設定の型変換（純粋な関数） */
function parseSettings_(raw) {
  const out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    let v = (raw[key] !== undefined && raw[key] !== '') ? String(raw[key]) : DEFAULT_SETTINGS[key][0];
    if (NUMBER_SETTING_KEYS.indexOf(key) >= 0) {
      const n = Number(v); out[key] = isNaN(n) ? Number(DEFAULT_SETTINGS[key][0]) : n;
    } else if (BOOL_SETTING_KEYS.indexOf(key) >= 0) {
      out[key] = String(v).toUpperCase() === 'TRUE';
    } else if (JSON_SETTING_KEYS.indexOf(key) >= 0) {
      try { out[key] = JSON.parse(v); } catch (e) { out[key] = JSON.parse(DEFAULT_SETTINGS[key][0]); }
    } else if (key === 'CSV_DELIMITER') {
      out[key] = v === '\\t' ? '\t' : v;
    } else {
      out[key] = v;
    }
  });
  Object.keys(raw).forEach(function (k) { if (out[k] === undefined) out[k] = raw[k]; });
  return out;
}

function getSetting(key) {
  return getSettings()[key];
}

/** 入力項目シートの行から {キー: 必須か} を作る（純粋な関数）。行が無い項目は初期値、知らないキーは無視する */
function parseRequiredFields_(rows) {
  const out = {};
  FIELD_REQUIREMENTS.forEach(function (f) { out[f[0]] = f[2]; });
  (rows || []).forEach(function (r) {
    const key = String(r.key || '').trim();
    if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = r.required === true || String(r.required).toUpperCase() === 'TRUE';
  });
  return out;
}

/** 必須にする項目 {キー: true/false}。シートが無いときは初期値（設定と同じく、マスタのキャッシュには入れない） */
function getRequiredFields() {
  if (EXEC_.requiredFields) return EXEC_.requiredFields;
  let rows = [];
  try { rows = readAll('FIELDS'); } catch (e) { rows = []; }
  EXEC_.requiredFields = parseRequiredFields_(rows);
  return EXEC_.requiredFields;
}

// =====================================================================
// 【Utils】 エラー・日付・文字の正規化・キャッシュ
// =====================================================================

/** 1回の実行（リクエスト）の間だけ使うメモリ上のキャッシュ */
let EXEC_ = {};
function resetExecutionCache_() { EXEC_ = {}; }

/** 想定したエラー。throw AppError('VALIDATION', 'メッセージ', {項目: 'メッセージ'}) */
function AppError(code, message, fields) {
  const e = new Error(message);
  e.isAppError = true;
  e.code = code;
  e.fields = fields || null;
  return e;
}

function formatDate(date, fmt) {
  return Utilities.formatDate(date, TZ, fmt);
}
function nowString() { return formatDate(new Date(), 'yyyy/MM/dd HH:mm:ss'); }
function todayString() { return formatDate(new Date(), 'yyyy/MM/dd'); }

/** 全角英数記号を半角にする */
function toHalfWidth(str) {
  return String(str == null ? '' : str)
    .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/　/g, ' ');
}

/** サロゲートペアを1文字として数える */
function charLength(str) { return Array.from(String(str == null ? '' : str)).length; }

function toBool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function toStr_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    const hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    return formatDate(v, hasTime ? 'yyyy/MM/dd HH:mm:ss' : 'yyyy/MM/dd');
  }
  return String(v);
}

function stripSpaces_(s) { return String(s == null ? '' : s).replace(/[\s　]/g, ''); }

function bySortOrder_(a, b) { return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); }

function addMinutes_(date, minutes) { return new Date(date.getTime() + minutes * 60000); }

/** 'yyyy/MM/dd HH:mm:ss' を Date にする（Asia/Tokyo とみなす） */
function parseDateTime_(s) {
  const m = String(s || '').match(/^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0) - 9, +(m[5] || 0), +(m[6] || 0)));
}

/** 100KB を超える値を分けてキャッシュする */
const CACHE_CHUNK_SIZE = 25000;
function chunkCachePut(key, obj, seconds) {
  const cache = CacheService.getScriptCache();
  const json = JSON.stringify(obj);
  const n = Math.ceil(json.length / CACHE_CHUNK_SIZE) || 1;
  const map = {};
  for (let i = 0; i < n; i++) map[key + '#' + i] = json.substr(i * CACHE_CHUNK_SIZE, CACHE_CHUNK_SIZE);
  map[key + '#n'] = String(n);
  try { cache.putAll(map, Math.min(seconds || 21600, 21600)); } catch (e) { console.warn('キャッシュに保存できません: ' + e); }
}
function chunkCacheGet(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + '#n'));
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '#' + i);
  const got = cache.getAll(keys);
  let json = '';
  for (let i = 0; i < n; i++) {
    if (got[key + '#' + i] === undefined || got[key + '#' + i] === null) return null;
    json += got[key + '#' + i];
  }
  try { return JSON.parse(json); } catch (e) { return null; }
}
function chunkCacheRemove(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + '#n')) || 0;
  const keys = [key + '#n'];
  for (let i = 0; i < n; i++) keys.push(key + '#' + i);
  cache.removeAll(keys);
}

// =====================================================================
// 【Repository】 シートの読み書き・ロック・採番・ログ・マスタのキャッシュ
// =====================================================================

function getSpreadsheet_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function getSheet(key) {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS[key]);
  if (!sheet) throw AppError('SYSTEM', '「' + SHEETS[key] + '」シートがありません。メニュー「物品購入届 > 初期セットアップ」を実行してください');
  return sheet;
}

function headerIndex_(headers) {
  const idx = {};
  headers.forEach(function (h, i) { const k = String(h).trim(); if (k && idx[k] === undefined) idx[k] = i; });
  return idx;
}

function convertIn_(v, t) {
  if (t === 'N') return (v === '' || v === null || v === undefined) ? 0 : (Number(v) || 0);
  if (t === 'B') return toBool_(v);
  return toStr_(v);
}

function convertOut_(v, t) {
  if (t === 'N') return (v === '' || v === null || v === undefined) ? 0 : (Number(v) || 0);
  if (t === 'B') return toBool_(v);
  let s = (v === null || v === undefined) ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // 数式として解釈させない
  return s;
}

function formatOf_(t) { return t === 'T' ? '@' : (t === 'N' ? '0' : 'General'); }

/** シートの全行をオブジェクトの配列で返す（_row に行番号） */
function readAll(key) {
  const sheet = getSheet(key);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const idx = headerIndex_(values[0]);
  const defs = COLUMNS[key];
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    let empty = true;
    for (let c = 0; c < row.length; c++) { if (row[c] !== '' && row[c] !== null) { empty = false; break; } }
    if (empty) continue;
    const o = { _row: r + 1 };
    defs.forEach(function (d) {
      const i = idx[d[0]];
      o[d[1]] = convertIn_(i === undefined ? '' : row[i], d[2]);
    });
    out.push(o);
  }
  return out;
}

/** 複数行を startRow から書く。既知の列だけを上書きし、それ以外の列は残す */
function writeRows_(key, startRow, objs) {
  if (!objs.length) return;
  const sheet = getSheet(key);
  const needRows = startRow + objs.length - 1;
  if (needRows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needRows - sheet.getMaxRows());
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = headerIndex_(headers);
  const defs = COLUMNS[key];
  const range = sheet.getRange(startRow, 1, objs.length, lastCol);
  const lastRow = sheet.getLastRow();
  const current = startRow <= lastRow ? range.getValues() : null;
  const currentFormats = range.getNumberFormats();
  const values = [];
  const formats = [];
  objs.forEach(function (obj, r) {
    const row = current && current[r] ? current[r].slice() : new Array(lastCol).fill('');
    const fmt = currentFormats[r] ? currentFormats[r].slice() : new Array(lastCol).fill('General');
    defs.forEach(function (d) {
      const i = idx[d[0]];
      if (i === undefined) return;
      row[i] = convertOut_(obj[d[1]], d[2]);
      fmt[i] = formatOf_(d[2]);
    });
    values.push(row);
    formats.push(fmt);
  });
  range.setNumberFormats(formats);
  range.setValues(values);
}

function appendRows_(key, objs) {
  if (!objs.length) return 0;
  const sheet = getSheet(key);
  const start = Math.max(sheet.getLastRow(), 1) + 1;
  writeRows_(key, start, objs);
  return start;
}

/** データ行をすべて入れ替える */
function replaceAll_(key, objs) {
  const sheet = getSheet(key);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (objs.length) writeRows_(key, 2, objs);
}

/** 更新処理をスクリプトロックで直列化する（04 §11） */
function withLock(fn) {
  if (EXEC_.lockDepth) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw AppError('BUSY', '混み合っています。少し待ってからもう一度お試しください');
  EXEC_.lockDepth = 1;
  try {
    return fn();
  } finally {
    EXEC_.lockDepth = 0;
    lock.releaseLock();
  }
}

function findRequest_(requestId) {
  if (!requestId) return null;
  const rows = readAll('REQUESTS');
  for (let i = 0; i < rows.length; i++) if (rows[i].requestId === requestId) return rows[i];
  return null;
}

function findRowIndex(requestId) {
  const r = findRequest_(requestId);
  return r ? r._row : -1;
}

function getRequest(requestId) { return findRequest_(requestId); }

function insertRequest(obj) {
  const row = appendRows_('REQUESTS', [obj]);
  obj._row = row;
  return row;
}

function updateRequest(rowIndex, obj) { writeRows_('REQUESTS', rowIndex, [obj]); }

function appendLog(entry) {
  appendRows_('LOGS', [{
    logId: Utilities.getUuid(), loggedAt: nowString(),
    operatorId: entry.operatorId || '', operatorName: entry.operatorName || '',
    role: entry.role || '', requestId: entry.requestId || '', action: entry.action || '',
    statusBefore: entry.statusBefore || '', statusAfter: entry.statusAfter || '',
    detail: entry.detail ? (typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)) : ''
  }]);
}

/** 届出IDの採番（純粋な関数。04 §8） */
function computeNextRequestId_(existingIds, prefix, ymd) {
  const head = prefix + '-' + ymd + '-';
  let max = 0;
  existingIds.forEach(function (id) {
    if (String(id).indexOf(head) === 0) {
      const n = parseInt(String(id).substr(head.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  const next = max + 1;
  return head + (next < 1000 ? ('00' + next).slice(-3) : String(next));
}

function nextRequestId(today) {
  const ymd = String(today).replace(/\//g, '');
  const ids = readAll('REQUESTS').map(function (r) { return r.requestId; });
  return computeNextRequestId_(ids, getSetting('REQUEST_ID_PREFIX'), ymd);
}

const MASTER_CACHE_KEY = 'masters:v1';

/** 画面と判定で使うマスタ（資材と暗証番号は含めない） */
function getMasters() {
  if (EXEC_.masters) return EXEC_.masters;
  let m = chunkCacheGet(MASTER_CACHE_KEY);
  if (!m) {
    const strip = function (rows) { return rows.map(function (r) { const o = Object.assign({}, r); delete o._row; return o; }); };
    m = {
      departments: strip(readAll('DEPARTMENTS')),
      categories: strip(readAll('CATEGORIES')),
      employees: strip(readAll('EMPLOYEES')),
      approvers: strip(readAll('APPROVERS')),
      roles: strip(readAll('ROLES')),
      suppliers: strip(readAll('SUPPLIERS')),
      deliveries: strip(readAll('DELIVERIES'))
    };
    chunkCachePut(MASTER_CACHE_KEY, m, getSetting('MASTER_CACHE_SECONDS'));
  }
  EXEC_.masters = m;
  return m;
}

function clearMasterCache() {
  chunkCacheRemove(MASTER_CACHE_KEY);
  EXEC_.masters = null;
}

function findEmployee_(masters, employeeId) {
  for (let i = 0; i < masters.employees.length; i++) if (masters.employees[i].employeeId === employeeId) return masters.employees[i];
  return null;
}
function employeeName_(masters, employeeId) {
  if (!employeeId) return '';
  const e = findEmployee_(masters, employeeId);
  return e ? e.name : employeeId;
}

// =====================================================================
// 【Auth】 暗証番号・トークン・役割の判定
// =====================================================================

function hashPin_(salt, pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function generatePin_(length) {
  let digits = '';
  while (digits.length < length) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random(), Utilities.Charset.UTF_8);
    bytes.forEach(function (b) {
      const u = (b + 256) % 256;
      if (u < 250 && digits.length < length) digits += String(u % 10); // 偏りを避ける
    });
  }
  return digits;
}

/**
 * 管理者が指定する暗証番号の形式チェック（純粋な関数。K-13）
 * 数字だけで、桁数は PIN_LENGTH と同じ。推測しやすい番号（123456 など）も許可する。全角数字は半角に直す
 */
function validatePin_(pin, length) {
  const s = toHalfWidth(pin).trim();
  if (!s) return { ok: false, value: '', message: '暗証番号を入力してください' };
  if (!/^\d+$/.test(s)) return { ok: false, value: s, message: '暗証番号は数字だけで入力してください' };
  if (s.length !== Number(length)) return { ok: false, value: s, message: '暗証番号は' + length + '桁の数字で入力してください' };
  return { ok: true, value: s, message: '' };
}

/**
 * 暗証番号を設定し、平文を1回だけ返す（K-13）
 * pinOverride: 管理者が指定した番号（形式チェック済みのもの）、または開発用のサンプルデータの番号。空ならランダムに作る
 */
function issuePin(employeeId, issuedBy, pinOverride) {
  if (!employeeId) throw AppError('VALIDATION', '社員IDを指定してください');
  return withLock(function () {
    const pin = pinOverride ? String(pinOverride) : generatePin_(getSetting('PIN_LENGTH'));
    const salt = Utilities.getUuid();
    const rec = { employeeId: employeeId, salt: salt, hash: hashPin_(salt, pin), failCount: 0, lockedUntil: '', issuedAt: nowString(), issuedBy: issuedBy || '' };
    const rows = readAll('PINS');
    const found = rows.filter(function (r) { return r.employeeId === employeeId; })[0];
    if (found) writeRows_('PINS', found._row, [rec]); else appendRows_('PINS', [rec]);
    const masters = getMasters();
    appendLog({ operatorId: issuedBy || '', operatorName: employeeName_(masters, issuedBy), role: ROLE_LABELS.admin, action: ACTIONS.ISSUE_PIN, detail: { employeeId: employeeId, mode: pinOverride ? '指定' : 'ランダム' } });
    return { pin: pin };
  });
}

function createSession_(employeeId) {
  const minutes = getSetting('PIN_SESSION_MINUTES');
  const token = Utilities.getUuid();
  const expiresAt = addMinutes_(new Date(), minutes);
  CacheService.getScriptCache().put('auth:' + token, JSON.stringify({ employeeId: employeeId, expiresAt: expiresAt.getTime() }), Math.min(minutes * 60, 21600));
  return { token: token, expiresAt: formatDate(expiresAt, 'yyyy/MM/dd HH:mm:ss'), expiresAtMs: expiresAt.getTime() };
}

function authenticateImpl_(operatorId, pin) {
  const masters = getMasters();
  const emp = findEmployee_(masters, operatorId);
  if (!emp || !emp.enabled) throw AppError('FORBIDDEN', '操作者が社員マスタに登録されていないか、無効です');
  return withLock(function () {
    const rows = readAll('PINS');
    const rec = rows.filter(function (r) { return r.employeeId === operatorId; })[0];
    if (!rec || !rec.hash) throw AppError('AUTH_FAILED', '暗証番号が未発行です。管理者に連絡してください');
    const now = new Date();
    const lockedUntil = parseDateTime_(rec.lockedUntil);
    if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
      throw AppError('AUTH_LOCKED', 'ロック中です。' + formatDate(lockedUntil, 'HH:mm') + ' 以降にお試しください');
    }
    if (hashPin_(rec.salt, String(pin || '')) !== rec.hash) {
      rec.failCount = (rec.failCount || 0) + 1;
      const max = getSetting('PIN_MAX_FAILS');
      let locked = false;
      if (rec.failCount >= max) {
        rec.lockedUntil = formatDate(addMinutes_(now, getSetting('PIN_LOCK_MINUTES')), 'yyyy/MM/dd HH:mm:ss');
        rec.failCount = 0;
        locked = true;
      }
      writeRows_('PINS', rec._row, [rec]);
      appendLog({ operatorId: operatorId, operatorName: emp.name, role: '', action: locked ? ACTIONS.AUTH_LOCK : ACTIONS.AUTH_FAIL });
      if (locked) throw AppError('AUTH_LOCKED', '暗証番号を続けて誤ったため、ロックしました。' + rec.lockedUntil.substr(11, 5) + ' 以降にお試しください');
      throw AppError('AUTH_FAILED', '暗証番号が違います（残り' + (max - rec.failCount) + '回）');
    }
    if (rec.failCount || rec.lockedUntil) {
      rec.failCount = 0; rec.lockedUntil = '';
      writeRows_('PINS', rec._row, [rec]);
    }
    appendLog({ operatorId: operatorId, operatorName: emp.name, role: '', action: ACTIONS.AUTH_SUCCESS });
    return createSession_(operatorId);
  });
}

function verifyToken(ctx) {
  if (!ctx || !ctx.token || !ctx.operatorId) return false;
  const raw = CacheService.getScriptCache().get('auth:' + ctx.token);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    return s.employeeId === ctx.operatorId && s.expiresAt > Date.now();
  } catch (e) { return false; }
}

function logoutImpl_(ctx) {
  if (ctx && ctx.token) CacheService.getScriptCache().remove('auth:' + ctx.token);
  return {};
}

/** 役割の判定（純粋な関数。04 §3.1） */
function resolveRoles(operatorId, request, masters) {
  const isAdmin = masters.roles.some(function (r) { return r.enabled && r.role === ROLE_ADMIN && r.employeeId === operatorId; });
  const isAccounting = masters.roles.some(function (r) { return r.enabled && r.role === ROLE_ACCOUNTING && r.employeeId === operatorId; });
  const isApplicant = !request || request.applicantId === operatorId;
  const isApprover = !!request && !!request.approverId && request.approverId === operatorId && request.applicantId !== operatorId;
  return { applicant: isApplicant, approver: isApprover, admin: isAdmin, accounting: isAccounting };
}

function requireOperator_(ctx, masters) {
  if (!ctx || !ctx.operatorId) throw AppError('FORBIDDEN', '操作者を選択してください');
  const emp = findEmployee_(masters, ctx.operatorId);
  if (!emp || !emp.enabled) throw AppError('FORBIDDEN', '操作者が社員マスタに登録されていないか、無効です');
  return emp;
}

/** 権限・遷移・暗証番号の判定（04 §3.3）。使った役割（applicant など）を返す */
function requireAuthIfNeeded(ctx, action, request, masters) {
  const isNew = !request || !request.requestId;
  const status = isNew ? STATUS_NEW : request.status;
  const t = TRANSITIONS[action];
  if (t && t.from.indexOf(status) < 0) throw AppError('INVALID_STATE', '「' + status + '」の届出には「' + ACTIONS[action] + '」を行えません');
  const table = PERMISSIONS[action] || {};
  if (!table[status] && !table['*']) throw AppError('INVALID_STATE', '「' + status + '」の届出には「' + ACTIONS[action] + '」を行えません');
  const roles = resolveRoles(ctx.operatorId, isNew ? null : request, masters);
  const role = canPerform(action, status, roles);
  if (!role) throw AppError('FORBIDDEN', 'この操作を行う権限がありません');
  if (role !== 'applicant' && !verifyToken(ctx)) throw AppError('AUTH_REQUIRED', '承認者・管理者・経理として操作するには、暗証番号の入力が必要です');
  return role;
}

/** 届出に関係しない権限の判定（資材の検索・管理者の操作など） */
function requirePrivileged_(ctx, roleKeys, masters) {
  requireOperator_(ctx, masters);
  const roles = resolveRoles(ctx.operatorId, null, masters);
  const ok = roleKeys.some(function (k) { return roles[k]; });
  if (!ok) throw AppError('FORBIDDEN', 'この操作を行う権限がありません');
  if (!verifyToken(ctx)) throw AppError('AUTH_REQUIRED', 'この操作には暗証番号の入力が必要です');
  return roleKeys.filter(function (k) { return roles[k]; })[0];
}

// =====================================================================
// 【Validator】 入力チェック（04 §4.1。純粋な関数）
// =====================================================================

const LIMITS = { itemName: 100, modelNo: 100, unitNote: 20, reason: 500, partyName: 100, rejectReason: 500 };

/** 数量の正規化（K-34）。{ok, value, message} */
function normalizeQuantity(str, decimals) {
  let s = toHalfWidth(str).trim().replace(/,/g, '');
  if (s === '') return { ok: false, value: '', message: '必須です' };
  const re = new RegExp('^\\d+(\\.\\d{1,' + decimals + '})?$');
  if (/^\d+\.\d+$/.test(s) && !re.test(s)) return { ok: false, value: s, message: '小数は第' + decimals + '位までにしてください' };
  if (!re.test(s)) return { ok: false, value: s, message: '0より大きい数値を入力してください' };
  s = s.replace(/^0+(?=\d)/, '');
  if (Number(s) <= 0) return { ok: false, value: s, message: '0より大きい数値を入力してください' };
  return { ok: true, value: s, message: '' };
}

/** 'yyyy/MM/dd' または 'yyyy-MM-dd' を検査し、'yyyy/MM/dd' を返す（不正なら null） */
function isValidDate(str) {
  const m = String(str || '').trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return null;
  const last = new Date(y, mo, 0).getDate();
  if (d > last) return null;
  return y + '/' + ('0' + mo).slice(-2) + '/' + ('0' + d).slice(-2);
}

function getApproverCandidates_(masters, deptCode, applicantId) {
  return masters.approvers
    .filter(function (a) { return a.enabled && a.deptCode === String(deptCode || '') && a.approverId !== applicantId; })
    .filter(function (a) { const e = findEmployee_(masters, a.approverId); return e && e.enabled; })
    .sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); })
    .map(function (a) { return { employeeId: a.approverId, name: employeeName_(masters, a.approverId), priority: a.priority }; });
}

/**
 * 届出の入力チェック。level は 'FORMAT'（形式のみ）か 'FULL'（必須＋形式）
 * 戻り値 {errors: {キー: メッセージ}, value: 正規化した値}
 */
function validateRequest(payload, level, masters, applicantId, required) {
  payload = payload || {};
  const full = level === 'FULL';
  if (!required) { try { required = getRequiredFields(); } catch (e) { required = parseRequiredFields_([]); } }
  const isReq = function (key) { return full && required[key] === true; };
  const errors = {};
  const s = function (v) { return (v === null || v === undefined) ? '' : String(v).trim(); };
  const p = {
    deptCode: s(payload.deptCode), categoryCode: s(payload.categoryCode), approverId: s(payload.approverId),
    supplierType: s(payload.supplierType), supplierCode: s(payload.supplierCode), supplierBranch: s(payload.supplierBranch), supplierName: s(payload.supplierName),
    deliveryType: s(payload.deliveryType), deliveryCode: s(payload.deliveryCode), deliveryBranch: s(payload.deliveryBranch), deliveryName: s(payload.deliveryName),
    itemName: s(payload.itemName), modelNo: s(payload.modelNo), quantity: s(payload.quantity), unitNote: s(payload.unitNote),
    reason: s(payload.reason), deliveryDate: s(payload.deliveryDate)
  };
  // 部門・承認者は常に必須。それ以外は入力項目シートで決める（required）
  const req = function (key, label) { if (full && !p[key]) errors[key] = (label || '') + '必須です'; };
  const reqIf = function (key) { if (isReq(key) && !p[key]) errors[key] = '必須です'; };
  const max = function (key, n) { if (p[key] && charLength(p[key]) > n) errors[key] = n + '文字以内で入力してください'; };

  req('deptCode');
  if (p.deptCode && !masters.departments.some(function (d) { return d.enabled && d.deptCode === p.deptCode; })) errors.deptCode = '部門を選び直してください';
  reqIf('categoryCode');
  if (p.categoryCode && !masters.categories.some(function (c) { return c.enabled && c.categoryCode === p.categoryCode; })) errors.categoryCode = '種別を選び直してください';

  req('approverId');
  if (p.approverId) {
    const cands = getApproverCandidates_(masters, p.deptCode, applicantId);
    if (!cands.some(function (c) { return c.employeeId === p.approverId; })) errors.approverId = '選んだ承認者は、この部門の承認者ではありません';
  } else if (full && p.deptCode && !errors.deptCode && getApproverCandidates_(masters, p.deptCode, applicantId).length === 0) {
    errors.approverId = 'この部署の承認者が登録されていません。管理者に連絡してください';
  }

  ['supplier', 'delivery'].forEach(function (kind) {
    const typeKey = kind + 'Type', codeKey = kind + 'Code', branchKey = kind + 'Branch', nameKey = kind + 'Name';
    const list = kind === 'supplier' ? masters.suppliers : masters.deliveries;
    const type = p[typeKey];
    if (!type) { if (isReq(kind)) errors[typeKey] = '選択してください'; p[codeKey] = ''; p[branchKey] = ''; p[nameKey] = ''; return; }
    if ([PARTY_TYPES.MASTER, PARTY_TYPES.MANUAL, PARTY_TYPES.NONE].indexOf(type) < 0) { errors[typeKey] = '区分が正しくありません'; return; }
    if (type === PARTY_TYPES.MASTER) {
      if (!p[codeKey]) { if (full) errors[codeKey] = 'マスタから選択してください'; p[nameKey] = ''; return; }
      const rec = list.filter(function (x) { return x.code === p[codeKey] && (x.branch || '') === p[branchKey]; })[0];
      if (!rec) { errors[codeKey] = 'マスタに無いコードです'; return; }
      p[nameKey] = rec.name;
    } else if (type === PARTY_TYPES.MANUAL) {
      p[codeKey] = ''; p[branchKey] = '';
      if (!p[nameKey]) { if (full) errors[nameKey] = '名称を入力してください'; }
      else if (charLength(p[nameKey]) > LIMITS.partyName) errors[nameKey] = LIMITS.partyName + '文字以内で入力してください';
    } else {
      p[codeKey] = ''; p[branchKey] = ''; p[nameKey] = '';
    }
  });

  reqIf('itemName'); max('itemName', LIMITS.itemName);
  reqIf('modelNo'); max('modelNo', LIMITS.modelNo);
  reqIf('unitNote'); max('unitNote', LIMITS.unitNote);
  reqIf('reason'); max('reason', LIMITS.reason);

  if (p.quantity) {
    const q = normalizeQuantity(p.quantity, getQuantityDecimals_());
    if (q.ok) p.quantity = q.value; else errors.quantity = q.message;
  } else if (isReq('quantity')) {
    errors.quantity = '必須です';
  }

  if (p.deliveryDate) {
    const d = isValidDate(p.deliveryDate);
    if (d) p.deliveryDate = d; else errors.deliveryDate = '正しい日付を入力してください';
  } else {
    reqIf('deliveryDate');
  }

  // 添付は payload.attachments = {1: 付いているか, 2: …}（保存の後にアップロードするファイルも含める）
  const att = payload.attachments || {};
  [1, 2].forEach(function (n) {
    if (isReq('attachment' + n) && !att[n]) errors['attachment' + n] = 'ファイルを添付してください';
  });
  return { errors: errors, value: p };
}

function getQuantityDecimals_() {
  try { return getSetting('QUANTITY_DECIMALS'); } catch (e) { return 3; }
}

// =====================================================================
// 【Workflow】 権限表・遷移表・保存・状態変更・コード補完
// =====================================================================

/** 権限表（04 §3.2）。action → ステータス → 許可する役割（並びは判定の優先順） */
const EDIT_PERMS_ = {};
EDIT_PERMS_[STATUS.DRAFT] = ['applicant', 'admin'];
EDIT_PERMS_[STATUS.COMPLETED] = ['applicant', 'admin'];
EDIT_PERMS_[STATUS.REQUESTED] = ['applicant', 'approver'];
EDIT_PERMS_[STATUS.REJECTED] = ['applicant'];
EDIT_PERMS_[STATUS.APPROVED] = ['approver', 'admin'];

const PERMISSIONS = (function () {
  const P = {};
  const set = function (action, statuses, roles) { P[action] = P[action] || {}; statuses.forEach(function (s) { P[action][s] = roles; }); };
  set('SAVE_DRAFT', [STATUS_NEW, STATUS.DRAFT, STATUS.COMPLETED], ['applicant']);
  set('COMPLETE', [STATUS_NEW, STATUS.DRAFT, STATUS.COMPLETED], ['applicant']);
  set('REQUEST', [STATUS_NEW, STATUS.DRAFT, STATUS.COMPLETED, STATUS.REJECTED], ['applicant']);
  P.EDIT = EDIT_PERMS_;
  set('DELETE', [STATUS.DRAFT, STATUS.COMPLETED], ['applicant', 'admin']);
  set('CANCEL_REQUEST', [STATUS.REQUESTED], ['applicant', 'approver']);
  set('APPROVE', [STATUS.REQUESTED], ['approver']);
  set('REJECT', [STATUS.REQUESTED], ['approver']);
  set('CANCEL_APPROVAL', [STATUS.APPROVED], ['approver', 'admin']);
  set('FIX_MATERIAL', [STATUS.APPROVED], ['admin', 'accounting']);
  set('FILL_CODE', [STATUS.APPROVED], ['admin', 'accounting']);
  set('RECALC_MATERIAL', [STATUS.APPROVED], ['admin', 'accounting']);
  set('EXPORT_CSV', [STATUS.APPROVED, STATUS.REFLECTED], ['admin', 'accounting']);
  set('MARK_REFLECTED', [STATUS.APPROVED], ['admin', 'accounting']);
  set('REVERT_REFLECTED', [STATUS.REFLECTED], ['admin']);
  P.ATTACH = EDIT_PERMS_;
  return P;
})();

/** 遷移表（04 §2）。to が null の操作はステータスを変えない */
const TRANSITIONS = {
  SAVE_DRAFT: { from: [STATUS_NEW, STATUS.DRAFT, STATUS.COMPLETED], to: STATUS.DRAFT },
  COMPLETE: { from: [STATUS_NEW, STATUS.DRAFT, STATUS.COMPLETED], to: STATUS.COMPLETED },
  REQUEST: { from: [STATUS_NEW, STATUS.DRAFT, STATUS.COMPLETED, STATUS.REJECTED], to: STATUS.REQUESTED },
  CANCEL_REQUEST: { from: [STATUS.REQUESTED], to: STATUS.COMPLETED },
  APPROVE: { from: [STATUS.REQUESTED], to: STATUS.APPROVED },
  REJECT: { from: [STATUS.REQUESTED], to: STATUS.REJECTED },
  CANCEL_APPROVAL: { from: [STATUS.APPROVED], to: STATUS.REQUESTED },
  MARK_REFLECTED: { from: [STATUS.APPROVED], to: STATUS.REFLECTED },
  REVERT_REFLECTED: { from: [STATUS.REFLECTED], to: STATUS.APPROVED },
  EDIT: { from: [STATUS.DRAFT, STATUS.COMPLETED, STATUS.REQUESTED, STATUS.REJECTED, STATUS.APPROVED], to: null },
  DELETE: { from: [STATUS.DRAFT, STATUS.COMPLETED], to: null }
};

/** 許可されるなら使う役割を、されないなら null を返す（純粋な関数） */
function canPerform(action, status, roles) {
  const table = PERMISSIONS[action] || {};
  const allowed = table[status] || table['*'];
  if (!allowed) return null;
  for (let i = 0; i < allowed.length; i++) if (roles[allowed[i]]) return allowed[i];
  return null;
}

function nextStatus(action, currentStatus) {
  const t = TRANSITIONS[action];
  if (!t || t.from.indexOf(currentStatus) < 0) return null;
  return t.to;
}

/** 保存時のチェックの強さ（04 §2「保存の規則」） */
function checkLevelFor_(action, status) {
  if (action === 'SAVE_DRAFT') return 'FORMAT';
  if (action === 'COMPLETE' || action === 'REQUEST') return 'FULL';
  if (action === 'EDIT') return (status === STATUS.COMPLETED || status === STATUS.REQUESTED || status === STATUS.APPROVED) ? 'FULL' : 'FORMAT';
  return 'FORMAT';
}

function blankRequest_() {
  const o = {};
  COLUMNS.REQUESTS.forEach(function (d) { o[d[1]] = d[2] === 'N' ? 0 : (d[2] === 'B' ? false : ''); });
  return o;
}

const PAYLOAD_KEYS_ = ['deptCode', 'categoryCode', 'approverId', 'supplierType', 'supplierCode', 'supplierBranch', 'supplierName',
  'deliveryType', 'deliveryCode', 'deliveryBranch', 'deliveryName', 'itemName', 'modelNo', 'quantity', 'unitNote', 'reason', 'deliveryDate'];

function requestToPayload_(req) {
  const p = {};
  PAYLOAD_KEYS_.forEach(function (k) { p[k] = req[k]; });
  p.attachments = { 1: !!req.att1FileId, 2: !!req.att2FileId };
  return p;
}

function applyPayload_(req, v, masters) {
  PAYLOAD_KEYS_.forEach(function (k) { req[k] = v[k]; });
  const dept = masters.departments.filter(function (d) { return d.deptCode === v.deptCode; })[0];
  req.deptName = dept ? dept.deptName : '';
  const cat = masters.categories.filter(function (c) { return c.categoryCode === v.categoryCode; })[0];
  req.categoryName = cat ? cat.categoryName : '';
  req.approverName = v.approverId ? employeeName_(masters, v.approverId) : '';
}

function loadRequestForUpdate_(requestId, version) {
  const req = findRequest_(requestId);
  if (!req || req.deleted) throw AppError('NOT_FOUND', '届出が見つかりません（削除された可能性があります）');
  if (Number(version) !== Number(req.version)) throw AppError('CONFLICT', '他の人が先に更新しました。画面を再読み込みしてください');
  return req;
}

function applyTimestamps_(req, action, operatorId, now) {
  switch (action) {
    case 'REQUEST':
      req.requestedAt = now; req.requestedBy = operatorId;
      if (!req.submittedDate) req.submittedDate = now.substr(0, 10);
      break;
    case 'CANCEL_REQUEST': req.requestCanceledAt = now; req.requestCanceledBy = operatorId; break;
    case 'APPROVE': req.approvedAt = now; req.approvedBy = operatorId; break;
    case 'REJECT': req.rejectedAt = now; req.rejectedBy = operatorId; break;
    case 'CANCEL_APPROVAL': req.approvalCanceledAt = now; req.approvalCanceledBy = operatorId; req.csvExported = false; break;
    case 'MARK_REFLECTED': req.reflectedAt = now; req.reflectedBy = operatorId; break;
    case 'REVERT_REFLECTED': req.revertedAt = now; req.revertedBy = operatorId; req.reflectedAt = ''; req.reflectedBy = ''; break;
    case 'DELETE': req.deleted = true; req.deletedAt = now; req.deletedBy = operatorId; break;
    default: break;
  }
}

function diffKeys_(before, after) {
  return PAYLOAD_KEYS_.filter(function (k) { return String(before[k] || '') !== String(after[k] || ''); });
}

/** 行を書き込み、バージョンを上げ、操作ログを残す */
function commitRequest_(req, operator, role, action, statusBefore, detail) {
  const now = nowString();
  req.updatedAt = now;
  req.updatedBy = operator.employeeId;
  req.version = (Number(req.version) || 0) + 1;
  if (req._row) updateRequest(req._row, req); else insertRequest(req);
  appendLog({
    operatorId: operator.employeeId, operatorName: operator.name, role: ROLE_LABELS[role] || role,
    requestId: req.requestId, action: ACTIONS[action] || action,
    statusBefore: statusBefore || '', statusAfter: req.deleted ? '（削除）' : req.status, detail: detail || ''
  });
  return req;
}

function saveRequestImpl_(ctx, payload, mode) {
  const MODE_TO_ACTION = { DRAFT: 'SAVE_DRAFT', COMPLETE: 'COMPLETE', REQUEST: 'REQUEST', EDIT: 'EDIT' };
  const action = MODE_TO_ACTION[mode];
  if (!action) throw AppError('SYSTEM', '保存の種類が正しくありません: ' + mode);
  payload = payload || {};
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const isNew = !payload.requestId;
    let req, before = null;
    if (isNew) {
      req = blankRequest_();
      req.status = STATUS_NEW;
      req.applicantId = op.employeeId;
      req.applicantName = op.name;
    } else {
      req = loadRequestForUpdate_(payload.requestId, payload.version);
      before = Object.assign({}, req);
    }
    const role = requireAuthIfNeeded(ctx, action, isNew ? null : req, masters);
    const statusBefore = isNew ? STATUS_NEW : req.status;
    if (!isNew && (req.status === STATUS.REQUESTED || req.status === STATUS.APPROVED)) {
      const f = {};
      if (String(payload.deptCode || '') !== req.deptCode) f.deptCode = 'この状態では変更できません';
      if (String(payload.approverId || '') !== req.approverId) f.approverId = 'この状態では変更できません';
      if (Object.keys(f).length) throw AppError('VALIDATION', '承認依頼中・承認済の届出では、部門と承認者を変更できません（K-05）', f);
    }
    // 添付の有無 = すでに付いている添付 ＋ 画面で選び、保存の後にアップロードするファイル
    const pending = (payload.pendingAttachments || []).map(Number);
    payload.attachments = { 1: !!req.att1FileId || pending.indexOf(1) >= 0, 2: !!req.att2FileId || pending.indexOf(2) >= 0 };
    const v = validateRequest(payload, checkLevelFor_(action, statusBefore), masters, req.applicantId);
    if (Object.keys(v.errors).length) throw AppError('VALIDATION', '入力内容を確認してください', v.errors);
    applyPayload_(req, v.value, masters);
    const now = nowString();
    if (isNew) {
      req.requestId = nextRequestId(now.substr(0, 10));
      req.createdAt = now;
      req.createdBy = op.employeeId;
      req.version = 0;
    }
    const to = nextStatus(action, statusBefore);
    if (to) req.status = to;
    applyTimestamps_(req, action, op.employeeId, now);
    if (action === 'EDIT' && statusBefore === STATUS.APPROVED) {
      req.csvExported = false; // K-07
      if (!req.materialFixed) applyCandidates_(req, masters);
    }
    commitRequest_(req, op, role, action, isNew ? '' : statusBefore, before ? { changed: diffKeys_(before, req) } : '');
    notify(action, req, masters);
    return { requestId: req.requestId, version: req.version, status: req.status };
  });
}

const CHANGE_STATUS_ACTIONS_ = ['REQUEST', 'CANCEL_REQUEST', 'APPROVE', 'REJECT', 'CANCEL_APPROVAL', 'REVERT_REFLECTED', 'DELETE'];

function changeStatusImpl_(ctx, requestId, version, action, options) {
  if (CHANGE_STATUS_ACTIONS_.indexOf(action) < 0) throw AppError('SYSTEM', 'この操作は changeStatus では行えません: ' + action);
  options = options || {};
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const req = loadRequestForUpdate_(requestId, version);
    const role = requireAuthIfNeeded(ctx, action, req, masters);
    const statusBefore = req.status;
    let detail = '';
    if (action === 'REQUEST' || action === 'APPROVE') {
      const v = validateRequest(requestToPayload_(req), 'FULL', masters, req.applicantId);
      if (Object.keys(v.errors).length) throw AppError('VALIDATION', '必須項目が不足しているか、内容に誤りがあります。「修正」から入力してください', v.errors);
    }
    if (action === 'REJECT') {
      const reason = String(options.reason || '').trim();
      if (!reason) throw AppError('VALIDATION', '差し戻し理由を入力してください', { rejectReason: '必須です' });
      if (charLength(reason) > LIMITS.rejectReason) throw AppError('VALIDATION', '差し戻し理由は' + LIMITS.rejectReason + '文字以内で入力してください', { rejectReason: LIMITS.rejectReason + '文字以内' });
      req.rejectReason = reason;
      detail = { reason: reason };
    }
    const now = nowString();
    const to = nextStatus(action, statusBefore);
    if (to) req.status = to;
    applyTimestamps_(req, action, op.employeeId, now);
    if (action === 'APPROVE' && !req.materialFixed) applyCandidates_(req, masters);
    commitRequest_(req, op, role, action, statusBefore, detail);
    notify(action, req, masters);
    return { requestId: req.requestId, version: req.version, status: req.status, deleted: req.deleted };
  });
}

function markReflectedImpl_(ctx, items) {
  if (!items || !items.length) throw AppError('VALIDATION', '届出を選択してください');
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const reqs = items.map(function (it) { return loadRequestForUpdate_(it.requestId, it.version); });
    let role = null;
    reqs.forEach(function (r) { role = requireAuthIfNeeded(ctx, 'MARK_REFLECTED', r, masters); });
    const notExported = reqs.filter(function (r) { return !r.csvExported; });
    if (notExported.length) throw AppError('VALIDATION', 'CSV出力済でない届出が含まれています（' + notExported.length + '件: ' + notExported.map(function (r) { return r.requestId; }).join(', ') + '）');
    const now = nowString();
    const results = reqs.map(function (r) {
      const before = r.status;
      r.status = STATUS.REFLECTED;
      applyTimestamps_(r, 'MARK_REFLECTED', op.employeeId, now);
      commitRequest_(r, op, role, 'MARK_REFLECTED', before, '');
      return { requestId: r.requestId, version: r.version };
    });
    return { results: results };
  });
}

/** 経理によるコード補完（K-39） */
function fillCodesImpl_(ctx, requestId, version, codes) {
  codes = codes || {};
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const req = loadRequestForUpdate_(requestId, version);
    const role = requireAuthIfNeeded(ctx, 'FILL_CODE', req, masters);
    let changed = false;
    const detail = {};
    [['supplier', masters.suppliers], ['delivery', masters.deliveries]].forEach(function (pair) {
      const kind = pair[0], list = pair[1], c = codes[kind];
      if (!c) return;
      const code = String(c.code || '').trim(), branch = String(c.branch || '').trim();
      if (code && !list.some(function (x) { return x.code === code && (x.branch || '') === branch; })) {
        throw AppError('VALIDATION', (kind === 'supplier' ? '発注先' : '納入先') + 'のコードがマスタにありません', {});
      }
      if (req[kind + 'Code'] !== code || req[kind + 'Branch'] !== branch) {
        detail[kind] = { from: req[kind + 'Code'] + (req[kind + 'Branch'] ? '-' + req[kind + 'Branch'] : ''), to: code + (branch ? '-' + branch : '') };
        req[kind + 'Code'] = code;
        req[kind + 'Branch'] = branch;
        changed = true;
      }
    });
    if (changed) {
      req.codeFilledBy = op.employeeId;
      req.codeFilledAt = nowString();
      req.csvExported = false;
    }
    commitRequest_(req, op, role, 'FILL_CODE', req.status, detail);
    return { version: req.version };
  });
}

function searchSuppliersImpl_(ctx, keyword, includeHidden) {
  const masters = getMasters();
  requireOperator_(ctx, masters);
  const kw = normalizeSearch_(keyword);
  return masters.suppliers
    .filter(function (x) { return includeHidden || x.visible; })
    .filter(function (x) { return !kw || normalizeSearch_([x.code, x.name, x.kana, x.abbr].join(' ')).indexOf(kw) >= 0; })
    .slice(0, 30)
    .map(function (x) { return { code: x.code, branch: x.branch, name: x.name, kana: x.kana, abbr: x.abbr, visible: x.visible }; });
}

/** 検索用の正規化（全角半角・ひらがなカタカナの違いを無視） */
function normalizeSearch_(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
    .replace(/\s+/g, '');
}

function listRow_(r, masters, s) {
  const due = r.submittedDate ? calcDueDate(r, 'yyyy/MM/dd') : (r.deliveryDate || '');
  return {
    requestId: r.requestId, status: r.status, version: r.version,
    submittedDate: r.submittedDate, deptCode: r.deptCode, deptName: r.deptName,
    categoryCode: r.categoryCode, categoryName: r.categoryName,
    applicantId: r.applicantId, applicantName: r.applicantName, approverId: r.approverId, approverName: r.approverName,
    supplierType: r.supplierType, supplierCode: r.supplierCode, supplierBranch: r.supplierBranch, supplierName: r.supplierName,
    deliveryType: r.deliveryType, deliveryCode: r.deliveryCode, deliveryBranch: r.deliveryBranch, deliveryName: r.deliveryName,
    itemName: r.itemName, modelNo: r.modelNo, quantity: r.quantity, unitNote: r.unitNote, deliveryDate: r.deliveryDate,
    dueDate: due, dueFilled: !r.deliveryDate && !!r.submittedDate,
    attCount: (r.att1FileId ? 1 : 0) + (r.att2FileId ? 1 : 0),
    materialCode: r.materialCode, materialBranch: r.materialBranch, materialSubBranch: r.materialSubBranch,
    materialName: r.materialName, packQty: r.packQty, materialFixed: r.materialFixed,
    csvExported: r.csvExported, csvExportedAt: r.csvExportedAt, csvExportCount: r.csvExportCount,
    reflectedAt: r.reflectedAt, reflectedByName: employeeName_(masters, r.reflectedBy),
    updatedAt: r.updatedAt,
    warnings: {
      noCode: !r.supplierCode || !r.deliveryCode,
      materialUnfixed: !r.materialFixed,
      needReexport: r.csvExportCount > 0 && !r.csvExported
    }
  };
}

function getRequestListImpl_(ctx, query) {
  const masters = getMasters();
  requireOperator_(ctx, masters);
  const tab = (query && query.tab) || 'ALL';
  const s = getSettings();
  const rows = readAll('REQUESTS').filter(function (r) {
    if (r.deleted) return false;
    if (tab === 'APPROVED') return r.status === STATUS.APPROVED;
    if (tab === 'REFLECTED') return r.status === STATUS.REFLECTED;
    return true;
  });
  return { rows: rows.map(function (r) { return listRow_(r, masters, s); }), serverTime: nowString() };
}

function getRequestDetailImpl_(ctx, requestId) {
  const masters = getMasters();
  requireOperator_(ctx, masters);
  const r = findRequest_(requestId);
  if (!r || r.deleted) throw AppError('NOT_FOUND', '届出が見つかりません（削除された可能性があります）');
  const req = Object.assign({}, r);
  delete req._row; delete req.sysNote;
  const ids = {};
  ['materialFixedBy', 'codeFilledBy', 'createdBy', 'updatedBy', 'requestedBy', 'requestCanceledBy', 'approvedBy', 'rejectedBy',
    'approvalCanceledBy', 'csvExportedBy', 'reflectedBy', 'revertedBy'].forEach(function (k) { if (req[k]) ids[req[k]] = employeeName_(masters, req[k]); });
  const logs = readAll('LOGS').filter(function (l) { return l.requestId === requestId; })
    .sort(function (a, b) { return a.loggedAt < b.loggedAt ? -1 : (a.loggedAt > b.loggedAt ? 1 : 0); })
    .map(function (l) { return { loggedAt: l.loggedAt, operatorName: l.operatorName, role: l.role, action: l.action, statusBefore: l.statusBefore, statusAfter: l.statusAfter, detail: l.detail }; });
  let candidates = [];
  try { candidates = r.materialCandidates ? JSON.parse(r.materialCandidates) : []; } catch (e) { candidates = []; }
  req.materialCandidates = candidates;
  const attachments = [1, 2].filter(function (n) { return r['att' + n + 'FileId']; }).map(function (n) { return { slot: n, fileName: r['att' + n + 'FileName'] }; });
  return { request: req, names: ids, logs: logs, attachments: attachments, dueDate: r.submittedDate ? calcDueDate(r, 'yyyy/MM/dd') : r.deliveryDate };
}

// =====================================================================
// 【MaterialMatcher】 資材候補の選定・確定・検索（04 §6）
// =====================================================================

function normalizeName(s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();
}

/** 資材名の「：」より後ろ（発注先の部分） */
function supplierPartOf(name) {
  const n = String(name == null ? '' : name);
  const i = n.search(/[：:]/);
  return i < 0 ? '' : n.substr(i + 1);
}

function normalizeCompanyName_(s) {
  return normalizeName(s).replace(/株式会社|\(株\)|有限会社|\(有\)|合同会社|\(同\)/g, '');
}

/** 発注先の条件（04 §6.2） */
function supplierMatch(material, request, supplierRec) {
  const type = request.supplierType;
  if (type === PARTY_TYPES.NONE || !type) return true;
  const part = normalizeCompanyName_(supplierPartOf(material.name));
  if (type === PARTY_TYPES.MASTER) {
    if (request.supplierCode && (material.makerCode === request.supplierCode || material.stockCode === request.supplierCode)) return true;
    const abbr = normalizeCompanyName_(supplierRec ? (supplierRec.abbr || supplierRec.name) : request.supplierName);
    return !!abbr && !!part && part.indexOf(abbr) >= 0;
  }
  if (type === PARTY_TYPES.MANUAL) {
    const nm = normalizeCompanyName_(request.supplierName);
    if (nm.length < 2 || part.length < 2) return false;
    return part.indexOf(nm) >= 0 || nm.indexOf(part) >= 0;
  }
  return false;
}

/** 候補を順位づけて返す（純粋な関数。04 §6.3） */
function rankMaterials(request, materials, departments, suppliers, limit) {
  const itemKey = normalizeName(request.itemName);
  const dept = departments.filter(function (d) { return d.deptCode === request.deptCode; })[0];
  const commonCode = dept ? String(dept.commonDeptCode || '') : '';
  const supplierRec = request.supplierType === PARTY_TYPES.MASTER
    ? suppliers.filter(function (x) { return x.code === request.supplierCode && (x.branch || '') === (request.supplierBranch || ''); })[0]
    : null;
  const found = [];
  materials.forEach(function (m) {
    if (String(m.invalid || '0') !== '0') return;
    let rank = 0;
    if (itemKey && (normalizeName(m.name) === itemKey || (m.nameInCompany && normalizeName(m.nameInCompany) === itemKey))) {
      rank = 1;
    } else if (m.type === request.categoryCode && supplierMatch(m, request, supplierRec)) {
      if (m.deptCode === request.deptCode) rank = 2;
      else if (commonCode && m.deptCode === commonCode) rank = 3;
      else rank = 4;
    }
    if (rank) found.push({ rank: rank, code: m.code, branch: m.branch || '', subBranch: m.subBranch || '', name: m.name, packQty: m.packQty, deptCode: m.deptCode });
  });
  found.sort(function (a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const ka = a.code + '|' + a.branch + '|' + a.subBranch, kb = b.code + '|' + b.branch + '|' + b.subBranch;
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
  });
  return found.slice(0, limit || 10);
}

function getMaterials_() {
  if (!EXEC_.materials) EXEC_.materials = readAll('MATERIALS');
  return EXEC_.materials;
}

/** 候補を計算し、未確定なら先頭を仮設定する */
function applyCandidates_(req, masters) {
  const cands = rankMaterials(req, getMaterials_(), masters.departments, masters.suppliers, getSetting('MATERIAL_CANDIDATE_LIMIT'));
  req.materialCandidates = JSON.stringify(cands);
  if (!req.materialFixed) {
    const top = cands[0];
    req.materialCode = top ? top.code : '';
    req.materialBranch = top ? top.branch : '';
    req.materialSubBranch = top ? top.subBranch : '';
    req.materialName = top ? top.name : '';
    req.packQty = top ? top.packQty : '';
  }
  return cands;
}

function getMaterialCandidatesImpl_(ctx, requestId) {
  const masters = getMasters();
  requireOperator_(ctx, masters);
  const r = findRequest_(requestId);
  if (!r || r.deleted) throw AppError('NOT_FOUND', '届出が見つかりません');
  let cands = [];
  try { cands = r.materialCandidates ? JSON.parse(r.materialCandidates) : []; } catch (e) { cands = []; }
  return {
    candidates: cands,
    current: { code: r.materialCode, branch: r.materialBranch, subBranch: r.materialSubBranch, name: r.materialName, packQty: r.packQty, fixed: r.materialFixed },
    version: r.version
  };
}

function recalcMaterialCandidatesImpl_(ctx, requestId, version) {
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const req = loadRequestForUpdate_(requestId, version);
    const role = requireAuthIfNeeded(ctx, 'RECALC_MATERIAL', req, masters);
    const cands = applyCandidates_(req, masters);
    commitRequest_(req, op, role, 'RECALC_MATERIAL', req.status, { count: cands.length });
    return { version: req.version, candidates: cands };
  });
}

function searchMaterialsImpl_(ctx, query) {
  const masters = getMasters();
  requirePrivileged_(ctx, ['admin', 'accounting'], masters);
  query = query || {};
  const kw = normalizeName(query.keyword);
  return getMaterials_().filter(function (m) {
    if (String(m.invalid || '0') !== '0') return false;
    if (query.categoryCode && m.type !== query.categoryCode) return false;
    if (query.deptCode && m.deptCode !== query.deptCode) return false;
    if (kw && (normalizeName(m.name) + '|' + normalizeName(m.nameInCompany) + '|' + m.code).indexOf(kw) < 0) return false;
    return true;
  }).slice(0, 50).map(function (m) {
    return { code: m.code, branch: m.branch, subBranch: m.subBranch, name: m.name, typeName: m.typeName, packQty: m.packQty, deptName: m.deptName, makerAbbr: m.makerAbbr, stockAbbr: m.stockAbbr };
  });
}

/** 経理による資材の確定（K-40。material が null なら「資材なしで確定」） */
function fixMaterialImpl_(ctx, requestId, version, material) {
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const req = loadRequestForUpdate_(requestId, version);
    const role = requireAuthIfNeeded(ctx, 'FIX_MATERIAL', req, masters);
    const beforeKey = [req.materialCode, req.materialBranch, req.materialSubBranch, req.materialFixed].join('|');
    if (material && material.code) {
      const m = getMaterials_().filter(function (x) {
        return x.code === String(material.code) && (x.branch || '') === String(material.branch || '') && (x.subBranch || '') === String(material.subBranch || '');
      })[0];
      if (!m) throw AppError('VALIDATION', '資材マスタに無い資材です');
      if (String(m.invalid || '0') !== '0') throw AppError('VALIDATION', '無効な資材は選べません');
      req.materialCode = m.code; req.materialBranch = m.branch || ''; req.materialSubBranch = m.subBranch || '';
      req.materialName = m.name; req.packQty = m.packQty;
    } else {
      req.materialCode = ''; req.materialBranch = ''; req.materialSubBranch = ''; req.materialName = ''; req.packQty = '';
    }
    req.materialFixed = true;
    req.materialFixedBy = op.employeeId;
    req.materialFixedAt = nowString();
    const afterKey = [req.materialCode, req.materialBranch, req.materialSubBranch, req.materialFixed].join('|');
    if (beforeKey !== afterKey) req.csvExported = false;
    commitRequest_(req, op, role, 'FIX_MATERIAL', req.status, { code: req.materialCode || '（資材なし）' });
    return { version: req.version };
  });
}

// =====================================================================
// 【CsvExport】 CSVの生成と出力の記録（04 §7）
// =====================================================================

const CSV_COLUMN_KEYS = ['SUPPLIER_CODE', 'SUPPLIER_BRANCH', 'DELIVERY_CODE', 'DELIVERY_BRANCH', 'MATERIAL_CODE', 'MATERIAL_BRANCH',
  'MATERIAL_SUB_BRANCH', 'PACK_QTY', 'QUANTITY', 'DUE_DATE', 'REQUEST_ID', 'ITEM_NAME', 'MODEL_NO'];

/** 'yyyy/MM/dd' の月末日を 'yyyy/MM/dd' で返す */
function endOfMonth(dateStr) {
  const d = isValidDate(dateStr);
  if (!d) return '';
  const y = +d.substr(0, 4), m = +d.substr(5, 2);
  const last = new Date(y, m, 0).getDate();
  return d.substr(0, 8) + ('0' + last).slice(-2);
}

/** 'yyyy/MM/dd' を書式（yyyy, MM, dd, M, d）で整える（純粋な関数） */
function formatYmd_(dateStr, fmt) {
  const d = isValidDate(dateStr);
  if (!d) return '';
  const y = d.substr(0, 4), mm = d.substr(5, 2), dd = d.substr(8, 2);
  return String(fmt).replace(/yyyy|MM|dd|M|d/g, function (t) {
    if (t === 'yyyy') return y;
    if (t === 'MM') return mm;
    if (t === 'dd') return dd;
    if (t === 'M') return String(+mm);
    return String(+dd);
  });
}

/** 納期（04 §5）。納品日があればそれ、無ければ提出日の月末 */
function calcDueDate(request, dateFormat) {
  if (request.deliveryDate) return formatYmd_(request.deliveryDate, dateFormat);
  const base = request.submittedDate || String(request.approvedAt || '').substr(0, 10);
  return formatYmd_(endOfMonth(base), dateFormat);
}

function escapeCsvValue(value, settings) {
  const s = value === null || value === undefined ? '' : String(value);
  const delim = settings.CSV_DELIMITER;
  if (settings.CSV_QUOTE_MODE === 'ALL') return '"' + s.replace(/"/g, '""') + '"';
  if (s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\r') >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvColumns_(settings) {
  const cols = String(settings.CSV_COLUMNS).split(',').map(function (c) { return c.trim(); }).filter(Boolean);
  const names = String(settings.CSV_HEADER_NAMES).split(',').map(function (c) { return c.trim(); });
  const bad = cols.filter(function (c) { return CSV_COLUMN_KEYS.indexOf(c) < 0; });
  if (bad.length) throw AppError('SYSTEM', '設定 CSV_COLUMNS に不明な列キーがあります: ' + bad.join(', '));
  if (settings.CSV_HEADER && names.length !== cols.length) throw AppError('SYSTEM', '設定 CSV_COLUMNS と CSV_HEADER_NAMES の数が一致しません');
  return { cols: cols, names: names };
}

/** 列キーの値（04 §7.2） */
function csvValueFor_(key, r, settings) {
  const fixed = r.materialFixed === true && !!r.materialCode;
  switch (key) {
    case 'SUPPLIER_CODE': return r.supplierCode || '';
    case 'SUPPLIER_BRANCH': return r.supplierBranch || '';
    case 'DELIVERY_CODE': return r.deliveryCode || '';
    case 'DELIVERY_BRANCH': return r.deliveryBranch || '';
    case 'MATERIAL_CODE': return fixed ? r.materialCode : '';
    case 'MATERIAL_BRANCH': return fixed ? (r.materialBranch || '') : '';
    case 'MATERIAL_SUB_BRANCH': return fixed ? (r.materialSubBranch || '') : '';
    case 'PACK_QTY': return fixed ? (r.packQty || '') : '';
    case 'QUANTITY': return r.quantity || '';
    case 'DUE_DATE': return calcDueDate(r, settings.CSV_DATE_FORMAT);
    case 'REQUEST_ID': return r.requestId || '';
    case 'ITEM_NAME': return r.itemName || '';
    case 'MODEL_NO': return r.modelNo || '';
    default: return '';
  }
}

/** CSV の文字列を作る（純粋な関数） */
function buildCsvText(requests, settings) {
  const c = csvColumns_(settings);
  const eol = settings.CSV_LINE_ENDING === 'LF' ? '\n' : '\r\n';
  const lines = [];
  if (settings.CSV_HEADER) lines.push(c.names.map(function (n) { return escapeCsvValue(n, settings); }).join(settings.CSV_DELIMITER));
  requests.forEach(function (r) {
    lines.push(c.cols.map(function (k) { return escapeCsvValue(csvValueFor_(k, r, settings), settings); }).join(settings.CSV_DELIMITER));
  });
  return lines.join(eol) + eol;
}

/** ファイル名（{} の中を日時の書式で置き換える）。formatFn(fmt) は日時を整える関数 */
function buildFileName(pattern, formatFn) {
  return String(pattern).replace(/\{([^}]+)\}/g, function (all, fmt) { return formatFn(fmt); });
}

function exportCsvImpl_(ctx, items) {
  if (!items || !items.length) throw AppError('VALIDATION', '届出を選択してください');
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const settings = getSettings();
    const reqs = items.map(function (it) { return loadRequestForUpdate_(it.requestId, it.version); });
    let role = null;
    reqs.forEach(function (r) { role = requireAuthIfNeeded(ctx, 'EXPORT_CSV', r, masters); });
    reqs.sort(function (a, b) { return a.requestId < b.requestId ? -1 : (a.requestId > b.requestId ? 1 : 0); });
    const text = buildCsvText(reqs, settings);
    const now = new Date();
    const fileName = buildFileName(settings.CSV_FILENAME_PATTERN, function (fmt) { return formatDate(now, fmt); });
    const blob = Utilities.newBlob('', 'text/csv', fileName).setDataFromString(text, settings.CSV_CHARSET);
    const base64 = Utilities.base64Encode(blob.getBytes());
    const nowStr = nowString();
    const results = reqs.map(function (r) {
      r.csvExported = true;
      r.csvExportedAt = nowStr;
      r.csvExportedBy = op.employeeId;
      r.csvExportCount = (Number(r.csvExportCount) || 0) + 1;
      commitRequest_(r, op, role, 'EXPORT_CSV', r.status, { fileName: fileName });
      return { requestId: r.requestId, version: r.version };
    });
    return { fileName: fileName, mimeType: 'text/csv', base64: base64, count: reqs.length, results: results };
  });
}

// =====================================================================
// 【MasterImport】 マスタCSVの取込（03 §4、04 §10）
// =====================================================================

function findImportFile_(fileName) {
  const folderId = getSetting('IMPORT_FOLDER_ID');
  if (!folderId) throw AppError('SYSTEM', '設定 IMPORT_FOLDER_ID が空です。初期セットアップを実行してください');
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  let best = null;
  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed && f.isTrashed()) continue;
    if (String(f.getName()).toLowerCase() === fileName.toLowerCase()) {
      if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) best = f;
    }
  }
  if (!best) throw AppError('VALIDATION', '「マスタ取込」フォルダに ' + fileName + ' がありません');
  return best;
}

function readCsv_(file, charset) {
  const blob = file.getBlob();
  const tries = charset === 'UTF-8' ? ['UTF-8'] : [charset, 'Windows-31J', 'Shift_JIS'];
  let text = null, lastErr = null;
  for (let i = 0; i < tries.length; i++) {
    try { text = blob.getDataAsString(tries[i]); break; } catch (e) { lastErr = e; }
  }
  if (text === null) throw AppError('SYSTEM', '文字コード ' + charset + ' で読めません: ' + lastErr);
  if (text.charCodeAt(0) === 0xFEFF) text = text.substr(1);
  return Utilities.parseCsv(text);
}

function csvToObjects_(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(function (h) { return String(h).trim(); });
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(function (v) { return String(v).trim() === ''; })) continue;
    const o = {};
    header.forEach(function (h, j) { if (h && o[h] === undefined) o[h] = row[j] === undefined ? '' : String(row[j]); });
    out.push(o);
  }
  return out;
}

function importMaterials_() {
  const spec = IMPORT_FILES.MATERIALS;
  const file = findImportFile_(spec.fileName);
  const objs = csvToObjects_(readCsv_(file, spec.charset));
  const rows = objs.filter(function (o) { return String(o.MaterialCode || '').trim(); }).map(function (o) {
    const r = {};
    COLUMNS.MATERIALS.forEach(function (d) { r[d[1]] = String(o[d[0]] === undefined ? '' : o[d[0]]); });
    if (!r.invalid) r.invalid = '0';
    return r;
  });
  replaceAll_('MATERIALS', rows);
  EXEC_.materials = null;
  return { target: 'MATERIALS', fileName: file.getName(), rows: rows.length, inserted: rows.length, updated: 0, disabled: 0 };
}

/** 部署・種別マスタを資材マスタから作る（03 §4.4） */
function rebuildDepartmentsAndCategories_() {
  const materials = readAll('MATERIALS');
  const employees = readAll('EMPLOYEES');
  const sectionToDivision = {};
  employees.forEach(function (e) { if (e.section && e.division && !sectionToDivision[e.section]) sectionToDivision[e.section] = e.division; });

  const depts = readAll('DEPARTMENTS');
  const deptMap = {};
  depts.forEach(function (d) { deptMap[d.deptCode] = d; });
  let insertedD = 0, maxOrder = depts.reduce(function (m, d) { return Math.max(m, d.sortOrder || 0); }, 0);
  const seenD = {};
  materials.forEach(function (m) {
    if (!m.deptCode || seenD[m.deptCode]) return;
    seenD[m.deptCode] = true;
    const d = deptMap[m.deptCode];
    if (d) {
      d.deptName = m.deptName || d.deptName;
    } else {
      maxOrder += 10;
      deptMap[m.deptCode] = { deptCode: m.deptCode, deptName: m.deptName, division: '', commonDeptCode: '', sortOrder: maxOrder, enabled: false };
      depts.push(deptMap[m.deptCode]);
      insertedD++;
    }
  });
  depts.forEach(function (d) { if (!d.division && sectionToDivision[d.deptName]) d.division = sectionToDivision[d.deptName]; });
  replaceAll_('DEPARTMENTS', depts);

  const cats = readAll('CATEGORIES');
  const catMap = {};
  cats.forEach(function (c) { catMap[c.categoryCode] = c; });
  let insertedC = 0, maxC = cats.reduce(function (m, c) { return Math.max(m, c.sortOrder || 0); }, 0);
  const seenC = {};
  materials.forEach(function (m) {
    if (!m.type || seenC[m.type]) return;
    seenC[m.type] = true;
    const c = catMap[m.type];
    if (c) {
      c.categoryName = m.typeName || c.categoryName;
    } else {
      maxC += 10;
      catMap[m.type] = { categoryCode: m.type, categoryName: m.typeName, sortOrder: maxC, enabled: false };
      cats.push(catMap[m.type]);
      insertedC++;
    }
  });
  replaceAll_('CATEGORIES', cats);
  return { target: 'DEPARTMENTS_CATEGORIES', fileName: '（資材マスタから生成）', rows: depts.length + cats.length, inserted: insertedD + insertedC, updated: 0, disabled: 0, departments: depts.length, categories: cats.length };
}

function importSuppliers_() {
  const spec = IMPORT_FILES.SUPPLIERS;
  const file = findImportFile_(spec.fileName);
  const objs = csvToObjects_(readCsv_(file, spec.charset));
  const visibleAccounts = String(getSetting('SUPPLIER_VISIBLE_ACCOUNTS')).split(',').map(function (s) { return stripSpaces_(s); }).filter(Boolean);
  const existing = readAll('SUPPLIERS');
  const map = {};
  existing.forEach(function (x) { map[x.code + '|' + (x.branch || '')] = x; });
  const now = nowString();
  const seen = {};
  let inserted = 0, updated = 0, disabled = 0;
  objs.forEach(function (o) {
    const code = String(o.BusiConnectionCode || '').trim();
    if (!code) return;
    const branch = String(o.BusiConnectionBranchCode || '').trim();
    const key = code + '|' + branch;
    seen[key] = true;
    const account2 = stripSpaces_(o['科目名2']);
    const rec = map[key];
    if (rec) {
      rec.name = o.BusiConnectionName || ''; rec.kana = o.BusiConnectionNameKana || ''; rec.abbr = o.BusiConnectionAbbreviateName || '';
      rec.account2 = account2; rec.importedAt = now;
      updated++;
    } else {
      const nr = { code: code, branch: branch, name: o.BusiConnectionName || '', kana: o.BusiConnectionNameKana || '', abbr: o.BusiConnectionAbbreviateName || '',
        account2: account2, visible: visibleAccounts.indexOf(account2) >= 0, importedAt: now };
      map[key] = nr;
      existing.push(nr);
      inserted++;
    }
  });
  existing.forEach(function (x) {
    if (!seen[x.code + '|' + (x.branch || '')] && x.visible) { x.visible = false; disabled++; }
  });
  replaceAll_('SUPPLIERS', existing);
  return { target: 'SUPPLIERS', fileName: file.getName(), rows: objs.length, inserted: inserted, updated: updated, disabled: disabled };
}

function importEmployees_() {
  const spec = IMPORT_FILES.EMPLOYEES;
  const file = findImportFile_(spec.fileName);
  const objs = csvToObjects_(readCsv_(file, spec.charset));
  const depts = readAll('DEPARTMENTS');
  const deptByName = {};
  depts.forEach(function (d) { if (d.deptName && !deptByName[d.deptName]) deptByName[d.deptName] = d.deptCode; });
  const existing = readAll('EMPLOYEES');
  const map = {};
  existing.forEach(function (e) { map[e.employeeId] = e; });
  const now = nowString();
  const seen = {};
  let inserted = 0, updated = 0, disabled = 0, rows = 0;
  objs.forEach(function (o) {
    const id = String(o.mail || '').trim();
    if (!id) return;
    rows++;
    seen[id] = true;
    const section = String(o['部署2'] || '').trim();
    const data = {
      employeeId: id, name: String(o.displayName || '').trim(), mail: id,
      division: String(o['部署1'] || '').trim(), section: section, jobTitle: String(o.jobTitle || '').trim(),
      enabled: String(o.accountEnabled || '').toUpperCase() !== 'FALSE', importedAt: now
    };
    const rec = map[id];
    if (rec) {
      Object.keys(data).forEach(function (k) { rec[k] = data[k]; });
      if (deptByName[section]) rec.defaultDeptCode = deptByName[section];
      updated++;
    } else {
      data.defaultDeptCode = deptByName[section] || '';
      map[id] = data;
      existing.push(data);
      inserted++;
    }
  });
  existing.forEach(function (e) { if (!seen[e.employeeId] && e.enabled) { e.enabled = false; disabled++; } });
  replaceAll_('EMPLOYEES', existing);
  return { target: 'EMPLOYEES', fileName: file.getName(), rows: rows, inserted: inserted, updated: updated, disabled: disabled };
}

/** 取込の入口。target: MATERIALS / SUPPLIERS / EMPLOYEES / DEPARTMENTS_CATEGORIES / ALL */
function importMasters(target, operatorId) {
  const results = [];
  withLock(function () {
    if (target === 'MATERIALS' || target === 'ALL') results.push(importMaterials_());
    if (target === 'ALL' || target === 'DEPARTMENTS_CATEGORIES' || target === 'MATERIALS') results.push(rebuildDepartmentsAndCategories_());
    if (target === 'SUPPLIERS' || target === 'ALL') results.push(importSuppliers_());
    if (target === 'EMPLOYEES' || target === 'ALL') results.push(importEmployees_());
    if (target === 'ALL') rebuildDepartmentsAndCategories_(); // 社員の「課→部」で部署マスタの「部」を補う
    if (!results.length) throw AppError('SYSTEM', '取込対象が正しくありません: ' + target);
    clearMasterCache();
    const masters = getMasters();
    results.forEach(function (r) {
      appendLog({ operatorId: operatorId || '', operatorName: employeeName_(masters, operatorId), role: operatorId ? ROLE_LABELS.admin : ROLE_LABELS.system, action: ACTIONS.IMPORT_MASTER, detail: r });
    });
  });
  return results;
}

// =====================================================================
// 【Attachment】 添付書類（04 §9）
// =====================================================================

function getOrCreateRequestFolder_(requestId) {
  const rootId = getSetting('ATTACHMENT_FOLDER_ID');
  if (!rootId) throw AppError('SYSTEM', '設定 ATTACHMENT_FOLDER_ID が空です。初期セットアップを実行してください');
  const root = DriveApp.getFolderById(rootId);
  const it = root.getFoldersByName(requestId);
  return it.hasNext() ? it.next() : root.createFolder(requestId);
}

function checkAttachment_(file, settings) {
  const name = String(file && file.name || '');
  const ext = (name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
  const allowed = String(settings.ATTACHMENT_ALLOWED_EXT).split(',').map(function (s) { return s.trim().toLowerCase(); });
  if (!ext || allowed.indexOf(ext) < 0) throw AppError('VALIDATION', '添付できるのは ' + allowed.join(', ') + ' です');
  const base64 = String(file.base64 || '').replace(/^data:[^,]*,/, '');
  const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0));
  if (bytes > settings.ATTACHMENT_MAX_MB * 1024 * 1024) throw AppError('VALIDATION', 'ファイルサイズは' + settings.ATTACHMENT_MAX_MB + 'MBまでです');
  if (bytes <= 0) throw AppError('VALIDATION', 'ファイルが空です');
  return base64;
}

function uploadAttachmentImpl_(ctx, requestId, version, slot, file) {
  slot = Number(slot);
  if (slot !== 1 && slot !== 2) throw AppError('SYSTEM', '添付の枠が正しくありません');
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const req = loadRequestForUpdate_(requestId, version);
    const role = requireAuthIfNeeded(ctx, 'ATTACH', req, masters);
    const base64 = checkAttachment_(file, getSettings());
    const folder = getOrCreateRequestFolder_(requestId);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), file.mimeType || 'application/octet-stream', 'slot' + slot + '_' + file.name);
    const created = folder.createFile(blob);
    const oldId = req['att' + slot + 'FileId'];
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { console.warn('古い添付をゴミ箱へ移せません: ' + e); } }
    req['att' + slot + 'FileId'] = created.getId();
    req['att' + slot + 'FileName'] = file.name;
    const action = oldId ? 'ATTACH_REPLACE' : 'ATTACH_ADD';
    commitRequest_(req, op, role, action, req.status, { slot: slot, fileName: file.name });
    return { version: req.version, fileName: file.name };
  });
}

function deleteAttachmentImpl_(ctx, requestId, version, slot) {
  slot = Number(slot);
  return withLock(function () {
    const masters = getMasters();
    const op = requireOperator_(ctx, masters);
    const req = loadRequestForUpdate_(requestId, version);
    const role = requireAuthIfNeeded(ctx, 'ATTACH', req, masters);
    const oldId = req['att' + slot + 'FileId'];
    if (!oldId) throw AppError('VALIDATION', '添付がありません');
    if (getRequiredFields()['attachment' + slot] && checkLevelFor_('EDIT', req.status) === 'FULL') {
      throw AppError('VALIDATION', '必須の添付は削除できません。差し替えてください', { ['attachment' + slot]: '必須の添付は削除できません' });
    }
    try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { console.warn('添付をゴミ箱へ移せません: ' + e); }
    const name = req['att' + slot + 'FileName'];
    req['att' + slot + 'FileId'] = '';
    req['att' + slot + 'FileName'] = '';
    commitRequest_(req, op, role, 'ATTACH_DELETE', req.status, { slot: slot, fileName: name });
    return { version: req.version };
  });
}

function getAttachmentImpl_(ctx, requestId, slot) {
  const masters = getMasters();
  requireOperator_(ctx, masters);
  const r = findRequest_(requestId);
  if (!r || r.deleted) throw AppError('NOT_FOUND', '届出が見つかりません');
  const id = r['att' + Number(slot) + 'FileId'];
  if (!id) throw AppError('NOT_FOUND', '添付がありません');
  const blob = DriveApp.getFileById(id).getBlob();
  return { fileName: r['att' + Number(slot) + 'FileName'], mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

// =====================================================================
// 【Notifier】 通知（04 §13。初版は NOTIFY_ENABLED=FALSE で何もしない）
// =====================================================================

/** 通知の入口。送り先の一覧を返す（送らなかったときは null） */
function notify(action, request, masters) {
  if (['REQUEST', 'REJECT', 'APPROVE'].indexOf(action) < 0) return null;
  let enabled = false;
  try { enabled = getSetting('NOTIFY_ENABLED'); } catch (e) { enabled = false; }
  if (!enabled) return null;
  const to = notifyRecipients_(action, request, masters);
  const subject = '【物品購入届】' + ACTIONS[action] + ': ' + request.requestId + ' ' + request.itemName;
  const body = '届出ID: ' + request.requestId + '\n購入物品名: ' + request.itemName + '\nステータス: ' + request.status + '\n';
  to.forEach(function (addr) { sendNotification_(addr, subject, body); });
  return to;
}

function notifyRecipients_(action, request, masters) {
  const mail = function (id) { const e = findEmployee_(masters, id); return e && e.mail ? e.mail : ''; };
  let to = [];
  if (action === 'REQUEST') to = [mail(request.approverId)];
  if (action === 'REJECT') to = [mail(request.applicantId)];
  if (action === 'APPROVE') {
    to = [mail(request.applicantId)].concat(masters.roles.filter(function (r) { return r.enabled && r.role === ROLE_ACCOUNTING; }).map(function (r) { return mail(r.employeeId); }));
  }
  return to.filter(function (a, i) { return a && to.indexOf(a) === i; });
}

/** 初版の送信処理はログに出すだけ（有効にするときは MailApp.sendEmail に置き換え、スコープを追加する） */
function sendNotification_(to, subject, body) {
  console.log('[通知（送信はしていません）] to=' + to + ' subject=' + subject);
}

// =====================================================================
// 【Menu】 カスタムメニュー・初期セットアップ・バックアップ
// =====================================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('物品購入届')
    .addItem('初期セットアップ', 'menuSetup')
    .addSubMenu(ui.createMenu('マスタ取込')
      .addItem('すべて', 'menuImportAll')
      .addItem('資材', 'menuImportMaterials')
      .addItem('発注先', 'menuImportSuppliers')
      .addItem('社員', 'menuImportEmployees'))
    .addItem('部署・種別マスタを資材から更新', 'menuRebuildDeptCategory')
    .addItem('暗証番号を発行', 'menuIssuePin')
    .addSeparator()
    .addItem('バックアップトリガーを設定', 'menuInstallBackupTrigger')
    .addItem('今すぐバックアップ', 'runMonthlyBackup')
    .addItem('キャッシュをクリア', 'menuClearCache');
  // Tests.gs を貼った開発環境だけに出す（K-46、K-48）
  if (typeof seedDevData === 'function') {
    menu.addSeparator()
      .addItem('開発: サンプルデータ投入', 'menuSeedDevData')
      .addItem('開発: テストを実行', 'menuRunAllTests');
  }
  menu.addToUi();
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

function ensureSheet_(key) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(SHEETS[key]);
  let created = false;
  if (!sheet) { sheet = ss.insertSheet(SHEETS[key]); created = true; }
  const defs = COLUMNS[key];
  const lastCol = sheet.getLastColumn();
  const headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  const startCol = headers.length + 1;
  const addHeaders = defs.map(function (d) { return d[0]; }).filter(function (h) { return headers.indexOf(h) < 0; });
  if (addHeaders.length) {
    const needCols = headers.length + addHeaders.length;
    if (needCols > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());
    sheet.getRange(1, startCol, 1, addHeaders.length).setValues([addHeaders]);
    addHeaders.forEach(function (h) { headers.push(h); });
  }
  const maxRows = Math.max(sheet.getMaxRows(), 2);
  defs.forEach(function (d) {
    const i = headers.indexOf(d[0]);
    if (i >= 0 && maxRows > 1) sheet.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat(formatOf_(d[2]));
  });
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f5f9');
  sheet.setFrozenRows(1);
  return { sheet: sheet, created: created };
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 初期セットアップ（何度実行しても同じ結果になる） */
function menuSetup() {
  resetExecutionCache_();
  const ss = getSpreadsheet_();
  const made = [];
  Object.keys(SHEETS).forEach(function (key) { if (ensureSheet_(key).created) made.push(SHEETS[key]); });
  // 設定の既定値（既存のキーは上書きしない）
  const existing = readAll('SETTINGS');
  const keys = existing.map(function (r) { return r.key; });
  const add = [];
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (keys.indexOf(k) < 0) add.push({ key: k, value: DEFAULT_SETTINGS[k][0], description: DEFAULT_SETTINGS[k][1] });
  });
  if (add.length) appendRows_('SETTINGS', add);
  // 入力項目（必須・任意の切り替え）。足りない項目だけ初期値で追加する
  const fieldKeys = readAll('FIELDS').map(function (r) { return r.key; });
  const addFields = FIELD_REQUIREMENTS.filter(function (f) { return fieldKeys.indexOf(f[0]) < 0; })
    .map(function (f) { return { key: f[0], label: f[1], required: f[2], description: f[3] }; });
  if (addFields.length) appendRows_('FIELDS', addFields);
  try {
    const fs = ss.getSheetByName(SHEETS.FIELDS);
    const n = fs.getLastRow() - 1;
    const col = fs.getRange(1, 1, 1, fs.getLastColumn()).getValues()[0].map(String).indexOf('必須') + 1;
    if (n > 0 && col > 0) fs.getRange(2, col, n, 1).insertCheckboxes(); // 「必須」列をチェックボックスにする
  } catch (e) { console.warn('入力項目シートのチェックボックスを設定できません: ' + e); }
  // ドライブのフォルダ
  resetExecutionCache_();
  const isDev = String(ss.getName()).indexOf('開発') >= 0;
  const base = getOrCreateFolder_(DriveApp.getRootFolder(), isDev ? '物品購入届_開発' : '物品購入届');
  const folders = { ATTACHMENT_FOLDER_ID: '添付書類', IMPORT_FOLDER_ID: 'マスタ取込', BACKUP_FOLDER_ID: 'バックアップ' };
  const settingsRows = readAll('SETTINGS');
  Object.keys(folders).forEach(function (k) {
    const row = settingsRows.filter(function (r) { return r.key === k; })[0];
    if (row && !row.value) {
      row.value = getOrCreateFolder_(base, folders[k]).getId();
      writeRows_('SETTINGS', row._row, [row]);
    }
  });
  // 暗証番号シートの保護と非表示（K-37）
  const pinSheet = ss.getSheetByName(SHEETS.PINS);
  try {
    if (!pinSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      const p = pinSheet.protect().setDescription('暗証番号（アプリだけが書き込む）');
      p.removeEditors(p.getEditors());
      if (p.canDomainEdit()) p.setDomainEdit(false);
    }
    pinSheet.hideSheet();
  } catch (e) { console.warn('暗証番号シートの保護に失敗しました: ' + e); }
  clearMasterCache();
  alert_('初期セットアップが終わりました。\n作成したシート: ' + (made.length ? made.join('、') : 'なし（既存）') +
    '\n追加した設定: ' + add.length + '件\nドライブのフォルダ: ' + base.getName() + '/（添付書類・マスタ取込・バックアップ）');
}

function runImportMenu_(target) {
  resetExecutionCache_();
  try {
    const results = importMasters(target, '');
    alert_('マスタ取込が終わりました。\n' + results.map(function (r) {
      return '・' + r.target + ' ' + r.fileName + ': ' + r.rows + '件（追加 ' + r.inserted + ' / 更新 ' + r.updated + ' / 無効化 ' + r.disabled + '）';
    }).join('\n'));
  } catch (e) {
    alert_('マスタ取込に失敗しました: ' + e.message);
  }
}
function menuImportAll() { runImportMenu_('ALL'); }
function menuImportMaterials() { runImportMenu_('MATERIALS'); }
function menuImportSuppliers() { runImportMenu_('SUPPLIERS'); }
function menuImportEmployees() { runImportMenu_('EMPLOYEES'); }
function menuRebuildDeptCategory() { runImportMenu_('DEPARTMENTS_CATEGORIES'); }

function menuIssuePin() {
  resetExecutionCache_();
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('暗証番号を発行', '社員ID（メールアドレス）を入力してください', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = String(res.getResponseText() || '').trim();
  const masters = getMasters();
  const emp = findEmployee_(masters, id);
  if (!emp) { ui.alert('社員マスタに ' + id + ' がありません'); return; }
  const len = getSetting('PIN_LENGTH');
  const res2 = ui.prompt('暗証番号を発行', emp.name + ' さんの暗証番号を指定する場合は、' + len + '桁の数字を入力してください。\n空欄のまま OK を押すと、ランダムに発行します。', ui.ButtonSet.OK_CANCEL);
  if (res2.getSelectedButton() !== ui.Button.OK) return;
  const input = String(res2.getResponseText() || '').trim();
  if (input) {
    const v = validatePin_(input, len);
    if (!v.ok) { ui.alert(v.message); return; }
    issuePin(id, Session.getEffectiveUser().getEmail(), v.value);
    ui.alert('暗証番号を設定しました', emp.name + ' さんに、指定した暗証番号を設定しました。', ui.ButtonSet.OK);
    return;
  }
  const r = issuePin(id, Session.getEffectiveUser().getEmail());
  ui.alert('暗証番号を発行しました', emp.name + ' さんの暗証番号: ' + r.pin + '\n\n本人に伝えてください。この画面を閉じると再表示できません。', ui.ButtonSet.OK);
}

function menuClearCache() {
  clearMasterCache();
  alert_('マスタのキャッシュをクリアしました');
}

function menuInstallBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runMonthlyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runMonthlyBackup').timeBased().onMonthDay(1).atHour(3).create();
  alert_('毎月1日 3時台にバックアップを作るトリガーを設定しました');
}

/** 毎月のバックアップ（04 §14） */
function runMonthlyBackup() {
  resetExecutionCache_();
  const ss = getSpreadsheet_();
  const folderId = getSetting('BACKUP_FOLDER_ID');
  if (!folderId) throw new Error('設定 BACKUP_FOLDER_ID が空です');
  const name = ss.getName() + '_backup_' + formatDate(new Date(), 'yyyyMM');
  DriveApp.getFileById(ss.getId()).makeCopy(name, DriveApp.getFolderById(folderId));
  appendLog({ operatorId: '', operatorName: '', role: ROLE_LABELS.system, action: 'バックアップ', detail: { name: name } });
  return name;
}

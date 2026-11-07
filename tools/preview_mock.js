/**
 * local_preview.html 用のモック（K-43）
 *
 * - google.script.run の代わりに、フェイク（tools/gas_fakes.js）の上で動く本物の Code.gs を呼ぶ。
 * - データは架空のサンプル。localStorage（キー prMock_v1）に保存し、再読み込みしても残す。
 * - 暗証番号はどの承認者・管理者・経理も 123456。
 * - URL のハッシュで開くタブと操作者を指定できる（例: local_preview.html#tab=approved&op=keiri）。
 */
(function () {
  'use strict';
  var STORAGE_KEY = 'prMock_v1';
  var GAS = window.__GAS__;
  var fns = GAS.fns;
  var fakes = GAS.fakes;

  // ---- 架空のサンプルマスタ（実在の人物・会社ではない） ----
  var EMP = {
    nyuryoku: 'yamada.taro@example.com',
    kacho: 'sato.hanako@example.com',
    dairi: 'suzuki.ichiro@example.com',
    admin: 'takahashi.ken@example.com',
    keiri: 'tanaka.misaki@example.com',
    hinsho: 'ito.makoto@example.com',
    butsuryu: 'watanabe.sakura@example.com'
  };
  window.__MOCK_EMP__ = EMP;

  function seedMasters() {
    var now = '2026/10/31 09:00:00';
    fns.replaceAll_('DEPARTMENTS', [
      { deptCode: '23', deptName: '生産課', division: '生産管理部', commonDeptCode: '94', sortOrder: 10, enabled: true },
      { deptCode: '3', deptName: '物流課', division: '生産管理部', commonDeptCode: '94', sortOrder: 20, enabled: true },
      { deptCode: '30', deptName: '品質保証課', division: '品質保証部', commonDeptCode: '', sortOrder: 30, enabled: true },
      { deptCode: '94', deptName: '生産管理部共通', division: '生産管理部', commonDeptCode: '', sortOrder: 40, enabled: true },
      { deptCode: '99', deptName: '本部共通', division: 'コーポレート部門', commonDeptCode: '', sortOrder: 50, enabled: true }
    ]);
    fns.replaceAll_('CATEGORIES', [
      { categoryCode: '42', categoryName: '事務用品', sortOrder: 10, enabled: true },
      { categoryCode: '49', categoryName: 'その他消耗品', sortOrder: 20, enabled: true },
      { categoryCode: '81', categoryName: '部品(30万円未満消耗品)', sortOrder: 30, enabled: true },
      { categoryCode: '60', categoryName: '修繕費', sortOrder: 40, enabled: true }
    ]);
    var emp = function (id, name, div, sec, dept, title) {
      return { employeeId: id, name: name, mail: id, division: div, section: sec, defaultDeptCode: dept, jobTitle: title, enabled: true, importedAt: now };
    };
    fns.replaceAll_('EMPLOYEES', [
      emp(EMP.nyuryoku, '山田 太郎', '生産管理部', '生産課', '23', ''),
      emp(EMP.kacho, '佐藤 花子', '生産管理部', '生産課', '23', '課長'),
      emp(EMP.dairi, '鈴木 一郎', '生産管理部', '生産課', '23', '課長代理'),
      emp(EMP.butsuryu, '渡辺 さくら', '生産管理部', '物流課', '3', ''),
      emp(EMP.hinsho, '伊藤 誠', '品質保証部', '品質保証課', '30', '課長'),
      emp(EMP.admin, '高橋 健', 'コーポレート部門', '総務課', '99', ''),
      emp(EMP.keiri, '田中 美咲', 'コーポレート部門', '経理課', '99', '')
    ]);
    fns.replaceAll_('APPROVERS', [
      { deptCode: '23', approverId: EMP.kacho, approverName: '佐藤 花子', priority: 1, enabled: true },
      { deptCode: '23', approverId: EMP.dairi, approverName: '鈴木 一郎', priority: 2, enabled: true },
      { deptCode: '3', approverId: EMP.kacho, approverName: '佐藤 花子', priority: 1, enabled: true },
      { deptCode: '94', approverId: EMP.kacho, approverName: '佐藤 花子', priority: 1, enabled: true },
      { deptCode: '30', approverId: EMP.hinsho, approverName: '伊藤 誠', priority: 1, enabled: true },
      { deptCode: '99', approverId: EMP.admin, approverName: '高橋 健', priority: 1, enabled: true }
    ]);
    fns.replaceAll_('ROLES', [
      { employeeId: EMP.admin, name: '高橋 健', role: '管理者', enabled: true },
      { employeeId: EMP.keiri, name: '田中 美咲', role: '経理', enabled: true }
    ]);
    var sup = function (code, name, kana, abbr, acc, visible) { return { code: code, branch: '', name: name, kana: kana, abbr: abbr, account2: acc, visible: visible, importedAt: now }; };
    fns.replaceAll_('SUPPLIERS', [
      sup('000501', '株式会社みどり文具', 'ミドリブング', 'みどり文具', '未払金', true),
      sup('000502', 'あおぞら事務機株式会社', 'アオゾラジムキ', 'あおぞら事務機', '未払金', true),
      sup('000315', '株式会社サンプル包材', 'サンプルホウザイ', 'サンプル包材', '買掛金', true),
      sup('000610', '株式会社こだま工具', 'コダマコウグ', 'こだま工具', '買掛金', true),
      sup('000611', 'ひかり電設株式会社', 'ヒカリデンセツ', 'ひかり電設', '未払金', true),
      sup('000720', '株式会社やまびこ商会', 'ヤマビコショウカイ', 'やまびこ商会', '未払金', true),
      sup('000801', 'つばさ運輸株式会社', 'ツバサウンユ', 'つばさ運輸', '未払金', false),
      sup('000902', '株式会社にじいろ化学', 'ニジイロカガク', 'にじいろ化学', '買掛金', true),
      sup('000903', 'しらかば清掃株式会社', 'シラカバセイソウ', 'しらかば清掃', '未払金', true),
      sup('000904', '株式会社ほしぞら印刷', 'ホシゾラインサツ', 'ほしぞら印刷', '買掛金', true)
    ]);
    fns.replaceAll_('DELIVERIES', [
      { code: '000100', branch: '', name: '本社工場（サンプル）', sortOrder: 10, enabled: true },
      { code: '000100', branch: '01', name: '第2倉庫（サンプル）', sortOrder: 20, enabled: true }
    ]);
    var mat = function (code, name, type, typeName, pack, maker, makerAbbr, dept, deptName, invalid) {
      return { code: code, branch: '', subBranch: '', name: name, nameInCompany: '', type: type, typeName: typeName, packQty: pack,
        makerCode: maker, makerBranch: '', makerAbbr: makerAbbr, stockCode: '', stockBranch: '', stockAbbr: '',
        deptCode: dept, deptName: deptName, purchaseTypeName: '自社購買', invalid: invalid || '0' };
    };
    fns.replaceAll_('MATERIALS', [
      mat('000000000001501', '消耗品（事務用品）：みどり文具（生産課）', '42', '事務用品', '1', '000501', 'みどり文具', '23', '生産課'),
      mat('000000000001502', '消耗品（事務用品）：みどり文具（生産管理部共通）', '42', '事務用品', '1', '000501', 'みどり文具', '94', '生産管理部共通'),
      mat('000000000001503', '消耗品（事務用品）：あおぞら事務機（生産管理部共通）', '42', '事務用品', '1', '000502', 'あおぞら事務機', '94', '生産管理部共通'),
      mat('000000000001504', '消耗品（事務用品）：みどり文具（品質保証課）', '42', '事務用品', '1', '000501', 'みどり文具', '30', '品質保証課'),
      mat('000000000001505', 'コピー用紙A4', '42', '事務用品', '5', '000502', 'あおぞら事務機', '99', '本部共通'),
      mat('000000000001601', 'その他消耗品：やまびこ商会（生産課）', '49', 'その他消耗品', '1', '000720', 'やまびこ商会', '23', '生産課'),
      mat('000000000001602', 'その他消耗品：サンプル包材（物流課）', '49', 'その他消耗品', '1', '000315', 'サンプル包材', '3', '物流課'),
      mat('000000000001603', 'その他消耗品：しらかば清掃（生産管理部共通）', '49', 'その他消耗品', '1', '000903', 'しらかば清掃', '94', '生産管理部共通'),
      mat('000000000001701', '部品(30万円未満消耗品)：こだま工具（生産課）', '81', '部品(30万円未満消耗品)', '1', '000610', 'こだま工具', '23', '生産課'),
      mat('000000000001702', '部品(30万円未満消耗品)：ひかり電設（品質保証課）', '81', '部品(30万円未満消耗品)', '1', '000611', 'ひかり電設', '30', '品質保証課'),
      mat('000000000001801', '修繕費：ひかり電設（生産管理部共通）', '60', '修繕費', '1', '000611', 'ひかり電設', '94', '生産管理部共通'),
      mat('000000000001802', '修繕費：こだま工具（生産課・旧）', '60', '修繕費', '1', '000610', 'こだま工具', '23', '生産課', '1')
    ]);
  }

  function seedAll() {
    fns.resetExecutionCache_();
    fns.menuSetup();
    fns.resetExecutionCache_();
    seedMasters();
    fns.clearMasterCache();
    fns.resetExecutionCache_();
    [EMP.kacho, EMP.dairi, EMP.hinsho, EMP.admin, EMP.keiri].forEach(function (id) { fns.issuePin(id, 'preview', '123456'); });
    fns.resetExecutionCache_();
    var msg = fns.seedSampleRequests_(EMP.admin, EMP.keiri);
    console.log('[プレビュー] ' + msg);
    saveState();
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, fakes.helpers.exportState()); } catch (e) { console.warn('プレビューのデータを保存できません: ' + e); }
  }

  function loadOrSeed() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { saved = null; }
    if (saved) {
      try { fakes.helpers.importState(saved); return; } catch (e) { console.warn('保存データを読めないため作り直します: ' + e); }
    }
    seedAll();
  }

  // ---- google.script.run の代わり ----
  function makeRunner(onSuccess, onFailure) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return makeRunner(fn, onFailure); };
        if (prop === 'withFailureHandler') return function (fn) { return makeRunner(onSuccess, fn); };
        if (prop === 'withUserObject') return function () { return makeRunner(onSuccess, onFailure); };
        return function () {
          var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
          setTimeout(function () {
            try {
              var f = fns[prop];
              if (typeof f !== 'function') throw new Error('サーバー関数がありません: ' + String(prop));
              var res = f.apply(null, args);
              saveState();
              if (onSuccess) onSuccess(res);
            } catch (e) {
              console.error(e);
              if (onFailure) onFailure(e);
            }
          }, 120);
        };
      }
    });
  }
  window.google = { script: { run: makeRunner(null, null) } };

  // ---- バナーの操作 ----
  window.mockReset = function () {
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem('prOperatorId'); sessionStorage.removeItem('prAuth'); } catch (e) { /* 無視 */ }
    location.hash = '';
    location.reload();
  };
  window.mockSwitch = function (key) {
    var sel = document.getElementById('operator-select');
    if (!sel) return;
    sel.value = EMP[key];
    if (typeof onOperatorChange === 'function') onOperatorChange();
  };

  // URL のハッシュ（op=キー）で操作者を指定
  var m = String(location.hash || '').match(/op=(\w+)/);
  try {
    if (m && EMP[m[1]]) localStorage.setItem('prOperatorId', EMP[m[1]]);
    else if (!localStorage.getItem('prOperatorId')) localStorage.setItem('prOperatorId', EMP.nyuryoku);
  } catch (e) { /* 無視 */ }

  loadOrSeed();

  // URL のハッシュ（rows=件数）で、届出がその件数以上になるまでサンプルを足す（一覧のスクロール確認用）
  var rowsMatch = String(location.hash || '').match(/rows=(\d+)/);
  if (rowsMatch) {
    try {
      var want = Math.min(Number(rowsMatch[1]), 300);
      var guard = 0;
      while (fns.readAll('REQUESTS').length < want && guard++ < 60) {
        fns.resetExecutionCache_();
        fns.seedSampleRequests_(EMP.admin, EMP.keiri);
      }
      fns.resetExecutionCache_();
      saveState();
    } catch (e) { console.warn('サンプルを足せません: ' + e); }
  }

  // URL のハッシュ（req=キー:1,キー:0）で「入力項目」シートの必須を変える（画面確認用。例: req=modelNo:1,quantity:0）
  var reqMatch = String(location.hash || '').match(/req=([\w:,]+)/);
  if (reqMatch) {
    try {
      fns.resetExecutionCache_();
      if (!fns.readAll('FIELDS').length) { fns.menuSetup(); fns.resetExecutionCache_(); }
      var want = {};
      reqMatch[1].split(',').forEach(function (kv) { var a = kv.split(':'); want[a[0]] = a[1] === '1'; });
      fns.readAll('FIELDS').forEach(function (r) {
        if (Object.prototype.hasOwnProperty.call(want, r.key)) { r.required = want[r.key]; fns.writeRows_('FIELDS', r._row, [r]); }
      });
      fns.resetExecutionCache_();
      saveState();
    } catch (e) { console.warn('入力項目を変更できません: ' + e); }
  }

  // URL のハッシュ（auth=1）で、指定した操作者を暗証番号 123456 で認証済みにする（画面確認用）
  if (/auth=1/.test(String(location.hash || ''))) {
    try {
      var opId = localStorage.getItem('prOperatorId');
      var res = fns.authenticate(opId, '123456');
      if (res && res.ok) sessionStorage.setItem('prAuth', JSON.stringify({ operatorId: opId, token: res.data.token, expiresAtMs: res.data.expiresAtMs }));
      saveState();
    } catch (e) { console.warn(e); }
  }

  // URL のハッシュ（open=detail / material / pin / code）でダイアログを開く（画面確認用）
  var o = String(location.hash || '').match(/open=(\w+)/);
  if (o) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        var app = (typeof APP !== 'undefined') ? APP : null; // js.html の const APP（window のプロパティではない）
        var rows = (app && app.lists && (app.lists.APPROVED || app.lists.ALL)) || [];
        var id = rows.length ? rows[0].requestId : 'PR-00000000-001';
        if (o[1] === 'detail' && typeof openDetail === 'function') openDetail(id);
        if (o[1] === 'material' && typeof openMaterialDialog === 'function') openMaterialDialog(id);
        if (o[1] === 'code' && typeof openCodeDialog === 'function') openCodeDialog(id);
        if (o[1] === 'pin' && typeof promptPin === 'function') promptPin();
        if (o[1] === 'adminpin' && typeof switchAdminSub === 'function') {
          switchAdminSub('pin');
          var sp = document.querySelector('input[name="pin-mode"][value="specify"]');
          if (sp) { sp.checked = true; onPinModeChange(); }
        }
      }, 1500);
    });
  }
})();

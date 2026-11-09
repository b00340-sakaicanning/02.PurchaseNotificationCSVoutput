/**
 * tools/capture_manual_screenshots.js
 * 操作マニュアル用の注釈付きスクリーンショットを撮影し、gas_app/manual_images/ に保存する
 *
 * 実行: node tools/capture_manual_screenshots.js   (プロジェクトのルートで実行。事前に node tools/build_local_preview.js を実行しておく)
 * 必要なもの: Google Chrome（インターネット接続は Google Fonts のため。無くても撮影はできる）
 *
 * - local_preview.html（本物の Code.gs が架空のデータで動く）をヘッドレス Chrome で開き、URL のハッシュ（tab= op= auth= rows=）で各場面を作る
 * - 本番（GAS）と同じ見た目にするため、プレビューのバナーを隠す
 * - 撮影の直前に、説明する箇所へ赤枠と番号のバッジを重ねる。番号はマニュアル本文の num-badge に対応する
 * - 画面を変更したときは、このスクリプトを再実行して撮り直し、node tools/build_manual.js で manual.html を作り直す
 * - 元は「01.エネルギー使用量集計」の tools/capture_manual_screenshots.js（注釈の仕組みはそのまま）
 */

const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browserDriver.js');

const projectRoot = path.join(__dirname, '..');
const outputDir = path.join(projectRoot, 'gas_app', 'manual_images');
const VIEWPORT = { width: 1280, height: 900 };
// WebP の品質 (1〜100)。大きくすると鮮明になるが、manual.html の容量が増える
const WEBP_QUALITY = 75;
// 架空のデータの届出の件数（ページ送りが写るように 1ページの件数 50 より多くする）
const REQUEST_ROWS = 60;

// 注釈 (赤枠と番号のバッジ) と、撮影用の見た目の調整
const ANNOTATION_SCRIPT = `
  document.addEventListener('DOMContentLoaded', function(){
    var style = document.createElement('style');
    style.textContent =
      '.preview-banner { display: none !important; } body { padding-top: 0 !important; }' +
      '.toast-container { visibility: hidden !important; }' +
      '#manualAnnotationLayer { position: absolute; top: 0; left: 0; width: 100%; height: 0; pointer-events: none; z-index: 999999; }' +
      '.ann-box { position: absolute; border: 3px solid #ef4444; border-radius: 8px; box-sizing: border-box; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2), 0 4px 16px rgba(239, 68, 68, 0.15); }' +
      '.ann-badge { position: absolute; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: #ffffff; font: 800 15px/1 -apple-system, "Segoe UI", Arial, sans-serif; border: 2.5px solid #ffffff; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35); }';
    document.head.appendChild(style);
  });
  // 注釈を描く。targets: [{ selector, closest, badge, pad, badgeAt }]
  window.__annotate = function(targets) {
    var old = document.getElementById('manualAnnotationLayer');
    if (old) old.remove();
    var layer = document.createElement('div');
    layer.id = 'manualAnnotationLayer';
    document.body.appendChild(layer);
    targets.forEach(function(t){
      var el = document.querySelector(t.selector);
      if (el && t.closest) el = el.closest(t.closest);
      if (!el) throw new Error('注釈の対象がありません: ' + t.selector);
      var r = el.getBoundingClientRect();
      var pad = t.pad === undefined ? 5 : t.pad;
      var left = Math.max(r.left + window.scrollX - pad, 3);
      var top = r.top + window.scrollY - pad;
      var width = Math.min(r.width + pad * 2, document.documentElement.clientWidth - left - 3);
      var box = document.createElement('div');
      box.className = 'ann-box';
      box.style.cssText = 'left:' + left + 'px; top:' + top + 'px; width:' + width + 'px; height:' + (r.height + pad * 2) + 'px;';
      layer.appendChild(box);
      var badge = document.createElement('div');
      badge.className = 'ann-badge';
      badge.textContent = t.badge;
      var badgeLeft = t.badgeAt === 'top-right' ? left + width - 15 : left - 15;
      badge.style.cssText = 'left:' + Math.max(badgeLeft, 2) + 'px; top:' + Math.max(top - 15, 2) + 'px;';
      layer.appendChild(badge);
    });
    return true;
  };
  window.__clearAnnotations = function() { var old = document.getElementById('manualAnnotationLayer'); if (old) old.remove(); return true; };
  // 要素の上端・下端のページ上の位置。target は selector の文字列、または { selector, closest }
  window.__edge = function(target, edge) {
    var selector = typeof target === 'string' ? target : target.selector;
    var el = document.querySelector(selector);
    if (el && target.closest) el = el.closest(target.closest);
    if (!el) throw new Error('要素がありません: ' + selector);
    var r = el.getBoundingClientRect();
    return (edge === 'top' ? r.top : r.bottom) + window.scrollY;
  };`;

(async () => {
  if (!fs.existsSync(path.join(projectRoot, 'local_preview.html'))) throw new Error('local_preview.html がありません。先に node tools/build_local_preview.js を実行してください');

  const browser = await launchBrowser({ siteDir: projectRoot, viewport: VIEWPORT, injectScript: ANNOTATION_SCRIPT });
  const { send, settle, evalJs, screenshot } = browser;
  const saved = [];
  let navCount = 0;
  try {
    /** local_preview.html をハッシュ付きで開き直す（クエリを変えて、必ず読み込み直す） */
    const open = async (hash) => {
      await send('Page.navigate', { url: `${browser.baseUrl}/local_preview.html?n=${++navCount}#${hash}` });
      await settle();
      await evalJs('document.fonts.ready.then(function(){ return true; })');
      await evalJs('typeof fitTables === "function" && fitTables(), true');
      await settle();
    };
    /**
     * 注釈を付けて撮影する
     * @param {string} name ファイル名 (拡張子なし)
     * @param {Object} scene { annotations, from, to, viewportOnly, scrollY }
     */
    const shoot = async (name, scene) => {
      await settle();
      await evalJs(`window.scrollTo(0, ${scene.scrollY || 0})`);
      await evalJs(`window.__annotate(${JSON.stringify(scene.annotations || [])})`);
      let clip;
      if (scene.viewportOnly) {
        clip = { x: 0, y: scene.scrollY || 0, width: VIEWPORT.width, height: VIEWPORT.height };
      } else {
        const top = scene.from ? Math.max(await evalJs(`window.__edge(${JSON.stringify(scene.from)}, 'top')`) - 24, 0) : 0;
        const bottom = await evalJs(`window.__edge(${JSON.stringify(scene.to)}, 'bottom')`) + 24;
        clip = { x: 0, y: Math.round(top), width: VIEWPORT.width, height: Math.round(bottom - top) };
      }
      const filePath = path.join(outputDir, `${name}.webp`);
      await screenshot(filePath, { clip, quality: WEBP_QUALITY });
      await evalJs('window.__clearAnnotations()');
      saved.push({ name, bytes: fs.statSync(filePath).size });
      process.stdout.write(`  ${name}.webp (${(fs.statSync(filePath).size / 1024).toFixed(0)} KB)\n`);
    };
    const firstId = (tab, status) => evalJs(`(APP.lists.${tab} || []).filter(function (r) { return ${status ? `r.status === ${JSON.stringify(status)}` : 'true'}; })[0].requestId`);

    console.log('スクリーンショットを撮影します (1〜2分かかります)');
    fs.mkdirSync(outputDir, { recursive: true });

    // ===== 1章: 画面全体（承認者で認証済み） =====
    await open(`tab=list&op=kacho&auth=1&rows=${REQUEST_ROWS}`);
    await shoot('01_overview', {
      to: '#main-tabs',
      annotations: [
        { selector: '.header-logo', badge: '1' },
        { selector: '#manual-btn', badge: '2' },
        { selector: '.operator-box', badge: '3' },
        { selector: '#auth-status', badge: '4' },
        { selector: '#main-tabs', badge: '5', pad: 3 }
      ]
    });

    // ===== 2章: 操作者の選択と暗証番号 =====
    await open('tab=new&op=nyuryoku');
    await evalJs(`(function(){ var s = document.getElementById('operator-select'); s.size = 14; s.style.cssText += ';position:absolute;right:24px;top:84px;width:430px;height:330px;max-height:none;z-index:5000;'; return true; })()`);
    await shoot('02_operator_list', {
      viewportOnly: true,
      annotations: [{ selector: '#operator-select', badge: '1', pad: 4 }]
    });
    await open('tab=new&op=nyuryoku');
    await evalJs(`(function(){ var s = document.getElementById('operator-select'); var o = Array.from(s.options).filter(function (x) { return /佐藤/.test(x.textContent); })[0]; s.value = o.value; s.dispatchEvent(new Event('change')); return true; })()`);
    await shoot('03_pin_dialog', {
      viewportOnly: true,
      annotations: [
        { selector: '#pin-operator-name', closest: 'p', badge: '1', pad: 6 },
        { selector: '#pin-input', badge: '2', pad: 4 },
        { selector: '#pin-ok', closest: '.modal-actions', badge: '3', pad: 4 }
      ]
    });

    // ===== 3章: 新規入力 =====
    await open('tab=new&op=nyuryoku');
    await evalJs(`(function(){
      ['supplier', 'delivery'].forEach(function (k) { var r = document.querySelector('input[name="' + k + 'Type"][value="マスタ"]'); r.checked = true; onPartyTypeChange(k); });
      var q = document.getElementById('f-supplier-search'); q.value = 'みどり'; q.focus(); q.dispatchEvent(new Event('input'));
      return true; })()`);
    await shoot('04_new_top', {
      from: '#view-new .view-header',
      to: '#supplier-combo-list',
      annotations: [
        { selector: '#f-deptCode', closest: '.form-group', badge: '1', pad: 4 },
        { selector: '#f-categoryCode', closest: '.form-group', badge: '2', pad: 4 },
        { selector: '#f-approverId', closest: '.form-group', badge: '3', pad: 4 },
        { selector: '#party-supplier', badge: '4', pad: 4 },
        { selector: '#party-delivery', badge: '5', pad: 4 }
      ]
    });
    await evalJs(`document.getElementById('f-supplier-search').blur(), true`);
    await shoot('05_new_bottom', {
      from: '#f-itemName',
      to: '#form-buttons',
      annotations: [
        { selector: '#f-itemName', closest: '.form-group', badge: '1', pad: 4 },
        { selector: '#f-quantity', closest: '.form-grid-3', badge: '2', pad: 4 },
        { selector: '#f-reason', closest: '.form-group', badge: '3', pad: 4 },
        { selector: '.attach-group', closest: '.form-grid-2', badge: '4', pad: 4 },
        { selector: '#form-buttons', badge: '5', pad: 4 }
      ]
    });

    // ===== 4章: 入力データ一覧 =====
    await open('tab=list&op=kacho&auth=1');
    await shoot('06_list', {
      from: '#view-list .view-header',
      to: '#list-pager',
      annotations: [
        { selector: '#view-list .view-header-end', badge: '1', pad: 4 },
        { selector: '#view-list .filter-row', badge: '2', pad: 4 },
        { selector: '#view-list .logs-filter-container', badge: '3', pad: 3 },
        { selector: '#list-table thead', badge: '4', pad: 2 },
        { selector: '#list-body tr:nth-child(3) td.action-cell', badge: '5', pad: 2 },
        { selector: '#list-pager', badge: '6', pad: 4 }
      ]
    });
    await evalJs(`openDetail(${JSON.stringify(await firstId('ALL', '承認依頼中'))}), true`);
    await shoot('07_detail', {
      viewportOnly: true,
      annotations: [
        { selector: '#detail-body', badge: '1', pad: 4 },
        { selector: '#detail-modal .modal-actions', badge: '2', pad: 4 }
      ]
    });

    // ===== 5章: 承認者の操作（差し戻し） =====
    await open('tab=list&op=kacho&auth=1');
    await evalJs(`listAction('REJECT', ${JSON.stringify(await firstId('ALL', '承認依頼中'))}), true`);
    await shoot('08_reject', {
      viewportOnly: true,
      annotations: [
        { selector: '#reject-reason', closest: '.form-group', badge: '1', pad: 4 },
        { selector: '#reject-modal .modal-actions', badge: '2', pad: 4 }
      ]
    });

    // ===== 6章: 承認済一覧（経理） =====
    await open('tab=approved&op=keiri&auth=1');
    await shoot('09_approved', {
      from: '#view-approved .view-header',
      to: '#view-approved .table-container',
      annotations: [
        { selector: '#view-approved .logs-filter-container', badge: '1', pad: 3 },
        { selector: '#view-approved .bulk-select-status', badge: '2', pad: 4 },
        { selector: '#view-approved .action-btn-group', badge: '3', pad: 4 },
        { selector: '#approved-body tr td:nth-child(6)', badge: '4', pad: 2 },
        { selector: '#approved-body tr td.action-cell', badge: '5', pad: 2 }
      ]
    });
    const approvedId = await firstId('APPROVED');
    await evalJs(`openMaterialDialog(${JSON.stringify(approvedId)}), true`);
    await shoot('10_material', {
      viewportOnly: true,
      annotations: [
        { selector: '#material-target', badge: '1', pad: 4 },
        { selector: '#material-candidates', badge: '2', pad: 4 },
        { selector: '#mat-keyword', closest: '.logs-filter-container', badge: '3', pad: 3 },
        { selector: '#material-modal .none-choice', badge: '4', pad: 3 },
        { selector: '#material-modal .modal-actions', badge: '5', pad: 4 }
      ]
    });
    await open('tab=approved&op=keiri&auth=1');
    await evalJs(`openCodeDialog(${JSON.stringify(approvedId)}), true`);
    await shoot('11_code', {
      viewportOnly: true,
      annotations: [
        { selector: '#code-supplier-search', closest: '.form-group', badge: '1', pad: 4 },
        { selector: '#code-delivery', closest: '.form-group', badge: '2', pad: 4 }
      ]
    });
    await open('tab=approved&op=keiri&auth=1');
    await evalJs(`(function(){ var cb = document.querySelector('#approved-body input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new Event('change')); document.getElementById('btn-export-approved').click(); return true; })()`);
    await shoot('12_csv_confirm', {
      viewportOnly: true,
      annotations: [
        { selector: '#confirm-message', badge: '1', pad: 6 },
        { selector: '#btn-confirm-ok', closest: '.modal-actions', badge: '2', pad: 4 }
      ]
    });

    // ===== 7章: システム反映済一覧（管理者） =====
    await open('tab=reflected&op=admin&auth=1');
    await shoot('13_reflected', {
      from: '#view-reflected .view-header',
      to: '#view-reflected .table-container',
      annotations: [
        { selector: '#btn-export-reflected', badge: '1', pad: 4 },
        { selector: '#reflected-body tr td.action-cell', badge: '2', pad: 2 }
      ]
    });

    // ===== 8章: マスタ管理（管理者） =====
    await open('tab=admin&op=admin&auth=1');
    await shoot('14_admin_import', {
      from: '#view-admin .view-header',
      to: '#admin-sub-import',
      annotations: [
        { selector: '.admin-subtabs-nav', badge: '1', pad: 3 },
        { selector: '#admin-sub-import .action-btn-group', badge: '2', pad: 4 }
      ]
    });
    await evalJs(`(function(){ switchAdminSub('pin'); var r = document.querySelector('input[name="pin-mode"][value="specify"]'); r.checked = true; onPinModeChange(); return true; })()`);
    await shoot('15_admin_pin', {
      from: '#view-admin .view-header',
      to: '#admin-sub-pin',
      annotations: [
        { selector: 'input[name="pin-mode"]', closest: '.form-group', badge: '1', pad: 4 },
        { selector: '#pin-employee', closest: '.form-group', badge: '2', pad: 4 },
        { selector: '#pin-specify-group', badge: '3', pad: 4 },
        { selector: '#pin-confirm-group', badge: '4', pad: 4 },
        { selector: '#btn-issue-pin', badge: '5', pad: 4 }
      ]
    });
    await evalJs(`switchAdminSub('settings'), true`);
    await settle();
    await shoot('16_admin_settings', {
      from: '#view-admin .view-header',
      to: '#admin-settings tbody tr:nth-child(8)',
      annotations: [
        { selector: '#sheet-link', badge: '1', pad: 4 },
        { selector: '#admin-settings table', badge: '2', pad: 3 }
      ]
    });
  } finally {
    await browser.close();
  }
  const totalBytes = saved.reduce((sum, s) => sum + s.bytes, 0);
  console.log(`完了: ${saved.length} 枚 (計 ${(totalBytes / 1024).toFixed(0)} KB) を ${path.relative(projectRoot, outputDir)}/ に保存しました`);
  if (browser.consoleMessages.length > 0) {
    console.log('ページのエラー・警告:');
    browser.consoleMessages.slice(0, 10).forEach(m => console.log('  ' + m));
  }
})().catch(err => {
  console.error('撮影に失敗しました:', err.message);
  process.exit(1);
});

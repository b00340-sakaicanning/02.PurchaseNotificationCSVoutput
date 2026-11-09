/**
 * tools/build_manual.js
 * 操作マニュアルの原本 (gas_app/manual.template.html) の画像 (gas_app/manual_images/*.webp) を base64 で埋め込み、
 * GAS へ貼り付ける gas_app/manual.html を生成する (GAS には画像ファイルを置けないため)。
 * 実行: node tools/build_manual.js   (元は「01.エネルギー使用量集計」の gas_app/build.js のマニュアル部分)
 */

const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, '..', 'gas_app');
const templatePath = path.join(appDir, 'manual.template.html');
const outputPath = path.join(appDir, 'manual.html');
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

if (!fs.existsSync(templatePath)) {
  console.error('manual.template.html がありません: ' + templatePath);
  process.exit(1);
}
const missing = [];
let count = 0;
const html = fs.readFileSync(templatePath, 'utf8').replace(/src="(manual_images\/[^"]+)"/g, (match, relPath) => {
  const imagePath = path.join(appDir, relPath);
  if (!fs.existsSync(imagePath)) { missing.push(relPath); return match; }
  count++;
  const mime = MIME[path.extname(imagePath).toLowerCase()] || 'application/octet-stream';
  return `src="data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}"`;
});
const banner = '<!-- 生成物: node tools/build_manual.js が gas_app/manual.template.html から作る。直接は編集しない -->\n';
fs.writeFileSync(outputPath, html.replace(/^<!DOCTYPE html>\n/i, '<!DOCTYPE html>\n' + banner));
console.log(`生成しました: gas_app/manual.html（${(fs.statSync(outputPath).size / 1024).toFixed(0)}KB、画像 ${count}枚）`);
if (missing.length) {
  console.warn('画像が見つかりません（撮影し直してください）: ' + missing.join(', '));
  process.exit(1);
}

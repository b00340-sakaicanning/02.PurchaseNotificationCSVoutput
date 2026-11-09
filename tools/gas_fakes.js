/**
 * GAS サービスの簡易フェイク（ローカル検証用。K-49）
 *
 * gas_app/Code.gs と Tests.gs を、GAS の外（Node.js とブラウザ）で動かすためのもの。
 *  - tools/run_tests_node.js : Node.js でテストを実行する
 *  - local_preview.html       : ブラウザで本物の Code.gs をフェイクの上で動かす
 *
 * 再現しているのは Code.gs が使う範囲だけ。主な違い:
 *  - シートの書式は「@（書式なしテキスト）」以外の数字の文字列を数値に変える、という点だけを再現する
 *  - Shift_JIS は WHATWG の shift_jis（Windows-31J 相当）で変換する
 *  - ロックは常に取得でき、トリガーは登録するだけで実行しない
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // バイト列と文字コード
  // ------------------------------------------------------------------
  function toSigned(u8) { const a = new Array(u8.length); for (let i = 0; i < u8.length; i++) a[i] = u8[i] > 127 ? u8[i] - 256 : u8[i]; return a; }
  function toUnsigned(arr) { const u = new Uint8Array(arr.length); for (let i = 0; i < arr.length; i++) u[i] = (arr[i] + 256) % 256; return u; }
  function utf8Encode(s) { return new TextEncoder().encode(String(s)); }
  function charsetToDecoder(cs) {
    const c = String(cs || 'UTF-8').toLowerCase().replace(/[_\s]/g, '-');
    if (c === 'utf-8' || c === 'utf8') return 'utf-8';
    if (c === 'ms932' || c === 'windows-31j' || c === 'shift-jis' || c === 'sjis' || c === 'cp932') return 'shift_jis';
    throw new Error('Unsupported charset: ' + cs);
  }
  let SJIS_TABLE = null;
  function buildSjisTable() {
    const dec = new TextDecoder('shift_jis');
    const map = new Map();
    for (let b = 0xA1; b <= 0xDF; b++) map.set(dec.decode(new Uint8Array([b])), [b]);
    const leads = [];
    for (let b = 0x81; b <= 0x9F; b++) leads.push(b);
    for (let b = 0xE0; b <= 0xFC; b++) leads.push(b);
    leads.forEach(function (l) {
      for (let t = 0x40; t <= 0xFC; t++) {
        if (t === 0x7F) continue;
        const ch = dec.decode(new Uint8Array([l, t]));
        if (ch.length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, [l, t]);
      }
    });
    SJIS_TABLE = map;
  }
  function sjisEncode(str) {
    if (!SJIS_TABLE) buildSjisTable();
    const out = [];
    for (const ch of String(str)) {
      const code = ch.codePointAt(0);
      if (code < 0x80) { out.push(code); continue; }
      const b = SJIS_TABLE.get(ch);
      if (b) out.push.apply(out, b); else out.push(0x3F);
    }
    return new Uint8Array(out);
  }
  function encodeString(str, charset) {
    return charsetToDecoder(charset) === 'shift_jis' ? sjisEncode(str) : utf8Encode(str);
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64Encode(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 3) {
      const n = (u8[i] << 16) | ((u8[i + 1] || 0) << 8) | (u8[i + 2] || 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
    }
    return s;
  }
  function b64Decode(str) {
    const s = String(str).replace(/[^A-Za-z0-9+/]/g, '');
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
      const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((B64.indexOf(s[i + 2]) & 63) << 6) | (B64.indexOf(s[i + 3]) & 63);
      out.push((n >> 16) & 255);
      if (s[i + 2] !== undefined) out.push((n >> 8) & 255);
      if (s[i + 3] !== undefined) out.push(n & 255);
    }
    return new Uint8Array(out);
  }

  // SHA-256（同期）
  function sha256(bytes) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length;
    const withPad = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    withPad.set(bytes);
    withPad[l] = 0x80;
    const bits = l * 8;
    withPad[withPad.length - 4] = (bits >>> 24) & 255; withPad[withPad.length - 3] = (bits >>> 16) & 255;
    withPad[withPad.length - 2] = (bits >>> 8) & 255; withPad[withPad.length - 1] = bits & 255;
    const W = new Array(64);
    const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (let i = 0; i < withPad.length; i += 64) {
      for (let t = 0; t < 16; t++) W[t] = (withPad[i + t * 4] << 24) | (withPad[i + t * 4 + 1] << 16) | (withPad[i + t * 4 + 2] << 8) | withPad[i + t * 4 + 3];
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    const out = new Uint8Array(32);
    H.forEach(function (v, i) { out[i * 4] = (v >>> 24) & 255; out[i * 4 + 1] = (v >>> 16) & 255; out[i * 4 + 2] = (v >>> 8) & 255; out[i * 4 + 3] = v & 255; });
    return out;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', i = 0, inQ = false;
    const s = String(text);
    while (i < s.length) {
      const c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
        if (c === '\r' && s[i + 1] === '\n') i++;
        i++; continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function pad(n, w) { return ('000' + n).slice(-(w || 2)); }
  /** Asia/Tokyo（UTC+9 固定）として日時を整える */
  function formatDate(date, tz, fmt) {
    const d = new Date(date.getTime() + 9 * 3600000);
    const map = { yyyy: d.getUTCFullYear(), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()), HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()) };
    return String(fmt).replace(/yyyy|MM|dd|HH|mm|ss/g, function (t) { return String(map[t]); });
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  // ------------------------------------------------------------------
  // フェイク本体
  // ------------------------------------------------------------------
  function createGasFakes(options) {
    options = options || {};
    let idSeq = 1;
    const newId = function (p) { return (p || 'ID') + '_' + (idSeq++) + '_' + Math.random().toString(36).substr(2, 6); };
    const log = options.log || function () {};

    // ---- Blob ----
    function Blob(bytes, contentType, name) { this._b = bytes || new Uint8Array(0); this._t = contentType || 'application/octet-stream'; this._n = name || ''; }
    Blob.prototype.getBytes = function () { return toSigned(this._b); };
    Blob.prototype.getDataAsString = function (cs) { return new TextDecoder(charsetToDecoder(cs || 'UTF-8')).decode(this._b); };
    Blob.prototype.setDataFromString = function (s, cs) { this._b = encodeString(s, cs || 'UTF-8'); return this; };
    Blob.prototype.getContentType = function () { return this._t; };
    Blob.prototype.setContentType = function (t) { this._t = t; return this; };
    Blob.prototype.getName = function () { return this._n; };
    Blob.prototype.setName = function (n) { this._n = n; return this; };
    Blob.prototype.copyBlob = function () { return new Blob(new Uint8Array(this._b), this._t, this._n); };

    const Utilities = {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF-8' },
      formatDate: formatDate,
      getUuid: uuid,
      computeDigest: function (alg, value) {
        const bytes = typeof value === 'string' ? utf8Encode(value) : toUnsigned(value);
        return toSigned(sha256(bytes));
      },
      base64Encode: function (data) { return b64Encode(typeof data === 'string' ? utf8Encode(data) : toUnsigned(data)); },
      base64Decode: function (s) { return toSigned(b64Decode(s)); },
      newBlob: function (data, contentType, name) {
        const bytes = data === undefined || data === null ? new Uint8Array(0) : (typeof data === 'string' ? utf8Encode(data) : toUnsigned(data));
        return new Blob(bytes, contentType, name);
      },
      parseCsv: parseCsv,
      sleep: function () {}
    };

    // ---- Sheets ----
    function Range(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
    Range.prototype._each = function (fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r - 1 + i, this.c - 1 + j, i, j); };
    Range.prototype.getValues = function () {
      const out = [];
      for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.s._get(this.r - 1 + i, this.c - 1 + j)); out.push(row); }
      return out;
    };
    Range.prototype.getValue = function () { return this.s._get(this.r - 1, this.c - 1); };
    Range.prototype.setValues = function (vals) {
      if (vals.length !== this.nr || vals.some(function (row) { return row.length !== this.nc; }, this)) throw new Error('setValues: 行数・列数が範囲と一致しません');
      const self = this;
      this._each(function (ri, ci, i, j) { self.s._set(ri, ci, vals[i][j]); });
      return this;
    };
    Range.prototype.setValue = function (v) { const self = this; this._each(function (ri, ci) { self.s._set(ri, ci, v); }); return this; };
    Range.prototype.clearContent = function () { const self = this; this._each(function (ri, ci) { self.s._raw(ri, ci, ''); }); return this; };
    Range.prototype.getNumberFormats = function () {
      const out = [];
      for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.s._fmt(this.r - 1 + i, this.c - 1 + j)); out.push(row); }
      return out;
    };
    Range.prototype.setNumberFormats = function (f) { const self = this; this._each(function (ri, ci, i, j) { self.s._setFmt(ri, ci, f[i][j]); }); return this; };
    Range.prototype.setNumberFormat = function (f) { const self = this; this._each(function (ri, ci) { self.s._setFmt(ri, ci, f); }); return this; };
    Range.prototype.setFontWeight = function () { return this; };
    Range.prototype.insertCheckboxes = function () { return this; }; // 見た目だけの機能なので、フェイクでは何もしない
    Range.prototype.setBackground = function () { return this; };

    function Sheet(name, state) {
      this.st = state || { name: name, data: [], fmts: [], maxRows: 1000, maxCols: 26, hidden: false, protections: 0 };
    }
    Sheet.prototype.getName = function () { return this.st.name; };
    Sheet.prototype._get = function (r, c) { const row = this.st.data[r]; const v = row ? row[c] : undefined; return v === undefined || v === null ? '' : v; };
    Sheet.prototype._raw = function (r, c, v) { while (this.st.data.length <= r) this.st.data.push([]); this.st.data[r][c] = v; };
    Sheet.prototype._fmt = function (r, c) { const row = this.st.fmts[r]; return (row && row[c]) || 'General'; };
    Sheet.prototype._setFmt = function (r, c, f) { while (this.st.fmts.length <= r) this.st.fmts.push([]); this.st.fmts[r][c] = f; };
    Sheet.prototype._set = function (r, c, v) {
      if (typeof v === 'string') {
        if (v.charAt(0) === "'") v = v.substr(1);
        else if (this._fmt(r, c) !== '@' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v); // 書式なしテキストでなければ数値になる
        else if (this._fmt(r, c) !== '@' && /^(TRUE|FALSE)$/i.test(v)) v = v.toUpperCase() === 'TRUE';
      }
      this._raw(r, c, v);
    };
    Sheet.prototype.getMaxRows = function () { return this.st.maxRows; };
    Sheet.prototype.getMaxColumns = function () { return this.st.maxCols; };
    Sheet.prototype.getLastRow = function () {
      for (let r = this.st.data.length - 1; r >= 0; r--) { const row = this.st.data[r] || []; if (row.some(function (v) { return v !== '' && v !== undefined && v !== null; })) return r + 1; }
      return 0;
    };
    Sheet.prototype.getLastColumn = function () {
      let max = 0;
      this.st.data.forEach(function (row) { if (!row) return; for (let c = row.length - 1; c >= 0; c--) { if (row[c] !== '' && row[c] !== undefined && row[c] !== null) { max = Math.max(max, c + 1); break; } } });
      return max;
    };
    Sheet.prototype.getRange = function (r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      if (r < 1 || c < 1 || r + nr - 1 > this.st.maxRows || c + nc - 1 > this.st.maxCols) throw new Error('範囲の座標がシートのサイズ外です（' + this.st.name + ' r=' + r + ' c=' + c + ' nr=' + nr + ' nc=' + nc + '）');
      return new Range(this, r, c, nr, nc);
    };
    Sheet.prototype.getDataRange = function () { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); };
    Sheet.prototype.insertRowsAfter = function (after, n) {
      const fmtRow = (this.st.fmts[after - 1] || []).slice();
      this.st.data.splice(after, 0, ...new Array(n).fill(0).map(function () { return []; }));
      this.st.fmts.splice(after, 0, ...new Array(n).fill(0).map(function () { return fmtRow.slice(); }));
      this.st.maxRows += n;
      return this;
    };
    Sheet.prototype.insertColumnsAfter = function (after, n) { this.st.maxCols += n; return this; };
    Sheet.prototype.deleteRow = function (r) { this.st.data.splice(r - 1, 1); this.st.fmts.splice(r - 1, 1); this.st.maxRows--; return this; };
    Sheet.prototype.setFrozenRows = function () { return this; };
    Sheet.prototype.hideSheet = function () { this.st.hidden = true; return this; };
    Sheet.prototype.protect = function () {
      this.st.protections++;
      const p = { setDescription: function () { return p; }, removeEditors: function () { return p; }, getEditors: function () { return []; }, canDomainEdit: function () { return false; }, setDomainEdit: function () { return p; }, setWarningOnly: function () { return p; } };
      return p;
    };
    Sheet.prototype.getProtections = function () { return new Array(this.st.protections).fill({}); };

    const ssState = { id: newId('SS'), name: options.spreadsheetName || '物品購入届DB_開発', sheets: [] };
    const sheetObjs = {};
    function wrapSheet(st) { if (!sheetObjs[st.name]) sheetObjs[st.name] = new Sheet(st.name, st); return sheetObjs[st.name]; }
    const spreadsheet = {
      getId: function () { return ssState.id; },
      getName: function () { return ssState.name; },
      getUrl: function () { return 'https://docs.google.com/spreadsheets/d/' + ssState.id + '/edit'; },
      getSheetByName: function (n) { const st = ssState.sheets.filter(function (s) { return s.name === n; })[0]; return st ? wrapSheet(st) : null; },
      getSheets: function () { return ssState.sheets.map(wrapSheet); },
      insertSheet: function (n) { const sh = new Sheet(n); ssState.sheets.push(sh.st); sheetObjs[n] = sh; return sh; }
    };
    const uiLog = [];
    const menuChain = { addItem: function () { return menuChain; }, addSubMenu: function () { return menuChain; }, addSeparator: function () { return menuChain; }, addToUi: function () { return menuChain; } };
    const SpreadsheetApp = {
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      getActiveSpreadsheet: function () { return spreadsheet; },
      getUi: function () {
        return {
          Button: { OK: 'OK', CANCEL: 'CANCEL' }, ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
          createMenu: function () { return menuChain; },
          alert: function () { const msg = Array.prototype.slice.call(arguments).filter(function (a) { return typeof a === 'string'; }).join('\n'); uiLog.push(msg); log('[UI] ' + msg); },
          prompt: function () { return { getSelectedButton: function () { return 'CANCEL'; }, getResponseText: function () { return ''; } }; }
        };
      }
    };

    // ---- Drive ----
    const drive = { folders: {}, files: {} };
    function Folder(id) { this.id = id; }
    Folder.prototype.getId = function () { return this.id; };
    Folder.prototype.getName = function () { return drive.folders[this.id].name; };
    Folder.prototype.createFolder = function (name) { const id = newId('FOLDER'); drive.folders[id] = { name: name, parent: this.id }; return new Folder(id); };
    Folder.prototype.getFoldersByName = function (name) {
      const self = this;
      return iter(Object.keys(drive.folders).filter(function (id) { return drive.folders[id].parent === self.id && drive.folders[id].name === name; }).map(function (id) { return new Folder(id); }));
    };
    Folder.prototype.getFiles = function () {
      const self = this;
      return iter(Object.keys(drive.files).filter(function (id) { return drive.files[id].parent === self.id; }).map(function (id) { return new File(id); }));
    };
    Folder.prototype.createFile = function (blob) {
      const id = newId('FILE');
      drive.files[id] = { name: blob.getName(), parent: this.id, type: blob.getContentType(), b64: b64Encode(blob._b), trashed: false, updated: Date.now() };
      return new File(id);
    };
    function File(id) { this.id = id; }
    File.prototype.getId = function () { return this.id; };
    File.prototype.getName = function () { return drive.files[this.id].name; };
    File.prototype.getBlob = function () { const f = drive.files[this.id]; return new Blob(b64Decode(f.b64), f.type, f.name); };
    File.prototype.setTrashed = function (t) { drive.files[this.id].trashed = !!t; return this; };
    File.prototype.isTrashed = function () { return drive.files[this.id].trashed; };
    File.prototype.getLastUpdated = function () { return new Date(drive.files[this.id].updated); };
    File.prototype.makeCopy = function (name, folder) {
      const id = newId('FILE'); const f = drive.files[this.id];
      drive.files[id] = { name: name, parent: folder ? folder.getId() : f.parent, type: f.type, b64: f.b64, trashed: false, updated: Date.now() };
      return new File(id);
    };
    function iter(list) { let i = 0; return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } }; }
    const ROOT_ID = 'FOLDER_ROOT';
    drive.folders[ROOT_ID] = { name: 'マイドライブ', parent: null };
    drive.files[ssState.id] = { name: ssState.name, parent: ROOT_ID, type: 'application/vnd.google-apps.spreadsheet', b64: '', trashed: false, updated: Date.now() };
    const DriveApp = {
      getRootFolder: function () { return new Folder(ROOT_ID); },
      getFolderById: function (id) { if (!drive.folders[id]) throw new Error('フォルダが見つかりません: ' + id); return new Folder(id); },
      getFileById: function (id) { if (!drive.files[id]) throw new Error('ファイルが見つかりません: ' + id); return new File(id); }
    };

    // ---- Cache / Lock / Session / ScriptApp ----
    const cacheStore = {};
    const cache = {
      get: function (k) { const e = cacheStore[k]; if (!e) return null; if (e.exp < Date.now()) { delete cacheStore[k]; return null; } return e.v; },
      put: function (k, v, sec) { cacheStore[k] = { v: String(v), exp: Date.now() + (sec || 600) * 1000 }; },
      putAll: function (m, sec) { Object.keys(m).forEach(function (k) { cache.put(k, m[k], sec); }); },
      getAll: function (keys) { const o = {}; keys.forEach(function (k) { const v = cache.get(k); if (v !== null) o[k] = v; }); return o; },
      remove: function (k) { delete cacheStore[k]; },
      removeAll: function (keys) { keys.forEach(function (k) { delete cacheStore[k]; }); }
    };
    const CacheService = { getScriptCache: function () { return cache; } };
    const LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {}, hasLock: function () { return true; } }; } };
    const owner = options.ownerEmail || 'owner@example.com';
    const Session = { getEffectiveUser: function () { return { getEmail: function () { return owner; } }; }, getActiveUser: function () { return { getEmail: function () { return ''; } }; } };
    const triggers = [];
    const ScriptApp = {
      getProjectTriggers: function () { return triggers.slice(); },
      deleteTrigger: function (t) { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: function (fn) {
        const b = { timeBased: function () { return b; }, onMonthDay: function () { return b; }, atHour: function () { return b; }, everyDays: function () { return b; },
          create: function () { const t = { getHandlerFunction: function () { return fn; } }; triggers.push(t); return t; } };
        return b;
      },
      getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/LOCAL/dev'; } }; }
    };
    const HtmlService = { XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } };
    const Logger = { log: function (m) { log(String(m)); } };

    return {
      Utilities: Utilities, SpreadsheetApp: SpreadsheetApp, DriveApp: DriveApp, CacheService: CacheService, LockService: LockService,
      Session: Session, ScriptApp: ScriptApp, HtmlService: HtmlService, Logger: Logger,
      // テスト・プレビュー用の補助
      helpers: {
        uiLog: uiLog,
        triggers: triggers,
        addFile: function (folderId, name, bytes, type) {
          const id = newId('FILE');
          drive.files[id] = { name: name, parent: folderId, type: type || 'text/csv', b64: b64Encode(bytes), trashed: false, updated: Date.now() };
          return id;
        },
        driveFiles: function () { return drive.files; },
        exportState: function () { return JSON.stringify({ ss: ssState, drive: drive, cache: cacheStore, idSeq: idSeq }); },
        importState: function (json) {
          const s = JSON.parse(json);
          ssState.id = s.ss.id; ssState.name = s.ss.name; ssState.sheets = s.ss.sheets;
          Object.keys(sheetObjs).forEach(function (k) { delete sheetObjs[k]; });
          Object.keys(drive.folders).forEach(function (k) { delete drive.folders[k]; });
          Object.keys(drive.files).forEach(function (k) { delete drive.files[k]; });
          Object.assign(drive.folders, s.drive.folders); Object.assign(drive.files, s.drive.files);
          Object.keys(cacheStore).forEach(function (k) { delete cacheStore[k]; });
          Object.assign(cacheStore, s.cache || {});
          idSeq = s.idSeq || idSeq;
        },
        decodeBase64: function (b64) { return b64Decode(b64); },
        bytesToString: function (u8, cs) { return new TextDecoder(charsetToDecoder(cs)).decode(u8); }
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createGasFakes: createGasFakes };
  else root.createGasFakes = createGasFakes;
})(typeof window !== 'undefined' ? window : this);

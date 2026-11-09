# 06 サーバーAPI仕様

- 版: v1.1（2026/10/31。デザインとコピペ反映の方針を追加）
- 関数名・変数名はキャメルケース、定数は大文字のスネークケースにする（CLAUDE.md の命名規則）。
- サーバー処理は、すべて1つの `Code.gs` に書く（K-45）。【Auth】のような表記は、`Code.gs` の中のセクションを表す（02 §2.1）。
- 画面から呼ぶ関数は、すべて `Code.gs` の【Api】セクションに置く（本書で「`Code.gs`」と書いた関数は【Api】に置く）。中身の処理は、各セクションの関数に任せる。
- テスト関数は `Tests.gs` に分け、開発環境にだけ貼る（K-46）。

---

## 1. 共通の規約

### 1.1 引数 `ctx`
```js
ctx = { operatorId: 'xxx@sakai-canning.co.jp', token: 'uuid または null' }
```
- 画面から呼ぶ関数は、第1引数に必ず ctx を受け取る（`authenticate` を除く）。
- `Session.getActiveUser()` は使わない。実行ユーザーが「自分」で匿名アクセスのため、利用者を判別できないから（02 §6）。

### 1.2 戻り値
```js
{ ok: true,  data: {...} }
{ ok: false, error: { code: 'VALIDATION', message: '入力内容を確認してください', fields: { itemName: '必須です' } } }
```
- `Code.gs` の `handle_(fn)` で包み、例外は捕まえて上の形に変える。
  - 想定した例外は `AppError(code, message, fields)` として投げる。
  - 想定外の例外は `SYSTEM` にして、`console.error` に詳細を出す。
- 戻り値に `Date` 型を入れない（`google.script.run` で渡せないことがあるため）。日時は文字列で返す。

### 1.3 エラーコード
| コード | 意味 |
|--------|------|
| `VALIDATION` | 入力エラー（fields に項目ごとのメッセージ） |
| `AUTH_REQUIRED` | 暗証番号の認証が必要、または期限切れ |
| `AUTH_FAILED` | 暗証番号の誤り、または未発行 |
| `AUTH_LOCKED` | ロック中 |
| `FORBIDDEN` | 権限なし、または無効な操作者 |
| `CONFLICT` | バージョンの不一致（楽観ロック） |
| `NOT_FOUND` | 届出がない、または削除済み |
| `INVALID_STATE` | 今のステータスでは行えない操作 |
| `BUSY` | ロックを取得できない |
| `SYSTEM` | 設定エラー、または想定外のエラー |

---

## 2. 認証（【Auth】。04 §3.4）

| 関数 | 引数 | 戻り値 data | 備考 |
|------|------|-------------|------|
| `authenticate(operatorId, pin)` | 社員ID、暗証番号 | `{token, expiresAt}` | Code.gs から公開する |
| `logout(ctx)` | ctx | `{}` | キャッシュからトークンを消す |
| `verifyToken(ctx)` | ctx | true / false | 内部用 |
| `resolveRoles(operatorId, request)` | 社員ID、届出（新規なら null） | `{isApplicant, isApprover, isAdmin, isAccounting}` | 内部用 |
| `requireAuthIfNeeded(ctx, action, request)` | | 無し（ダメなら例外を投げる） | 04 §3.3 の判定。内部用 |
| `issuePin(employeeId, issuedBy)` | | `{pin}` | 内部用。管理者のAPIとメニューから呼ぶ |
| `hashPin_(salt, pin)` | | 16進文字列 | 内部用 |

---

## 3. 初期化・参照（`Code.gs`）

| 関数 | 引数 | 戻り値 data |
|------|------|-------------|
| `doGet(e)` | | `HtmlService.createTemplateFromFile('index').evaluate()` に、タイトル（APP_NAME）と viewport を付けたもの |
| `include(name)` | ファイル名 | html の文字列（テンプレートの中から使う） |
| `getInitData()` | （ctx 不要） | 下の表 |
| `getRequestList(ctx, query)` | `{tab:'ALL'\|'APPROVED'\|'REFLECTED'}` | `{rows:[一覧用の行], serverTime}` |
| `getRequestDetail(ctx, requestId)` | | `{request:全項目, logs:[...], attachments:[{slot, fileName}]}` |
| `getApproverCandidates(ctx, deptCode, applicantId)` | | `[{employeeId, name, priority}]` |
| `searchSuppliers(ctx, keyword, includeHidden)` | | `[{code, branch, name, kana, abbr, visible}]`（最大30件） |

**`getInitData()` の data**
```js
{
  appName, statusColors, statuses, permissions,   // permissions は 04 §3.2 の PERMISSIONS
  employees:   [{employeeId, name, division, section, defaultDeptCode}],  // 有効な社員のみ
  departments: [{deptCode, deptName, division, commonDeptCode}],          // 有効のみ・表示順
  categories:  [{categoryCode, categoryName}],
  approvers:   [{deptCode, approverId, priority}],                        // 有効のみ
  suppliers:   [{code, branch, name, kana, abbr}],                        // 表示=TRUE のみ
  deliveries:  [{code, branch, name}],
  roleHolders: { admins:[employeeId...], accountings:[employeeId...] },   // ボタン表示用
  limits: { attachmentMaxMb, attachmentAllowedExt, quantityDecimals, pinSessionMinutes, pinLength, listPageSize },
  requiredFields: { categoryCode:true, modelNo:false, … }               // 「入力項目」シートの必須（03 §3.11）。バッジの切り替えに使う
}
```
- 一覧の行には、届出データのうち、画面に出す列とボタンの判定に要る列（`requestId, status, version, applicantId, approverId` など）だけを入れる。
- `materialCandidates` は詳細と資材ダイアログでだけ返す。

---

## 4. 届出の保存と状態変更（【Workflow】）

| 関数（Code.gs で公開） | 引数 | 戻り値 data | 対応 |
|-----------------------|------|-------------|------|
| `saveRequest(ctx, payload, mode)` | payload（下記）、mode: `DRAFT`/`COMPLETE`/`REQUEST`/`EDIT` | `{requestId, version, status}` | 04 §4.2 |
| `changeStatus(ctx, requestId, version, action, options)` | action: `REQUEST`（一覧の行ボタン用）/`CANCEL_REQUEST`/`APPROVE`/`REJECT`/`CANCEL_APPROVAL`/`REVERT_REFLECTED`/`DELETE`。options: `{reason}` | `{requestId, version, status}` | 04 §2、§5 |
| `markReflected(ctx, items)` | `[{requestId, version}]` | `{results:[{requestId, version}]}` | T9 |

**payload**
```js
{
  requestId: '' | 'PR-...', version: 0 | n,
  deptCode, categoryCode, approverId,
  supplierType: 'マスタ'|'手入力'|'指定なし', supplierCode, supplierBranch, supplierName,
  deliveryType, deliveryCode, deliveryBranch, deliveryName,
  itemName, modelNo, quantity, unitNote, reason, deliveryDate   // 'yyyy/MM/dd' または ''
}
```
- payload の部門名・種別名・承認者名・発注先名（マスタのとき）は、サーバー側でマスタから設定し直す。画面から来た値は使わない。

**【Workflow】 の内部関数**
| 関数 | 役割 |
|------|------|
| `PERMISSIONS` | 定数。04 §3.2 の表 |
| `TRANSITIONS` | 定数。04 §2 の表 |
| `canPerform(action, request, roles)` | 許可するかどうか |
| `nextStatus(action, currentStatus)` | 遷移後のステータス（遷移が無ければ null） |
| `applyTimestamps_(row, action, operatorId, now)` | 04 §5 の表の処理 |
| `applyApprovedEditRules_(before, after)` | K-07 の処理 |
| `diffKeys_(before, after)` | 修正ログ用。変わった項目のキー |

---

## 5. 資材・コード・CSV・添付

| 関数（Code.gs で公開） | 引数 | 戻り値 data | 実装先 |
|-----------------------|------|-------------|--------|
| `getMaterialCandidates(ctx, requestId)` | | `{candidates:[...], current:{code, branch, subBranch, name, packQty, fixed}}` | 【MaterialMatcher】 |
| `recalcMaterialCandidates(ctx, requestId, version)` | | `{version, candidates}` | 同上 |
| `searchMaterials(ctx, query)` | `{keyword, categoryCode, deptCode}` | `[資材行]`（最大50件） | 同上 |
| `fixMaterial(ctx, requestId, version, material)` | `{code, branch, subBranch}` または null | `{version}` | 同上 |
| `fillCodes(ctx, requestId, version, codes)` | `{supplier:{code, branch}\|null, delivery:{code, branch}\|null}` | `{version}` | 【Workflow】 |
| `exportCsv(ctx, items)` | `[{requestId, version}]` | `{fileName, mimeType, base64, count, results}` | 【CsvExport】 |
| `uploadAttachment(ctx, requestId, version, slot, file)` | file: `{name, mimeType, base64}` | `{version, fileName}` | 【Attachment】 |
| `deleteAttachment(ctx, requestId, version, slot)` | | `{version}` | 同上 |
| `getAttachment(ctx, requestId, slot)` | | `{fileName, mimeType, base64}` | 同上 |

**内部関数（純粋な関数）**
- 次の関数は GAS のサービスを呼ばない形にし、`Tests.gs` で単体テストする。
  - 【MaterialMatcher】: `normalizeName`、`supplierPartOf`、`supplierMatch`、`rankMaterials(request, materials, departments, suppliers, limit)`
  - 【CsvExport】: `buildCsvText(rows, settings)`、`escapeCsvValue(value, settings)`、`calcDueDate(request, dateFormat)`、`endOfMonth(dateStr)`、`buildFileName(pattern, now)`
  - 【Validator】: `validateRequest(payload, level, masters)`、`normalizeQuantity(str, decimals)`、`isValidDate(str)`

---

## 6. マスタ取込（【MasterImport】。03 §4、04 §10）

| 関数 | 役割 |
|------|------|
| `importMasters(target, operatorId)` | 入口。`MATERIALS` / `SUPPLIERS` / `EMPLOYEES` / `ALL` |
| `findImportFile_(fileName)` | 取込フォルダから最新のファイルを探す |
| `readCsv_(file, charset)` | 文字コードを指定して `Utilities.parseCsv`。UTF-8 のときは BOM を除く |
| `importMaterials_()` | 全件入替（18列を抽出） |
| `rebuildDepartmentsAndCategories_()` | 03 §4.4 |
| `importSuppliers_()` | 03 §4.2 |
| `importEmployees_()` | 03 §4.3 |

- ファイル名と文字コードの対応は、【Config】 の `IMPORT_FILES` 定数に持つ（K-19）。
  - `資材マスター.csv` → `MS932`
  - `取引先マスター.csv` → `MS932`
  - `365User.csv` → `UTF-8`

---

## 7. 管理者API（`Code.gs`。K-14）

| 関数 | 引数 | 戻り値 data | 権限 |
|------|------|-------------|------|
| `adminImportMasters(ctx, target)` | target | `{results:[...]}` | 管理者＋暗証番号 |
| `adminIssuePin(ctx, employeeId, pin)` | pin: 指定する番号（空ならランダム） | ランダム: `{employeeId, name, pin, specified:false}`／指定: `{employeeId, name, specified:true}`（番号は返さない） | 管理者＋暗証番号 |
| `adminGetSettings(ctx)` | | `[{key, value, description}]` | 管理者＋暗証番号 |
| `adminPing(ctx)` | | `{}`（タブを開くときの認証確認用） | 管理者＋暗証番号 |

---

## 8. カスタムメニュー（【Menu】。K-02）

`onOpen()` で、メニュー「物品購入届」を追加する。

| 項目 | 関数 | 内容 |
|------|------|------|
| 初期セットアップ | `menuSetup()` | 03 のシートが無ければ作り、見出しと書式（書式なしテキスト・1行目固定）を設定する。設定シートの初期値を入れる（既存のキーは上書きしない）。ドライブのフォルダを作り、IDを設定する。暗証番号シートを保護して非表示にする。何度実行しても同じ結果になるようにする |
| マスタ取込 ▶ すべて／資材／発注先／社員 | `menuImportAll()` など | `importMasters` を呼び、結果をダイアログで出す |
| 部署・種別マスタを資材から更新 | `menuRebuildDeptCategory()` | 03 §4.4 |
| 暗証番号を発行 | `menuIssuePin()` | 社員IDを入力してもらい、発行した暗証番号をダイアログで1回だけ出す |
| バックアップトリガーを設定 | `menuInstallBackupTrigger()` | 04 §14 |
| 今すぐバックアップ | `runMonthlyBackup()` | 動作確認用 |
| キャッシュをクリア | `menuClearCache()` | マスタのキャッシュを消す |

- メニューから実行したときの操作者は `Session.getEffectiveUser().getEmail()`（オーナー）、役割は `システム` としてログに残す。

---

## 9. 内部のセクション（すべて `Code.gs` の中。`Tests.gs` だけ別ファイル）

| セクション | 主な関数・定数 |
|---------|---------------|
| 【Config】 | `SHEETS`（シート名）、`COLUMNS`（シートごとの見出しとキーの対応）、`STATUS`、`ACTIONS`（キーと日本語の操作名）、`DEFAULT_SETTINGS`、`IMPORT_FILES`、`getSetting(key)`、`getSettings()`（リクエストの間はメモリに持つ） |
| 【Utils】 | `AppError`、`nowString()`、`todayString()`、`formatDate(date, fmt)`、`toHalfWidth(str)`、`charLength(str)`、`chunkCachePut/Get`（100KBを超えるJSONを分けてキャッシュする） |
| 【Repository】 | `withLock(fn)`、`getSheet(key)`、`readAll(key)`（見出しで対応づけたオブジェクトの配列）、`findRowIndex(requestId)`、`getRequest(requestId)`、`insertRequest(obj)`、`updateRequest(rowIndex, obj)`、`appendLog(entry)`、`getMasters()`（キャッシュ付き）、`clearMasterCache()`、`nextRequestId(today)` |
| 【Validator】 | §5 のとおり |
| 【Notifier】 | `notify(event, request)`（04 §13） |
| `Tests.gs` | `test_` で始まるテスト関数と `runAllTests()`（08 §2） |

---

## 10. クライアント側の主な関数（`js.html`）

| 関数 | 役割 |
|------|------|
| `api(fn, ...args)` | `google.script.run` を Promise で包み、ctx を自動で付ける。`AUTH_REQUIRED` なら暗証番号ダイアログを出してからやり直す |
| `state` | 初期データ、操作者、認証トークン、一覧のキャッシュ、フィルタの状態 |
| `initApp()` | `getInitData` を呼び、操作者を戻し、タブを描く |
| `switchTab(name)` | タブを切り替え、必要ならデータを読む |
| `renderForm(request\|null)` / `collectForm()` / `applyButtons(request)` | 新規入力と修正モード |
| `renderRequestList()` / `applyFilters()` / `sortBy(col)` | 入力データ一覧 |
| `renderApprovedList()` / `renderReflectedList()` | 承認済一覧・反映済一覧 |
| `openDetail(requestId)` | 詳細モーダル |
| `openMaterialDialog(requestId)` / `openCodeDialog(requestId)` | 経理のダイアログ |
| `downloadBase64(fileName, mimeType, base64)` | CSV・添付のダウンロード |
| `canDo(action, request)` | `permissions` を使ってボタンの活性を判定する（サーバーの判定と同じ表） |
| `promptPin()` | 暗証番号ダイアログ |
| `showToast(message, type)` / `showCustomConfirm(title, msg, opts)` / `toggleLoading(show, msg)` | 共通部品（参考アプリと同じ名前と引数。05 §0.4） |

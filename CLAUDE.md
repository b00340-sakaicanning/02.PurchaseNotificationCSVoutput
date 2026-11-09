# CLAUDE.md
このファイルは、このリポジトリ内のコードを扱う際、Claude Code (claude.ai/code) に指針を提供するものです


# 基本情報

## 作業ルール(追加)


## 規約(追加)


## フォルダ構成(追加)
```
02.物品購入届CSV出力/
├── CLAUDE.md
├── GEMINI.md
├── prompt/                  # 要件定義作成用などのプロンプト
├── reference/
│   └── 各種マスタ/           # 販売管理システム・M365から出力したマスタCSV（取引先・資材・資材単価・商品・ブランド・365User）
├── plan_draft/              # 要件定義・構築手順のドラフト
│   ├── 00_実装計画書(要件定義).md
│   └── 00_実装計画書(構築手順).md
├── plan/                    # 詳細実装計画（README と 01〜09）
├── docs/                    # 設計・仕様ドキュメント（01〜05。フェーズ0以後の正式な仕様）
├── gas_app/                 # GAS エディタにコピペする原本
│   ├── Code.gs              # サーバー処理のすべて（13セクション【Api】〜【Menu】）
│   ├── index.html / css.html / js.html  # 画面（include でつなぐ）
│   ├── Tests.gs             # テストと開発用サンプルデータ（開発環境だけに貼る）
│   ├── appsscript.json      # マニフェスト
│   ├── manual.html          # 操作マニュアル（生成物。画像を内包。GAS に manual として貼る）
│   ├── manual.template.html # 操作マニュアルの原本（本文と CSS）
│   └── manual_images/       # 操作マニュアルの図（WebP）
├── tools/                   # ローカル検証用（Node.js。GAS には貼らない）
│   ├── gas_fakes.js         # GAS サービスのフェイク
│   ├── run_tests_node.js    # テスト実行
│   ├── preview_mock.js      # local_preview.html の架空データ
│   ├── build_local_preview.js  # local_preview.html の生成
│   ├── mobile_frame.html    # 幅375pxの確認用フレーム
│   ├── build_manual.js      # gas_app/manual.html の生成（図を埋め込む）
│   ├── capture_manual_screenshots.js  # 操作マニュアルの図の撮影（local_preview.html を使う）
│   └── browserDriver.js     # ヘッドレス Chrome の操作部品（撮影用）
├── local_preview.html       # 生成物（ブラウザで開くと本物の Code.gs がフェイク上で動く）
├── screenshot/              # 画面確認の採取物
└── history/                 # 変更履歴
```

## ドキュメント(追加)
| ファイル | 用途 |
|---------|------|
| plan_draft/00_実装計画書(要件定義).md | 要件定義のドラフト（決定事項・未決事項を含む） |
| plan_draft/00_実装計画書(構築手順).md | 構築手順のドラフト |
| plan/README.md | 計画書の読み順と、実装AI向けの作業ルール |
| plan/01_決定事項と仮決め一覧.md | 確定事項・仮決め・未決事項・確認事項 |
| plan/02_システム構成.md | 全体構成、ファイル構成、通信、認証、デプロイ、開発環境と本番環境 |
| plan/03_データ設計.md | シートの列定義、設定キー、マスタ取込の規則 |
| plan/04_業務ロジック仕様.md | ステータス・権限・入力チェック・資材候補・CSV・排他制御 |
| plan/05_画面仕様.md | 画面・ボタン・ダイアログ・メッセージ・local_preview.html |
| plan/06_サーバーAPI仕様.md | GAS の関数一覧と引数・戻り値・エラーコード |
| plan/07_タスク一覧.md | フェーズ0〜12のタスクと完了条件 |
| plan/08_テスト計画.md | テストケース |
| plan/09_プロンプト修正ガイド.md | フェーズ別プロンプト、変更の影響箇所マップ |
| docs/01_要件定義書.md | 機能要件・非機能要件・未決事項の変える場所 |
| docs/02_システム設計.md | 全体構成・ファイル構成・画面構成・処理の流れ |
| docs/03_データ設計.md | シートの列定義・設定キー・マスタ取込の規則 |
| docs/04_実装仕様.md | 業務ロジック・API・実装メモ |
| docs/05_セットアップ手順.md | GAS への貼り付け・開発環境・本番環境・運用 |



# 技術的情報

## 技術スタック
- **言語**: Google Apps Script（V8）、HTML/CSS/JavaScript（HtmlService の SPA。外部の読み込みは Google Fonts のみ）
- **スタイリング**: 素の CSS（`gas_app/css.html`）。デザインは `../02.ロッカーキー貸出管理(Gemini)` と同じテイスト（plan/05 §0）
- **外部API**: なし（GAS 標準サービス: SpreadsheetApp、DriveApp、CacheService、LockService、Utilities）
- **データ**: Google スプレッドシート `物品購入届DB`（コンテナバインド）、添付は Google ドライブ
- **設定管理**: スプレッドシートの「設定」シート（キーと値）。clasp は使わず、`gas_app/` の原本を GAS エディタにコピペして反映する

## よく使うコマンド
- `node tools/run_tests_node.js` … Code.gs / Tests.gs をフェイク上でテスト（reference のマスタCSVも取り込む）。`--pure` で pure テストだけ
- `node tools/build_local_preview.js` … local_preview.html を作り直す（画面を変えたら必ず実行する）
- `node tools/capture_manual_screenshots.js` … 操作マニュアルの図を撮り直す（画面を変えたとき。1〜2分）
- `node tools/build_manual.js` … 操作マニュアル（gas_app/manual.html）を作り直す


## アーキテクチャ方針


## プロジェクト固有のルール
- デザイン、表示内容が更新される変更を加えた場合、local_preview.htmlも更新する


# Compact Instructions
- 機能的な変更に関する変更履歴を優先的に残す
- 続いて不具合に対応した内容の変更履歴を残す
- 最後にデザイン変更に関する変更履歴を残す


# プロジェクト情報

## プロジェクト概要


## ファイル構成


## 重要な制約・決定事項


## 現在の状態


## ドキュメント

# tecscde-dt-el
TECSCDEデスクトップアプリを、AIコーディングエージェントを用いて、Electronに移植する実験プロジェクトです。
- 今回の移植に際して、新規作成したTECSCDE-DT-EL内部仕様に基づく、Electron固有の実装です。
- 移植対象は以下の通りです。
  - https://www.toppers.jp/download.cgi/tecscde-MinGW-V0.5.0.tgz
- 2026-10-11現在、開発中です。
- 開発ドキュメント（Markdown形式ファイル）を、開発の記録として、以下で公開しています。
  - https://github.com/toppers/obsidian-mind-yk
  - ただし、Github上で閲覧できるぐらいのものとお考え下さい。
- AIコーディングエージェントとして、Claude Code, Codexを用いています。
- `tecscde-js`（JS, browser）、`tecscde-ts`（TS classes, browser）に続く第3弾です。
  - ただし、`tecscde-js`、`tecscde-ts` は移植の実験プロジェクトのプロトタイプの位置づけであり、未公開です。
    - どちらも、エラーが発生せずに起動し、サンプル用のCDLを図形表示するぐらいの機能しかありません。 
- 元になったTECSCDEがRuby/GTKによるデスクトップアプリであったため、使い勝手を合わせやすいElectron版の実装を進めています。

- 現在は、Windows版でのみ動作確認をしています。

# 移植方法(AIコーディングエージェント使用)
 - obsidian(https://obsidian.md/), obsidian-mind(https://github.com/breferrari/obsidian-mind)を利用
   - obsidian-mindにより、目標設定、タスクの優先度設定を行い、日次のタスクの割り当て、タスクの進捗状況の管理(obsidian内のドキュメントの変更だけでなく、別のリポジトリでの作業内容もgitの履歴なども調査して報告してくれる)、obsidian内でのドキュメント(ノート)の新規作成、修正、削除、フォーマットの修正、ノート間のリンクの修正、1週間単位の振り返り、四半期ごとの振り返りなど、また、間違いが発生した場合の原因究明、その時点での対応策の提案、今後のための改善策の提案、保留事項のリマインド、目標設定の提案ををAIコーディングエージェントが行うようにスキル、hook、サブエージェント、ドキュメントのテンプレートなどを備えている
 - orca(https://github.com/stablyai/orca)を利用。複数のAIコーディングエージェントに、異なるタスを実行させることができる(gitのworktreeを用いて、それぞれ異なるディレクトリで実行させるので衝突が発生しない）。
   - さまざまなAIコーディングエージェントに対応。
   - プロジェクト(リモートのリポジトリなど)、プライマリワークスペース(ローカルにプロジェクトをcloneした場所)、ワークスペース(プライマリワークスペースに対し、まったく別ディレクトリ(サブディレクトリでないという意味)に作成したディレクトリ(git のworktreeとして作成)が存在する。
   - ワークスペース毎にターミナルを割り当てる(同時にAIコーディングエージェントも割り当てられる)。
   - ワークスペースは、複数のターミナルも持つことができる。
   - ターミナル内の分割も可能。
   - ターミナルを起動するのはorca。ターミナルとAIコーディングエージェントの間にorcaが介在する。
     - ワークスペースに紐づけれらフォルダの管理、バージョン管理、AIコーディングエージェントのセッション管理を会話とは別ウィンドウで行える
 - llm-wiki(https://github.com/nvk/llm-wiki), Claude Code(plugin: wiki @ llm-wiki でインストール)で利用。llm-wikiにTECSの仕様を取り込み、参照できるようにする。
   - 「組み込みコンポーネントシステムTECS仕様書 暫定第一版(V1.0.2.32)」(https://www.toppers.jp/download.cgi/tecs_package-20120608.tar.gz に収録されている`tecs_spec.pdf`)をllm-wikiに取り込む
   - 「TECSマニュアル」(https://tecs-docs.readthedocs.io/ja/latest/index.html)をllm-wikiに取り込む
 - (https://github.com/stablyai/orca)
 - Ruby版TECSCDEのソースコード -> Ruby版クラス別内部仕様書 -> Ruby版外部仕様書を自動生成させた(人間はAIに指示するのみ)
 - Ruby版TECSCDEのソースコード、Ruby版クラス別内部仕様書、Ruby版外部仕様書を参照して、JavaScript版(フレームワーク非依存）TECSCDE外部仕様を生成させた(人間はAIに指示するのみ)
 - JavaScript版(フレームワーク非依存）TECSCDE内部仕様を生成させた(人間はAIに指示するのみ)
 - JavaScript版(フレームワーク非依存-ブラウザ単体）TECSCDEのソースコードを生成させた(人間はAIに指示するのみ)　すべて関数のみで実装された
 - TECSCDE-実装アーキテクチャ案 JavaScript版(フレームワーク非依存-ブラウザ単体）TECSCDE内部仕様を元に、TypeScript実装の具体的なパッケージ構成・型設計・テスト戦略を提案させた(人間はAIに指示するのみ)
 - TECSCDE-実装アーキテクチャ案をもとに、TypeScript版(フレームワーク非依存-ブラウザ単体）のソースコードを生成させた(人間はAIに指示するのみ)
 - TypeScript（クラスベース）版(フレームワーク非依存-ブラウザ単体）TECSCDE内部仕様を生成させた(人間はAIに指示するのみ)
 - TECSCDE-TS-実装アーキテクチャ案 TECSCDE-TS内部仕様（クラスベース）と整合するTypeScript実装アーキテクチャ案を提案させた(人間はAIに指示するのみ)
 - TECSCDE-TS-実装アーキテクチャ案をもとに、TypeScript(クラスベース)版(フレームワーク非依存-ブラウザ単体）のソースコードを生成させた(人間はAIに指示するのみ)
 - TECSCDE-DT 外部仕様（デスクトップアプリ版）を、JavaScript版(フレームワーク非依存-ブラウザ単体）TECSCDE外部仕様をもとに、ElectronとTauriで実装することを前提として、新規作成させた(人間はAIに指示するのみ)
 - TECSCDE-DT-EL 内部仕様（デスクトップアプリ版）を、TECSCDE-DT外部仕様をElectronに固有化して実装するための内部仕様として、新規作成させた(人間はAIに指示するのみ)
   - ただし、Electronは多少の経験はあるものの、Tauriはまったく未経験であった
     - 現時点では、ElectronとTauriの共通点、相違点を意識して実装を進めるよりは、デスクトップアプリとしてのTECSCDEの実装に関する知見を深める方がよいと判断
     - Electron固有であるか否かを判断の基準にせず、Electronで実現可能であるかを判断基準に変更し、ドキュメントに明記させた(人間はAIに指示するのみ)
　 - TECSCDE-TS内部仕様（クラスベース）と共通化できる項目を、TECSCDE-TS内部仕様（クラスベース）の該当項目への参照と明記させた(人間はAIに指示するのみ)
　 - UI処理と、UIから独立に処理できる部分を明確化する提案を承認して、ドキュメントに明記させた(人間はAIに指示するのみ)
   - TECSCDE-TS実装のmodel/cdl/diagnosticsのソースコードのそのままの移植の提案を承認し、ドキュメントに明記させた(人間はAIに指示するのみ)
 - Electron固有の部分をドキュメントに明記させた(人間はAIに指示するのみ)
   - プロセス(main/render/preload)境界の明確化の提案を承認し、ドキュメントに明記させた(人間はAIに指示するのみ)
 - どの状態になったら完了とするかを決定し、基本方針に明記させる。
   - Ruby版TECSCDEのテストと同一の結果が得られることなど
 - AIに、Ruby版TECSCDEのテストを実行させ、Ruby版におけるテスト結果を採取させる。
 - TECSCDE-DT-EL 内部仕様（デスクトップアプリ版）をもとに、Electron向けのTypsScriptのソースコードを生成させ、テスト結果を報告させた(人間はAIに指示するのみ)
 - AIがすべてのフェーズの完了を報告したら、人間が必要と思う確認をし、完了を承認する。

## What this is

内部仕様書が推奨する最初の実装単位（第11.4章）：

1. **Model + CDL parser/serializer の往復** — `tecscde-ts`
   （`src/renderer/model/`, `src/renderer/cdl/`, `src/renderer/diagnostics/`）からそのまま移植。
   仕様上、これらのモジュールは2つの設計間で同一と規定されているため（第3、5、6、8章）。
2. **IPCゲートウェイの配管を、UIより先に検証** — `FileService`/`TecsgenRunner`
   （main process）→ `ipc.ts` → `preload/index.mts`（`contextBridge.exposeInMainWorld`）→
   `FileGateway`/`TecsgenGateway`/`ClipboardGateway`（renderer）。
   仕様書が本文書特有の新たなリスクとして指摘している部分（第11.4章 項目2）です。
   UIの作業を先行させると、`contextIsolation`/`sandbox`設定の不備が後になって発覚するためです。

## Directory structure (per chapter 10)

```
src/
  main/       — FileService (dialog+fs), TecsgenRunner (child_process), ipc.ts, index.ts,
                app-settings.ts (設定の永続化), log-service.ts (診断ログ出力)
  preload/    — contextBridge.exposeInMainWorld('tecscde', ...)
  renderer/
    app/                          — AppStore, AppShell, 各パネル, import解決
    model/, cdl/, diagnostics/    — tecscde-ts から変更なしに移植
    commands/, render/, view-state/, tecsgen/, cdecl/
    gateways/                     — renderer側のIPCプロキシ
  shared/     — 3つのプロセス全てで共有される型（ランタイムコードなし）
```

## Commands

```
npm start             # build（renderer + main）してから electron . を起動
npm test              # vitest — 346 tests（model/cdl は移植分を含む。main/preload/renderer）
npm run build         # renderer の型検査 + バンドル、main+preload を dist/ へコンパイル
npm run depcruise     # renderer ↛ electron / main ↛ renderer を強制（第10.1章）
npm run check         # build + test + depcruise
npm run forge:package # electron-forge package（asar、インストーラなし）
npm run forge:make    # electron-forge make（Squirrel .exe インストーラ、Windowsのみ）
```

`FORGE_OUT_DIR` を設定すると、forge の出力先を変更できます。

## Plugin-generated celltypes

CDLを開くと、一時的な `-g` ディレクトリを指定して `tecsgen` が実行され、生成されたすべての `.cdl` が型定義として読み込まれます。生成されたセルや一時的なパスは、ダイアグラム、保存されるCDL、およびセッションの参照対象から除外されます。`.tecsgen-opts` ファイルを開く場合は、プラグインのライブラリパスを含む元のコマンドラインオプションが使用されます。信頼できるプロジェクトのみを開いてください。tecsgenはそれらに含まれるプラグインを実行します。

`tecsgen` は `PATH` に含まれている必要があります。あるいは、起動前に `TECSGEN_COMMAND` に `ruby "C:\path\to\tecsgen.rb"` や `python -m tecsgen` といったコマンドを設定してください。Windowsで、Rubyのプラグインが `gcc` を必要とする場合は、あらかじめ同じターミナルで `ridk enable` を実行してください。`tecsgen` が利用できない場合でも通常のCDLは開けますが、未解決の生成型は診断警告（`W-PLUGIN-TYPE-LOAD`）として残ります。

Cプリプロセッサ（`import_C` 等）は既定で `gcc -E -DTECSGEN` を使用します。`#include "kernel.h"` のようなプロジェクト内ヘッダを解決できるよう、import パスが `-I` として渡されます。

## Diagnostics log

診断パネルに表示される内容は、`tecscde-log-YYYYMMDD-HHMMSS.txt` にも追記されます。カレントディレクトリを優先し、書き込めない場合は他のディレクトリにフォールバックします。書き込みに失敗してもアプリは停止しません。ログファイルは `.gitignore` 対象です。

ウィンドウに依存しない設定（ファイルブラウザのルート、前回のセッションのファイル一式）は、Windowsでは Local AppData 配下に保存されます。

## What's verified vs. not

- ✅ モデルとCDLのパーサー／シリアライザーのラウンドトリップ（移植したテストは引き続きパス）。
- ✅ 実ファイルシステムとモック化した `child_process` による `FileService`（アトミック書き込み、ダイアログのキャンセル処理）および `TecsgenRunner`（ENOENT、非ゼロ終了コード）のテスト。
- ✅ `preload`、`main/ipc.ts`、レンダラー側ゲートウェイ間の IPC *コントラクト*（チャネル名、引数の構造）— `electron` をモック化して検証済み。
- ✅ **実機での `electron .` 起動**を複数回にわたり対話的に検証（2026-09-08 ～ 2026-09-21）：
  `sandbox: false` 下での `contextBridge` による分離（仕様 11.2 #1、決定済み）、preload の ESM 読み込み、
  レンダラーのバンドルと読み込み、パッケージ化後（asar）の起動をすべて確認。
- ✅ 第4章（コピー／貼り付け／切り取り）、第5～6章（レンダリング／ビュー状態）、第7章
  （ファイルI/O：ファイルブラウザ含む。7B/7C/7D/7E）、第8章（診断）、第9章
  （tecsgen統合：`TecsgenResultParser`、`CdeclExtractor` 含む）、およびUIシェル（モジュールG）が実装済み。
  詳細な進捗ログは `[[work/active/TECSCDE-DT-EL実装]]` を参照。
- ❌ 未実装：コード署名（インストーラーは未署名のため Windows SmartScreen の警告が出ます）、および macOS/Linux 向けパッケージング。
  いずれも仕様 11.2 #2 に基づき未決のままです。
  `[[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 11 未決事項と実装単位案]]` を参照。

## Installing / Updating

現時点ではWindowsのみ対応しています（上記「What's verified vs. not」を参照）。

以下は計画中の手順です（一部まだ実装されていません）。

1. このリポジトリの [Releases](https://github.com/toppers/tecscde-dt-el/releases) ページから最新の `Setup.exe` をダウンロードして実行します。
   インストーラーは未署名のため、Windows SmartScreen の警告が表示されます（「詳細情報」→「実行」を選択）。
2. インストール後、アプリは `update-electron-app`（`update.electronjs.org` 経由でこのリポジトリの GitHub Releases を参照）により自動で更新を確認し、次回の再起動時に適用します。以降のバージョンで手動の再ダウンロードは不要です。

リリース自動化（`.github/workflows/release.yml`）は、`v*` タグがプッシュされるたびに新しいリリースをビルドして公開します（Node 22 固定。新しい Node では `@electron/packager` がハングするため）。
設計は `[[work/active/tecs/TECSCDE-DT-EL 配布アーキテクチャ決定]]` を参照。

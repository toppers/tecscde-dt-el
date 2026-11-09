# TECSCDE-DT-EL 外部仕様・内部仕様・ソースコードの整合性監査

監査日: 2026-11-08。ソース基準: `5cf2d85`、ブランチ`ykominami/TECSCDE-DT-EL-codex`、package版`0.1.0`。仕様書基準: Vault `093629f`。

確認した不一致は**69件**（実装との差66件、内部説明の不一致2件、V0.2.0予定成果物の未整備1件）。現行正式仕様のV0.2.0差分を優先し、旧版の実装記録・未決事項を区別した。将来機能の未実装は現在のリリースの回帰バグを意味しない。共通原因はまとめて数え、設計確認事項・checkout差は末尾へ分離した。今回番号は過去監査の番号とは別である。

コードと仕様書は変更していない。既存の`.gitignore`変更を保持し、監査成果物として本ファイルのみ追加した。ソースパスは作業リポジトリから、仕様の`work/active/...`はObsidian Vaultからの相対パス。各項目に該当根拠、影響、修正方針を示す。内部の詳細欠落はその旨を記載し、架空の契約を補っていない。

## 一覧

| 番号 | 分類 | 項目 |
|---:|---|---|
| 1 | 内部説明 | [内部04Hのシステム定義CDL説明が古い](#issue-1) |
| 2 | 内部説明 | [内部03Bの残差一覧に削除済み関数が残る](#issue-2) |
| 3 | 実装差 | [ソース別保存checkpoint・非同期ticket・パス別保存キューが未実装](#issue-3) |
| 4 | 実装差 | [終了時の保存待機・最新dirty問い合わせが未実装](#issue-4) |
| 5 | 実装差 | [一括DTO・primarySourceKey・sourceOrderと永続化が未実装](#issue-5) |
| 6 | 実装差 | [非同期openの要求世代・文書revision抑止が未実装](#issue-6) |
| 7 | 実装差 | [主ファイルなし・空セッションを復元せずsamplesへ置換する](#issue-7) |
| 8 | 実装差 | [session復元でopts再解析importPathsを採用しない](#issue-8) |
| 9 | 実装差 | [OS関連付けの複数入力・既起動instance配送・受付キューが未実装](#issue-9) |
| 10 | 実装差 | [拡張子判定が大小文字非区別へ未追随](#issue-10) |
| 11 | 実装差 | [-S配下の_CDL_FILES.txt探索が全層未実装](#issue-11) |
| 12 | 実装差 | [絶対-I/-Sをjoinで連結し探索先を壊す](#issue-12) |
| 13 | 実装差 | [basenameだけの既読キャッシュがimport探索を迂回する](#issue-13) |
| 14 | 実装差 | [settings read-merge-writeの直列化が未実装](#issue-14) |
| 15 | 実装差 | [settings/lastSessionの実行時型検証・正規化が未実装](#issue-15) |
| 16 | 実装差 | [消去で保持するとした参照の本文・未保存編集をモデルから落とす](#issue-16) |
| 17 | 実装差 | [主ファイル未確定時のCtrl+手動追加を無通知で拒否する](#issue-17) |
| 18 | 実装差 | [CDL一覧生成サービス・IPCが未実装](#issue-18) |
| 19 | 実装差 | [配列結合の添字省略・混在判定が未反映](#issue-19) |
| 20 | 実装差 | [固定長・可変長配列が要素ごとのポートへ展開されない](#issue-20) |
| 21 | 実装差 | [ポート選択・移動・辺変更とポート起点の結合削除へ到達できない](#issue-21) |
| 22 | 実装差 | [Insertによる可変長配列要素挿入と拒否通知が未実装](#issue-22) |
| 23 | 実装差 | [Deleteによる配列要素削除と先頭・固定長拒否が未実装](#issue-23) |
| 24 | 実装差 | [未結合末尾配列要素の個数保存・復元が未実装](#issue-24) |
| 25 | 実装差 | [複数セルのコピー・貼り付けが内部結合を保持しない](#issue-25) |
| 26 | 実装差 | [読み込み時の衝突回避・最小用紙選択・overflow通知が未実装](#issue-26) |
| 27 | 実装差 | [複数ファイルの用紙採用元・競合警告・用紙保存先が契約に未対応](#issue-27) |
| 28 | 実装差 | [通常の再配置・全体再配置が未実装](#issue-28) |
| 29 | 実装差 | [主ファイル保存のセル・結合レイアウトの定義元選別が不統一](#issue-29) |
| 30 | 実装差 | [読み取り専用セル由来の結合作成・バー移動が拒否されない](#issue-30) |
| 31 | 実装差 | [セルタイプ未選択・接続済み呼び口の操作が無通知で終わる](#issue-31) |
| 32 | 実装差 | [保存済み結合経路の要素・端点整合検証が不足](#issue-32) |
| 33 | 実装差 | [セル・ポート・結合レイアウト内部の未知キーを保存で失う](#issue-33) |
| 34 | 実装差 | [情報ボタン・版情報モーダル・コピー・設定欄のUIがない](#issue-34) |
| 35 | 実装差 | [ファイルブラウザ・セルタイプ一覧のモードレス化が未反映](#issue-35) |
| 36 | 実装差 | [廃止対象の表示制御バーが現役のまま](#issue-36) |
| 37 | 実装差 | [セルの定義元フルパス・読取専用表示ボタンがない](#issue-37) |
| 38 | 実装差 | [セルタイプ詳細モーダルと定義ファイルのフルパス・閲覧がない](#issue-38) |
| 39 | 実装差 | [複数セル選択時に共通編集項目を出さず、一律に案内だけを表示する](#issue-39) |
| 40 | 実装差 | [選択肢付き属性をコンボにせず、すべて自由入力フィールドにする](#issue-40) |
| 41 | 実装差 | [用紙変更・Undo/Redo・アプリケーション既定の設定と新規適用が未実装](#issue-41) |
| 42 | 実装差 | [現在の入力モードをステータスへ文字表示しない](#issue-42) |
| 43 | 実装差 | [未保存状態をウィンドウタイトルへ反映しない](#issue-43) |
| 44 | 実装差 | [activeセルの青背景・状態色優先順位が未実装](#issue-44) |
| 45 | 実装差 | [activeOnlyフィルタと操作UIが未実装](#issue-45) |
| 46 | 実装差 | [ポート選択に追従する赤い太線の結合強調が未実装](#issue-46) |
| 47 | 実装差 | [リージョン矩形モード・親子外周・名前表示が未実装](#issue-47) |
| 48 | 実装差 | [RO・!・Uの独立記号/状態凡例/理由表示が未実装](#issue-48) |
| 49 | 実装差 | [SVG・PNG・PDF出力と表示スナップショット・バイト列IPCが未実装](#issue-49) |
| 50 | 実装差 | [位置のみの診断からソースの行・列へジャンプできない](#issue-50) |
| 51 | 実装差 | [診断の図ジャンプが非表示フィルタを緩和しない](#issue-51) |
| 52 | 実装差 | [診断一覧が4列表でなく1行文字列のdivで、種別/該当箇所/移動操作が独立しない](#issue-52) |
| 53 | 実装差 | [シグニチャ名検索で結合をヒットさせず、ポートを持つセルだけが一致する](#issue-53) |
| 54 | 実装差 | [ジャンプで緩和した事実のrevealed印が再描画直後に失われる](#issue-54) |
| 55 | 実装差 | [フィルタで消した選択セルの枠だけがcanvasに残る](#issue-55) |
| 56 | 実装差 | [ナビゲータの縮小図・ドラッグ・手動表示の上書きが未対応](#issue-56) |
| 57 | 実装差 | [ポート記号の向き・3mm寸法・ズーム追従が仕様と異なる](#issue-57) |
| 58 | 実装差 | [アクティブセル最上段移動のボタン・計画・コマンド・結果通知が未実装](#issue-58) |
| 59 | 実装差 | [V0.2.0のtecsgen設定・自動探索・保存後の再確認が未実装](#issue-59) |
| 60 | 実装差 | [確定済みのPlugin型取り込み内部経路・方式選択が未実装](#issue-60) |
| 61 | 実装差 | [TECSGEN_COMMANDが空文字のとき、起動失敗にせず既定コマンドへ戻る](#issue-61) |
| 62 | 実装差 | [コピー用コマンドが、引用符を含むcpp等を正しく引用しない](#issue-62) |
| 63 | 実装差 | [アプリ版がpackage.jsonへ一本化されず、診断ログ先頭行にも版がない](#issue-63) |
| 64 | 実装差 | [診断ログが固定logs/ではなく起動cwd優先になる](#issue-64) |
| 65 | 実装差 | [診断ログの新しい30個以外を削除する保持処理がない](#issue-65) |
| 66 | 実装差 | [ログ書込失敗が画面の一度限りの警告にならない](#issue-66) |
| 67 | 実装差 | [診断もtecsgen版もない正常起動でログを作り得る](#issue-67) |
| 68 | 実装差 | [複数行メッセージが診断ログの1行1件規則を破る](#issue-68) |
| 69 | 予定成果物 | [V0.2.0のユーザーズ／リファレンスマニュアル成果物がworkspaceに未整備](#issue-69) |


## 詳細


<a id="issue-1"></a>

## 1. 内部04Hのシステム定義CDL説明が古い

分類: 内部仕様内の矛盾・古い説明

04H.4B.9はmain判定・未着手とするが、03.2と実装はloader内isUnderAnyによるソース単位判定が実装済み。旧記録と現設計の区別がない。

- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04H CDLパーサの診断・断片・拡張点.md:49`: 「[[work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 03 モデル設計|3.2節]]のとおり、`CdlSource`に`systemDefined`を加え、`loadSources`が`Cell`へ`systemDefined`を渡し、`editable`を算出する。判定そのものは`CdlDocumentLoader`の外（main側の`isUnderAny`）で行い、ここではソースの属性として受け取る。実装は未着手。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 03 モデル設計.md:46`: 「- **判定の置き場所**（2026-10-22実装）: `CdlDocumentLoader.loadSources()`（第7C章7.7.4節）が、`LoadOptions.systemDirs`と各`CdlSource.sourcePath`から`systemDefined`を決め、セルの生成時に渡す。パス比較の`isUnderAny(path, dirs)`は、依存の無い純粋関数として`shared/path-under.ts`に置き、main・rendererの両方から使える（当初案の「mainで比較して結果をrendererへ渡す」は採らなかった。`OpenFileEntry`に判定結果を載せる変更が要らず、`import`自動追跡など開く…」
- [document-builder.ts](<../../src/renderer/cdl/document-builder.ts:251>): 「const systemDefined =」

推奨修正: 04Hを03.2の確定した責務と実装状態へ更新する。


<a id="issue-2"></a>

## 2. 内部03Bの残差一覧に削除済み関数が残る

分類: 内部仕様内の矛盾・古い説明

03B.5はcompositeUnsupported削除済みとする一方、3B.6末尾は残る差分が同関数の削除だけとする。現行ソースに関数定義はない。

- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 03B 複合セルタイプ設計.md:64`: 「 だけが `cdl/messages.ts` に残る（「出ない」ことを確かめるテスト用）。生成関数 `compositeUnsupported()` は呼び出しが無かったので、2026-10-22 に削除した。未対応構文の存在通知はプロパティ欄専用で、診断一覧にも追加しない。構文エラー、署名未解決、結合先不在など、独立した既存の診断は維持する。…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 03B 複合セルタイプ設計.md:76`: 「()`と`CompositeDiagramView`は、ソースに見当たらない（撤去済み）。残る差分は、未使用の`compositeUnsupported()`の削除だけである。…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04H CDLパーサの診断・断片・拡張点.md:59`: 「5. ~~**`compositeUnsupported`の呼び出しが無い**~~ → **解消（2026-10-22）**（関数を削除。コード定数はテスト用に残す）。経緯: `messages.ts`の`W-COMPOSITE-UNSUPPORTED`と生成関数は、`src`内に呼び出しが見当たらない（2026-10-21の検索）。DT-ELの仕様（第8章、3B.5。DT外部仕様4.7節・第9章と一致）は、複合型の存在や未対応構文を警告にしないので、仕様と実装は整合しており、残るのは未使用の定義だけ（削除してよい）。」

推奨修正: 03B.6の残差を解消済みにする。


<a id="issue-3"></a>

## 3. ソース別保存checkpoint・非同期ticket・パス別保存キューが未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:62` — 「**保存完了と未保存状態（2026-11-08、監査#21）**: 保存成功したソースについて、実際に書き込んだ文書状態だけを保存済みとして記録する。複数ソースの一部が失敗した場合、失敗したソースまで保存済みにしない。保存中に新しい編集が加わった場合、その編集は未保存として残す。「名前を付けて保存」の取消・失敗では、現在のパスと保存済み状態を変更しない。判定の詳細は5.7節の規定に従う。」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:86` — 「Undo／Redoで保存対象が保存済みと同じ状態へ戻った場合は、未保存表示を解除できる。**履歴の長さ・操作件数が保存時と同じという理由だけで解除してはならない。** 保存→Undo→別内容の編集によって同じ履歴長になっても、保存内容と異なれば未保存とする。別の操作列で同じ保存対象の状態へ戻った場合も、状態比較に従う。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07J 保存チェックポイントと未保存判定.md:16` — 「`DirtyTracker`は、[[TECSCDE-DT-EL内部仕様 - 04C ファイル別保存契約|4C]]の保存対象ソースごとに、最後に保存成功した**文書状態のスナップショット**を保持します。保存すべき状態の比較を判定の根拠とし、履歴の長さ・操作回数・オブジェクト参照だけでは判定しません。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07J 保存チェックポイントと未保存判定.md:59` — 「保存開始時に`SaveTicket`（案）を作り、文書世代・履歴ノードID・対象SourceId・現在の保存先世代とパス・出力先・保存するソース状態・出力本文を一組で固定します。4Cの検証とシリアライズもこの状態に対して行います。」
- `src/renderer/app/store.ts:183` — 「return this.historyState.past.length !== this.savedAtPastLength;」
- `src/renderer/app/store.ts:372` — 「this.savedAtPastLength = this.historyState.past.length;」
- `src/renderer/app/file-actions.ts:283` — 「store.markSaved(path);」
- `src/main/file-service.ts:314` — 「const tmpPath = `${path}.tmp-${process.pid}`;」
- `src/renderer/commands/history.ts:44` — 「return new History(this.initial, [...this.past, command], []);」

影響: 保存N→Undo→別編集Nでcleanを誤判定。保存S待ちの編集Tも完了時markSavedにより保存済みになる。複数sourceの一部成功だけをbaselineへ反映せず、SaveAsの旧保存先世代照合もない。同一パス並行保存は同一tmp名を使いキューなし。no-opの編集ノード抑制も新契約に未追随。7J保存coordinator不足として共通原因を1件にまとめる。
推奨修正: SourceSaveState・一意な履歴位置・SaveTicket・sourceLocationGeneration・成功source別baseline・main書込キューを7J/10.8に従い実装する。


<a id="issue-4"></a>

## 4. 終了時の保存待機・最新dirty問い合わせが未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:88` — 「保存開始時点の状態と保存完了時点の状態を混同しない。保存中は完了を先取りして未保存表示や終了保護を解除せず、終了操作では保留中の保存結果を待ってから現在の未保存状態を再評価する。部分失敗や保存後の新編集が残る場合も、終了・新規作成・読み込み前の確認を省略しない。タイトル、ステータス、破棄確認は同じ判定を使う。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07J 保存チェックポイントと未保存判定.md:134` — 「第7章7.9の2026-10-22のCloseGuard例は、キャッシュ済みdirtyだけで閉じる従来実装の記録です。監査#21後は、通常のclose要求を同期的に`preventDefault()`してから、非同期に次の終了判定を行う契約へ拡張します。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07J 保存チェックポイントと未保存判定.md:136` — 「1. mainはqueryId付きの`window:requestCloseState`（案）をrendererへ送り、rendererは図を変更する操作の適用を一時停止します。新しい非同期読み込み結果等も、この終了判定中に勝手に適用しません。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07J 保存チェックポイントと未保存判定.md:137` — 「2. rendererの保存コーディネータは、保留中の保存の書き込みだけでなくcheckpointへの結果反映まで待ち、現在のdirtyを再評価します。queryId・文書世代・履歴位置・dirtyを`window:closeState`（案）で返します。」
- `src/main/close-guard.ts:25` — 「if (!this.dirty || this.confirmed) return; // そのまま閉じる」
- `src/main/index.ts:106` — 「ipcMain.on("window:setDirty", onSetDirty);」
- `src/preload/index.mts:71` — 「setDirty: (dirty: boolean): void => ipcRenderer.send("window:setDirty", dirty),」

影響: cached falseなら即closeし、保留保存・通知遅延・応答不明を照合しない。旧CloseGuardは仕様で歴史扱いだが実装は旧方式。F01を直すだけでは終了プロトコルは実現しない。
推奨修正: 同期close中断→queryId付き要求→保存結果反映待ち→最新dirty回答・確認→取消解除を全層に実装する。


<a id="issue-5"></a>

## 5. 一括DTO・primarySourceKey・sourceOrderと永続化が未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:56` — 「| `.cdl`／`.cde`の拡張子を持つトークン | 読み込むCDLファイル。**列挙順に扱い、最後を主ファイル、それ以外を追加読み込みファイル（参照）とする**。これはオプションファイル内の列挙に対する規則であり、起動引数の最初の1件を選ぶ規則とは区別する。ユーザ定義CDL由来のセルは編集可能（システム定義CDLは下記）。相対パスは`.tecsgen-opts`のあるディレクトリを基点に解釈する |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:20` — 「3. `sourceOrder`は、元の列挙順から同一の正規化済みパスの重複だけを除き、最初の出現順を保持します。主ファイルのために先頭や末尾へ移しません。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:23` — 「例えば`A.cdl B.cdl C.cdl`なら、`sourceOrder=[A,B,C]`、`primaryPath=C`、`referencePaths=[A,B]`です。`A.cdl B.cdl A.cdl`なら、`sourceOrder=[A,B]`、`primaryPath=A`、`referencePaths=[B]`です。同名セルの先勝ち等を、主ファイルを移動する配列操作で変えません。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:62` — 「`CdlDocumentLoader.loadSources()`のオプションに`primarySourceKey`（案）を追加し、一括読み込みでは`batch.primaryPath`のソースキーを必ず渡します。主ファイルの採用とその`preservedImports`・テンプレートの選択は、この明示値に従います。`editable`な最後のソースを主ファイルとする従来の推定を、この経路で使いません。読み取り専用の主ファイルも役割として保持し、編集可否は別の判定とします。単一ファイルを開く経路も、明示的な主ファイ…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元.md:23` — 「readonly sourceOrder?: readonly string[]; // 監査#16：役割と分離したソース順の補助情報」
- `src/main/file-service.ts:69` — 「async openPaths(paths: readonly string[]): Promise<OpenResult> {」
- `src/main/file-service.ts:80` — 「const editablePath = resolvedPaths[resolvedPaths.length - 1]!; // 最後のファイルを主ファイルとする」
- `src/renderer/app/file-actions.ts:93` — 「...references.map((r) => ({ text: r.content, fileName: baseName(r.path), sourcePath: r.path, editable: true })),」
- `src/renderer/cdl/document-builder.ts:624` — 「const editingSource = sources.slice().reverse().find((source) => source.editable);」
- `src/shared/ipc-types.ts:11` — 「export interface OpenResult {」

影響: APIは配列末尾主、loaderは最後のeditableを主へ推定する。A B Aの初出順・主役・重複を分離せずsourceOrderも保存しない。-Sの読取専用主がeditablefalseになると別参照をdoc主に昇格しstore.filePathと異なる可能性がある。
推奨修正: 7I/10.6の共通要求結果DTOと明示primarySourceKey、初出順、import後のsourceOrder保存へ移行。serializer本体のsource選別/joinListはroot担当。


<a id="issue-6"></a>

## 6. 非同期openの要求世代・文書revision抑止が未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:88` — 「保存開始時点の状態と保存完了時点の状態を混同しない。保存中は完了を先取りして未保存表示や終了保護を解除せず、終了操作では保留中の保存結果を待ってから現在の未保存状態を再評価する。部分失敗や保存後の新編集が残る場合も、終了・新規作成・読み込み前の確認を省略しない。タイトル、ステータス、破棄確認は同じ判定を使う。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:76` — 「const token = beginOpenRequest(store); // 最初のawait前に要求世代を発行」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:89` — 「if (!isLatestOpenRequest(store, token) || !isSameDocumentRevision(store, revision)) return;」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:96` — 「要求世代は、すべての読み込み入口で**最初のawait前**に発行します。解析・確認・I/O・解決の各非同期段階の後と適用直前に最新要求かを確認し、古い要求の結果や失敗通知を破棄します。文書revisionは未保存確認後の編集検出用として別に保持します。読み込み中に新しい要求が開始された場合や、確認後に文書が編集された場合は、古い処理結果を新しい状態へ上書きしません。破棄した結果からセッションを保存しません。セッション保存だけの失敗は7Hの既存方針に従い、適用済みの図まで破棄しません。」
- `src/renderer/app/file-actions.ts:142` — 「const result = await gateway.openPath(path);」
- `src/renderer/app/file-actions.ts:251` — 「const parsed = await gateway.parseTecsgenOptionsFile(path);」
- `src/renderer/app/file-actions.ts:105` — 「store.loadDocument(」

影響: 遅いAの間に新しいBを開いてもAが後からloadDocumentできる。未保存確認後のimport/Plugin待ち中に行った編集も無条件に置換できる。F03のバッチI/Oとは別の仲裁不足。
推奨修正: 最初のawait前の要求tokenと確認後の文書revisionを導入し、各await後と適用直前で検査する。


<a id="issue-7"></a>

## 7. 主ファイルなし・空セッションを復元せずsamplesへ置換する

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:64` — 「- **セッションの復元**: 開いた`.tecsgen-opts`のパスと、そこから得た追加のインポートパスは、前回セッションの復元（コマンドライン引数・前回セッション・サンプルの優先順位）の対象に含める。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元.md:79` — 「**復元失敗と主ファイルなし**: 保存済みの主ファイルまたは明示的な追加CDLが読めない場合は、従来のセッション全体の失敗時フォールバックを適用し、復元途中の図を公開せずサンプルを読み込みます。通常のimport追跡で見つからない参照先は既存の警告処理に従います。オプションファイルだけの失敗は上記3の回復可能な経路と区別します。`editablePath: null`はそれ自体で失敗ではなく、空の主文書と保存済み追加CDLを復元します。全項目が空の有効なセッションも「意図的な空状態」とし、設定なしの場合のサンプル…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:66` — 「主ファイルなしの復元では`primarySourceKey: null`を明示します。これは省略時の旧推定とは異なり、追加CDLを勝手に主ファイルへ昇格させません。空の主文書と参照集合を組み立て、全項目が空なら空文書を返します。オプションファイル内のCDL 0件は7I.4の入口で拒否するため、空セッション復元と混同しません。」
- `src/main/index.ts:158` — 「if (lastSession?.editablePath) {」
- `src/main/index.ts:178` — 「} else {」
- `src/main/index.ts:179` — 「data = await loadSamples(fileService);」
- `src/shared/ipc-types.ts:148` — 「* `null`の場合（消去後、7.7.3節）はreferencesのみ保存し復元対象から外す。」

影響: 消去後のreferencesは保存してもeditablePathがないと復元しない。有効な空sessionもsamplesへ戻る。共有型の注記も旧仕様。
推奨修正: 7H/7Iのnullable primary、空文書＋参照復元を実装し、未設定/不正sessionと意図的空状態を分ける。


<a id="issue-8"></a>

## 8. session復元でopts再解析importPathsを採用しない

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:64` — 「- **セッションの復元**: 開いた`.tecsgen-opts`のパスと、そこから得た追加のインポートパスは、前回セッションの復元（コマンドライン引数・前回セッション・サンプルの優先順位）の対象に含める。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元.md:72` — 「2. `optionsFilePath`があれば現在のオプションファイルを再解析します。成功すれば、**再解析した`importPaths`を追加探索パスとして採用**し、同じ解析結果から`systemDirs`を再現します。保存済み`extraImportPaths`と無条件に連結せず、二重追加を防ぎます。」
- `src/main/index.ts:166` — 「const systemDirs = lastSession.optionsFilePath」
- `src/main/index.ts:167` — 「? (await fileService.parseTecsgenOptionsFile(lastSession.optionsFilePath).catch(() => undefined))?.systemDirs ?? []」
- `src/main/index.ts:172` — 「...(lastSession.extraImportPaths ? { extraImportPaths: lastSession.extraImportPaths } : {}),」

影響: 再解析するのはsystemDirsのみで、追加探索列は古い保存extraImportPaths。opts変更後に新systemDirsと旧探索列が混在する。
推奨修正: 同じ解析結果のimportPaths/systemDirsを採用し、解析失敗時だけ保存値へフォールバックする。


<a id="issue-9"></a>

## 9. OS関連付けの複数入力・既起動instance配送・受付キューが未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:40` — 「**その他の読み込み経路**: ファイル関連付けで複数ファイルが同時に渡される場合は、従来どおり最後を主ファイル、他を追加読み込みファイルとする（[[TECSCDE外部仕様]]8.1.2節の読み込み順序を踏襲）。ファイルブラウザの通常クリックは単一ファイルを主ファイルとして開く。この複数ファイルの規則を、コマンドライン引数に直接並べたファイルへ適用しない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07K 関連付け入力の収集と一括オープン.md:33` — 「| Windows/Linuxの関連付けランチャー | 関連付け専用モードと、1回の受信バッチのパス列を明示して起動。列挙順を保った`association`要求にする |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07K 関連付け入力の収集と一括オープン.md:54` — 「ネイティブ側が同一要求のパス配列を把握した時点で終端を通知し、JS側の一定時間待ちでは確定しません。標準の分割通知と配列通知を無条件に二重処理せず、同じOS通知の受信責務をアダプタへ一本化します。単一ファイルのネイティブ通知も、明示された1件バッチとして扱います。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07K 関連付け入力の収集と一括オープン.md:74` — 「関連付け由来かどうかとパスの順序は、**受信したプロセスで**確定します。既起動instanceへは、順序付き`LaunchOpenRequest`を`requestSingleInstanceLock`の`additionalData`等の値として渡します。primary側の`second-instance`で受けるargvを再解析して主ファイルや入力元を決め直しません。転送サイズの上限等で完全な要求を渡せない場合は、成功として先頭だけを送らず、失敗通知または完全なバッチを渡せる別の配送方式を用意します。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07K 関連付け入力の収集と一括オープン.md:103` — 「最初の確定要求を7Iの一括要求へ変換して初期文書を組み立て、`app:bootstrap`は起動時に一度だけ供給します。複数の独立した要求が待機している場合、受信順のキューを保持し、初期適用後に後続要求として処理します。初期の明示要求が不正・失敗した場合は、入力なしと取り違えて別ファイルを成功表示せず、空の初期文書に読込失敗を示します。7Hのセッション復元失敗時のsamples規則は別の経路として維持します。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07K 関連付け入力の収集と一括オープン.md:105` — 「既起動instanceへの要求は`app:openRequest`（案）でrendererへ渡し、bootstrapを再送しません。確定要求をキューから取り出して読み込みを開始するとき、最初のawait前に7Iの要求世代を発行します。受信・収集・待機自体と、読み込み開始を区別します。主ファイルと入力順、送信元cwdを同じ要求で渡します。」
- `src/main/index.ts:44` — 「let pendingOpenPath: string | null = null;」
- `src/main/index.ts:55` — 「pendingOpenPath = path;」
- `src/main/index.ts:121` — 「win.webContents.once("did-finish-load", async () => {」
- `src/preload/index.mts:78` — 「ipcRenderer.once("app:bootstrap", (_event, data: OpenResult | null) => listener(data));」

影響: CLI/associationを区別せずWindows/Linuxは最初1件、macOSはイベントごと単数上書き。既起動後open-fileもrendererへ配送しない。single-instance転送・配列adapter・境界キューなし。明示optsがCDL0件ならindex:137でsamplesを成功表示し、7Kの明示失敗とfallback分離にも反する。
推奨修正: 7K/10.10のlaunch context・OS adapter・確定キュー・初回bootstrap/後続openRequestを実装。timer推測で代替しない。


<a id="issue-10"></a>

## 10. 拡張子判定が大小文字非区別へ未追随

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:49` — 「- **形式と拡張子**: 拡張子名は`.tecsgen-opts`（2026-10-21に確定。以前は仮称）とし、**識別時に大文字小文字を区別しない**（2026-11-07、監査#6。DT-EL内部仕様7.7.4節に合わせて改訂）。`.TECSGEN-OPTS`・`.Tecsgen-Opts`なども同じ形式として扱う。ファイルブラウザの列挙・クリック（第3章3.5.1節）、起動時の引数、OSの「アプリで開く」のいずれでも、この識別規則を使う。これは拡張子の判定規則であり、実際のファイル名・パスを小文字へ変更す…」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 11 用語集.md:35` — 「| tecsgenオプション形式ファイル（`.tecsgen-opts`） | tecsgenのコマンドライン引数を書いたテキストファイル。拡張子名は`.tecsgen-opts`とし、識別時は大文字小文字を区別しない（`.TECSGEN-OPTS`・`.Tecsgen-Opts`も同じ形式、2026-11-07、監査#6）。本ツール独自の読み込み専用の入力形式で、CDLファイル群とインポートパス（`-I`・`-S`）などをまとめて読み込む。tecsgen本体が読むオプションファイルではない（第5章5.3節）。 |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07K 関連付け入力の収集と一括オープン.md:23` — 「const isStartupFile = (path: string): boolean => /\.(?:cde|cdl|tecsgen-opts)$/i.test(path);」
- `src/main/index.ts:48` — 「(a) => a.endsWith(".cde") || a.endsWith(".cdl") || a.endsWith(".tecsgen-opts"),」
- `src/main/index.ts:125` — 「if (pendingOpenPath.endsWith(".tecsgen-opts")) {」
- `src/main/file-service.ts:21` — 「const OPTIONS_EXTENSION = /\.tecsgen-opts$/;」
- `src/renderer/app/file-browser-panel.ts:40` — 「} else if (/\.tecsgen-opts$/.test(path)) {」

影響: 大文字optsはブラウザに出ず、CLIでは大文字CDE/CDLも対象外。macOSから大文字optsを受けると通常CDLとして処理する。新外部決定はTBCではない。
推奨修正: 3拡張子の共通識別器を/iへ統一し、実パス表記は保つ。


<a id="issue-11"></a>

## 11. -S配下の_CDL_FILES.txt探索が全層未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:70` — 「- **`_CDL_FILES.txt`（ディレクトリごとの一覧による探索、2026-11-01追加）**: `-S`で指定したディレクトリ、またはその**配下のサブディレクトリ**に`_CDL_FILES.txt`があるとき、そのディレクトリにあるはずの`import`の参照先を、ディレクトリを直接調べず、この一覧から探す。」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:74` — 「- **一覧に載っていないとき**: そのディレクトリでは**見つからない**ものとする（ディレクトリは調べない）。ほかの探索先（`-I`、編集対象のディレクトリなど）の探索は続ける。一覧に載っているがファイルが無いときも、見つからない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07E インポート解決の統合.md:143` — 「- **経路**: renderer の `resolveImportClosure`（`resolveAllImports`・`resolveAddedReference`）が、`.tecsgen-opts` の `-S` から得た絶対パス（`systemDirs`）を `ImportResolutionOptions.systemDirs` として渡す。main の `FileService.resolveImports` が、1回の解決ごとに `CdlFileLists`（`src/main/cdl-file…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07E インポート解決の統合.md:144` — 「- **一覧の読み込み**: `CdlFileLists.lookup(参照先のパス)` が、参照先が入っているディレクトリ（`dirname`）を調べる。そのディレクトリが `-S` のディレクトリ自身か配下で、`_CDL_FILES.txt` があれば、一覧を読んで（ディレクトリごとにキャッシュ）、ファイル名（`basename`）を照合する。結果は、`listed`（載っている。パスは「ディレクトリ＋一覧の行」）、`unlisted`（一覧はあるが載っていない）、`probe`（一覧を使わない。従来どおり調べ…」
- `src/shared/ipc-types.ts:96` — 「export interface ImportResolutionOptions {」
- `src/main/file-service.ts:173` — 「return Promise.all(requests.map((request) => this.resolveOne(request, searchDirs, options.importPaths)));」
- `src/renderer/app/import-resolution.ts:102` — 「const options: ImportResolutionOptions = { baseDir: toolInfo.baseDir, importPaths: toolInfo.importPath ?? ["."] };」

影響: systemDirsを探索へ渡す型・引数と一覧lookupがなく、非掲載CDLも直接探す。import_C除外、directory別一覧、読めない一覧時だけ通常探索等の確定規則全体が未実装。
推奨修正: 7E.11のsystemDirs伝達・一覧lookup・候補処理を接続する。


<a id="issue-12"></a>

## 12. 絶対-I/-Sをjoinで連結し探索先を壊す

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:57` — 「| `-I <path>`、`--import-path <path>`、`--import-path=<path>`、`-I<path>` | 追加のインポート探索パス。`import`／`import_C`の自動追跡（第8章8.1節）で、`__tool_info__`の`import_path`に続く探索先として使う。`-S`と合わせて、記述順に並べた1本の列として扱う |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07E インポート解決の統合.md:147` — 「- **既存の不具合の修正**: 従来は候補を `join(dir, p, 指定)` で作っており、`p` が**絶対パス**だと `dir` と連結されて壊れた（絶対パスの `-I`・`-S` が見つからなかった）。`resolve(dir, p)` に直して、絶対パスの `-I`・`-S` も探せるようにした。」
- `src/main/file-service.ts:185` — 「importPaths.map((p) => (p === "." ? join(dir, request.specifier) : join(dir, p, request.specifier))),」

影響: C:\projectと-I D:\typesはC:\project\D:\types\x.cdlという誤候補。Node path.win32の読取専用演算で確認済み。仕様の修正済み説明と現HEADが食い違う。
推奨修正: resolveで探索パスを解決してからspecifierへ接続する。


<a id="issue-13"></a>

## 13. basenameだけの既読キャッシュがimport探索を迂回する

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05A 開く（読み込み）.md:45` — 「> Ctrl+クリックは既存の主ファイルを置き換えずにCDLファイルを追加で読み込む（[[work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成|第3章3.5.1節]]）。`import`による自動追跡と同じ解決・重複排除規則を使う。追加したCDLがユーザ定義CDLであれば、そのセルも編集でき、変更は定義元ファイルへ書き戻す（システム定義CDLのセルは既定で編集不可）。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07D インポート自動追跡.md:72` — 「const searchDirs = [」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07D インポート自動追跡.md:90` — 「importPaths.map((p) => (p === "." ? join(dir, request.specifier) : join(dir, p, request.specifier))),」
- `src/renderer/app/import-resolution.ts:119` — 「knownByBase.set(baseName(r.path), r);」
- `src/renderer/app/import-resolution.ts:129` — 「const found =」
- `src/renderer/app/import-resolution.ts:132` — 「knownByBase.get(baseName(req.specifier));」

影響: 既読A/x.cdlがあるとimport("B/x.cdl")でもbasename一致でA/x.cdlを採用してBの探索をしない。manualにもfallbackが適用され得る。同名別directoryを誤解決し候補規則/一覧制約を迂回する。
推奨修正: キャッシュは探索で確定した正規化済みパスにだけ適用し、basename一致を解決成功にしない。


<a id="issue-14"></a>

## 14. settings read-merge-writeの直列化が未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 02 動作環境.md:78` — 「**手で編集するとき**: アプリケーションが記憶する項目（2.5.4）を保存するときは、ファイルの現在の内容を読み込んで、変わった項目だけを書き換える。そのため、手で足した項目は、通常は残る。ただし、**壊れた（JSON として読めない）ファイルは、次にアプリケーションが保存するときに、新しい内容で置き換わる**。手で直す前に、写しを取っておく。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元.md:63` — 「mainは現在の`settings.json`を読み、変更した`lastSession`だけを更新します。`fileBrowserRoot`、利用者設定、未知項目を保持します。フォルダ設定の保存も同じ部分更新処理を使い、逆に`lastSession`を消さないようにします。不正JSONは既存方針どおり新しい内容で置き換えます。main側で設定更新を直列化し、遅れて完了した古い保存要求で新しいスナップショットを戻さないようにします。書き込み失敗で現在の図を破棄せず、保存成功と失敗を呼び出し元が判別できる結果を返します…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07B ファイルブラウザ設計.md:212` — 「return enqueueSettingsUpdate(async () => {」
- `src/main/app-settings.ts:69` — 「const current = await loadAppSettings();」
- `src/main/app-settings.ts:72` — 「await fs.writeFile(join(dir, "settings.json"), JSON.stringify({ ...current, ...patch }));」

影響: 単独部分mergeはあるがfolder/sessionの同時保存が同じ旧currentを読むと、後のwriteが先の更新を失わせる。unknown項目merge自体がないとは指摘しない。
推奨修正: 全設定保存の共通mainキューでread-merge-write全体を直列化。


<a id="issue-15"></a>

## 15. settings/lastSessionの実行時型検証・正規化が未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 02 動作環境.md:74` — 「| 無い・壊れているとき | エラーにせず、「設定なし」として扱う（すべて既定値） |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元.md:48` — 「**旧設定との互換**: 旧`lastSession`の`editablePath: string`はそのまま受け入れ、省略された`editablePath`は`null`、`referencePaths`・`extraImportPaths`は空配列、`optionsFilePath`は未設定として正規化します。存在する既知項目の型が不正な場合は、そのセッションを無効として扱います。設定ファイルが無い・不正JSONの場合は、従来どおり設定なしです。これらの読み込み時の正規化だけで、設定ファイルを即座に書き換えませ…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元.md:50` — 「7Bの`normalizeAppSettings`（案）は、JSONが通常のオブジェクトか検査したうえで、このセッション正規化を適用します。不正なセッションは`lastSession`だけを無効にし、ほかの設定と未知項目は保持します。」
- `src/main/app-settings.ts:51` — 「return JSON.parse(raw) as AppSettings;」
- `src/main/index.ts:157` — 「const lastSession = settings.lastSession;」

影響: JSON.parse結果のcastだけ。null等の非objectはmainのproperty取得で失敗し、不正sessionだけ無効化して他設定を保持するnormalizerもない。
推奨修正: 7Hの通常object検査・既知型検査・旧設定互換・unknown保持を共通入口へ実装。


<a id="issue-16"></a>

## 16. 消去で保持するとした参照の本文・未保存編集をモデルから落とす

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:84` — 「**未保存判定（2026-11-08、監査#21）**: 現在の保存対象の文書状態を、最後に正常保存した状態（新規空図は初期空状態）と比較する。ソースごとに保存済み状態を保持し、一つでも保存対象の変更が残れば全体を未保存とする。保存日時等の自動生成注記、選択・検索・表示フィルタ・ズーム・パン・診断更新だけで未保存にしない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07C 読み込み経路の統合.md:85` — 「**影響範囲**: `references`集合・ファイルブラウザの展開状態（7.6.3節`expanded`/`children`）はクリアしない——消去は編集対象(editable)のみを空にする操作であり、参照ファイル一覧やツリーの展開状態はアプリケーション実行中の状態として維持する（3.5.1節「ツリーの展開状態はアプリケーション実行中の状態としてのみ保持する」と同じ扱い）。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07J 保存チェックポイントと未保存判定.md:87` — 「- 「消去」等で参照ソースを保持する場合、そのソースに残した本文変更とbaselineも保持します。主文書を新しくしたことを、保持した参照の未保存編集まで消去する理由にしません。破棄確認をキャンセルした場合は全状態を保持します。」
- `src/renderer/app/file-actions.ts:163` — 「const referenceFilePaths = store.getReferenceFilePaths();」
- `src/renderer/app/file-actions.ts:165` — 「const document = TecscdeDocument.empty();」
- `src/renderer/app/file-actions.ts:166` — 「store.loadDocument(document, null, [], referenceFilePaths, referenceSources, []);」
- `src/renderer/app/store.ts:331` — 「if (!keepDirty) this.savedDocument = document;」

影響: 参照path/cacheは保持するが図モデルは全空にしてclean化する。参照の未保存編集とbaselineを失い、cacheの旧本文でも復元できない。
推奨修正: 参照モデルとsource別baselineを保持し、主文書だけ初期化。参照dirtyがあれば全体dirtyを残す。


<a id="issue-17"></a>

## 17. 主ファイル未確定時のCtrl+手動追加を無通知で拒否する

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:64` — 「- **Ctrl+クリックで、現在の主ファイルを置き換えずにCDLファイルを追加で読み込める。** 通常のクリックは主ファイルを切り替えるが、Ctrl+クリックは現在のファイル集合と未保存の変更を保持する。既に読み込み済みのファイルは重複追加しない。追加したCDLがユーザ定義CDLであれば、そのセルも編集可能とし、変更はその定義元ファイルへ保存する（システム定義CDLのセルは既定で編集不可、第5章5.3節。第5章5.4節、第8章8.1節）。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元.md:79` — 「**復元失敗と主ファイルなし**: 保存済みの主ファイルまたは明示的な追加CDLが読めない場合は、従来のセッション全体の失敗時フォールバックを適用し、復元途中の図を公開せずサンプルを読み込みます。通常のimport追跡で見つからない参照先は既存の警告処理に従います。オプションファイルだけの失敗は上記3の回復可能な経路と区別します。`editablePath: null`はそれ自体で失敗ではなく、空の主文書と保存済み追加CDLを復元します。全項目が空の有効なセッションも「意図的な空状態」とし、設定なしの場合のサンプル…」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07I 複数ファイルの一括読み込み契約.md:66` — 「主ファイルなしの復元では`primarySourceKey: null`を明示します。これは省略時の旧推定とは異なり、追加CDLを勝手に主ファイルへ昇格させません。空の主文書と参照集合を組み立て、全項目が空なら空文書を返します。オプションファイル内のCDL 0件は7I.4の入口で拒否するため、空セッション復元と混同しません。」
- `src/renderer/app/file-actions.ts:183` — 「if (!editablePath) return; // 消去直後など編集対象未確定では参照追加の起点が無い」

影響: 消去直後/新規空図でCtrl+クリックしても追加しない。主なし＋参照は有効状態だが、入口は主がないとしてreturnする。外部にこの適用除外条件はない。
推奨修正: nullable primaryのcontextで対象自身を起点に追加。制限するなら外部適用条件と通知を先に規定。


<a id="issue-18"></a>

## 18. CDL一覧生成サービス・IPCが未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05B CDLファイル一覧の作成と自動配置.md:18` — 「### 5.3.y CDLファイル一覧の作成（V0.2.0 で追加、2026-11-05）」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05B CDLファイル一覧の作成と自動配置.md:28` — 「7. **上書き確認**（2026-11-08 決定）。一覧の作成前に、既存の `_CDL_FILES.txt` と `_ROOT_CDL_FILES.txt` を調べる。」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05B CDLファイル一覧の作成と自動配置.md:33` — 「8. **並び順**（2026-11-08 決定）。子一覧の中は**ファイル名の昇順**とする。大文字小文字を区別せずに比べ、同じになったときは元の文字列のコードポイント順とする。`_ROOT_CDL_FILES.txt` は**パスの昇順**とする。パスをディレクトリ区切りで分割し、要素ごとに前述の規則で比べる。OS の区切り文字と、実行環境のロケールには依存しない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 10 モジュール間インタフェース一覧.md:85` — 「| CDL一覧生成 | `CdlFileListService`案、fs | 情報ダイアログ、`FileGateway` | `file:createCdlFileLists` |」
- `src/main/file-service.ts:37` — 「export class FileService {」
- `src/shared/ipc-types.ts:134` — 「readonly file: {」
- `src/main/ipc.ts:33` — 「ipcMain.handle("file:export", (_e, path: string, data: string) => fileService.exportFile(path, data));」

影響: FileService/shared/IPC全体にcreateCdlFileLists経路なし。新外部05Bの上書き確認/変更なし件数/競合検査/順序/リンク/LF書式も未実装。UIボタン未接続は同機能として重複しない。
推奨修正: 7Gと現行外部05Bの確定規則を合わせ生成plan・確認・競合検査・結果型を全層に接続。


<a id="issue-19"></a>

## 19. 配列結合の添字省略・混在判定が未反映

分類: 仕様実装差（既存要件）

c[]を記述順に0,1…へ割り当てる処理と混在警告がない。同じ未添字ポートへ結合が集約される。内部04BのPR #23で実装済みという記録は今回checkoutには反映されていない。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:55`: 「2. 添字を省いた結合は、同じセルの同じ呼び口の中で、**書かれた順に 0, 1, 2… の添字を割り当てる**。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04B CDLパーサ設計.md:82`: 「-02、実装リポジトリPR #23、マージコミット`1a5cc4e`。`cst.ts`の`assignOmittedSubscripts`、保存は`serializer.ts`の`omittedFormPorts`）。…」
- [cst.ts](<../../src/renderer/cdl/cst.ts:460>): 「const cportIndex = Number.isFinite(parsedIndex) ? parsedIndex : undefined;」
- [document-builder.ts](<../../src/renderer/cdl/document-builder.ts:574>): 「const jid = asJoinId(`${decl.cellName}.${j.cport}${j.cportIndex !== undefined ? `[${j.cportIndex}]` : ""}`);」

推奨修正: 添字省略の区別と採番・混在警告・無変更原文保持を取り込む。


<a id="issue-20"></a>

## 20. 固定長・可変長配列が要素ごとのポートへ展開されない

分類: 仕様実装差（既存要件）

全宣言をsubscript:nullの1ポートとして作るため、c[2]の結合は解決されず、固定長Nや最大添字+1の要素表示も成立しない。安定PortIdとarrayKindも未反映。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:58`: 「5. 図には、要素ごとに呼び口を表示し、割り当てた添字で結合を結ぶ。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04E 可変長配列ポートの要素挿入.md:16`: 「ポート宣言から、非配列・固定長・可変長・未解決を区別する`arrayKind`を保持します。`subscript`の有無や現在の要素数だけで、固定長か可変長かを推測しません。`[]`は可変長、`[N]`は固定長として宣言情報を保持し、サイズ式を解決できない宣言は未解決とします。」
- [document-builder.ts](<../../src/renderer/cdl/document-builder.ts:93>): 「subscript: null,」
- [port.ts](<../../src/renderer/model/port.ts:31>): 「readonly arraySize: number | null,」

推奨修正: 宣言種別と要素IDを保持し、結合解決前に必要要素を生成する。


<a id="issue-21"></a>

## 21. ポート選択・移動・辺変更とポート起点の結合削除へ到達できない

分類: 仕様実装差（既存要件）

選択状態はセルと結合だけ。cport押下は修飾キーにかかわらず結合作成へ入り、eport押下は範囲選択扱い。MovePort/ChangePortEdgeはクラスとテストに存在するがUIから呼ばれない。

- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06A 編集操作（前半）.md:60`: 「- 選択の Shift（追加）／Ctrl（トグル）／無修飾（置換、ただし既選択オブジェクトのクリックは維持）という規則、およびポート/セルの排他制約は現行版を踏襲する。」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06A 編集操作（前半）.md:84`: 「- **結合の削除は結合バー・呼び口・受け口のいずれを選択していても行えるようにする。** 現行版の「バー経由でしか消せない」制約はUI上の理由が見当たらない実装都合であり、廃止する。」
- `work/active/TECSCDE-TS内部仕様/TECSCDE-TS内部仕様 - 04 編集コマンドとUndo-Redo設計.md:99`: 「| `ChangePortEdgeCommand` | 4.3.2 | 辺をまたぐ変更を明示的な操作として分離 |」
- [view.ts](<../../src/renderer/render/view.ts:62>): 「export class SelectionState {」
- [gesture-controller.ts](<../../src/renderer/render/gesture-controller.ts:153>): 「if (hit.kind === "cport") {」
- [gesture-controller.ts](<../../src/renderer/render/gesture-controller.ts:198>): 「// hit.kind === "eport" | "none": 空白クリック → 矩形選択の開始。」

推奨修正: 要素IDによるポート選択と移動・辺変更UI、全入結合を含むDelete経路を実装する。


<a id="issue-22"></a>

## 22. Insertによる可変長配列要素挿入と拒否通知が未実装

分類: 仕様実装差（確定追加設計）

Insertキー分岐・挿入計画・コマンドがない。固定長拒否、再添字、結合維持、1Undoも利用できない。

- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06A 編集操作（前半）.md:41`: 「- 配列ポートの要素挿入は Insert キーで提供する。**ブラウザの `KeyboardEvent.key` は名前付き文字列（`"Insert"` 等）で渡されるため、現行版のビットマスク方式に起因するキー衝突（`c` と Insert の混同）は構造的に発生しない。**」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04E 可変長配列ポートの要素挿入.md:53`: 「// InsertArrayPortElementCommand(plan).apply(doc) → TecscdeDocument」
- [gesture-controller.ts](<../../src/renderer/render/gesture-controller.ts:299>): 「keyDown(key: string, mods: Mods = NO_MODS): boolean {」
- [port-commands.ts](<../../src/renderer/commands/port-commands.ts:41>): 「export class MovePortCommand extends Command {」

推奨修正: 04Eの計画とコマンド・入力ガードを配線する。


<a id="issue-23"></a>

## 23. Deleteによる配列要素削除と先頭・固定長拒否が未実装

分類: 仕様実装差（確定追加設計）

DeleteはcellIds/joinIdsだけを処理する。結合解除優先→未結合要素削除、先頭・固定長拒否、一括再添字がない。

- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06A 編集操作（前半）.md:85`: 「- 配列要素ポートの削除制約（固定長拒否）は踏襲する。**添字0の要素が削除できない制約は目的が不明なため踏襲しつつ、9章のメッセージとして「先頭要素は削除できません」と明示し、黙って拒否しない**（現行版もメッセージボックスは出すため実質的な挙動は踏襲）。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04F 配列ポートの要素削除.md:58`: 「// DeleteArrayPortElementsCommand(plan).apply(doc) → TecscdeDocument」
- [gesture-controller.ts](<../../src/renderer/render/gesture-controller.ts:303>): 「this.host.dispatch(new DeleteCommand([...sel.cellIds], [...sel.joinIds]));」

推奨修正: 04Fの判定・通知・固定計画を実装する。


<a id="issue-24"></a>

## 24. 未結合末尾配列要素の個数保存・復元が未実装

分類: 仕様実装差（採用済み追加契約）

array_elementsは既知データとして読まず、unknownFieldsへ残すだけ。個数をモデルへ反映・編集・保存再構成できない。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:26`: 「未結合末尾要素を含む可変長配列の個数を、`__tool_info__("tecscde")`のJSONに追加する`array_elements`へ保存する。配列の各項目は、`cell`（CDLのスコープに基づく完全修飾セル名）、`direction`（`call`または`entry`）、`port`（添字を除く宣言ポート名）、`element_count`（1以上の整数）を持つ。セルインスタンスごとの情報であり、セルタイプ全体へ適用しない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04E 可変長配列ポートの要素挿入.md:80`: 「**未結合要素の永続化は決定済み（2026-11-08）**: 外部5.1.xの`array_elements`へ個数を明示保存します。セルの定義元ソースと完全修飾セル名・方向・宣言ポート名で対応付け、挿入後の現在個数を`element_count`として出力します。実行中のPortIdは保存キーにせず、再読み込み時に必要な要素を生成してから結合と位置を適用します。PortIdの同一性は実行中のUndo/Redoで保証し、保存をまたぐ同一IDは要求しません。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07J 保存チェックポイントと未保存判定.md:18`: 「`SourceSaveState`（案）は、対象ソースに属するセルの作成・削除・名前・属性・所属、位置・寸法、ポート要素と添字・配置、結合代入・保存対象の経路、利用者が編集する用紙や設定等を、ソースの保存契約に沿って表します。元の原文のうち編集・往復保持する内容も対応付けます。他ソースのセルを混ぜません。外部5.1.x・4E.5の可変長配列の個数情報も含め、未結合末尾要素の挿入・削除で結合代入が変わらなくても変更として比較します。保存チケットは開始時点の個数を含み、保存中の追加編集を保存済みにしません。」
- [tool-info.ts](<../../src/renderer/cdl/tool-info.ts:317>): 「const { paper, cell_list, join_list, ...unknownFields } = obj as {」
- [serializer.ts](<../../src/renderer/cdl/serializer.ts:189>): 「ports[p.name] = { edge: p.edgeSide, offset: p.offset };」

推奨修正: 個数検証・max(必要数,保存数,1)・ソース別保存・dirty比較を追加する。


<a id="issue-25"></a>

## 25. 複数セルのコピー・貼り付けが内部結合を保持しない

分類: 仕様実装差（確定変更）

appClipboardはCell[]だけ、CDL断片は属性だけ、Pasteはセルだけを生成する。A→Bの両端をコピーしても複製先に結合がない。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 06B 編集操作（後半）.md:36`: 「- **選択セル数による結合の扱い（2026-11-07、監査#2への回答）**: セルを**1個だけ**選択してコピーした場合、結合は含めない。セルを**2個以上**選択した場合、両端のセルがともに選択セル集合に含まれる結合もコピーし、貼り付けで生成したセル同士の結合として復元する。片端が選択外のセルである結合はコピーしない。結合線自体を選択しているかどうかには依存しない。この条件はコピー時点の選択セル数で決め、貼り付け時点の選択セル数では変えない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04 編集コマンドとUndo-Redo設計.md:44`: 「readonly joins: readonly Join[];」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04H CDLパーサの診断・断片・拡張点.md:45`: 「`tryParseCdlFragment`は`CdlDocumentBuilder.build`の結果からセル群と断片内で閉じた結合を保持する。構文エラーがあるか、`cell`が1つも無ければ`undefined`を返す（貼り付けは「何もしない」）。貼り付け先の既存セルを断片内の参照解決に使わない。単一セル選択の例外、セル名・IDの再対応、Undo／Redoは[[TECSCDE-DT-EL内部仕様 - 04 編集コマンドとUndo-Redo設計#4.1 差分: `CopyCommand`/`PasteCommand`/`CutCommand`のOSクリップボード連携|第4章4.1節]]を正とする。この更新は設計であり、実装済みの記録ではない。」
- [clipboard-commands.ts](<../../src/renderer/commands/clipboard-commands.ts:36>): 「* 元の位置から`PASTE_OFFSET_MM`だけずらし、名前・結合は新規に割り当てる（結合は引き継がない）。」
- [fragment.ts](<../../src/renderer/cdl/fragment.ts:18>): 「const body = Object.entries(attrs).map(([name, expr]) => `  ${name} = ${expr};`);」

推奨修正: セル・内部結合スナップショットと端点再対応を両経路へ実装する。


<a id="issue-26"></a>

## 26. 読み込み時の衝突回避・最小用紙選択・overflow通知が未実装

分類: 仕様実装差（既存要件・確定設計）

ローダーはA4既定で即配置し、固定セルとの衝突検査・独立A4/A3/A2試行を行わない。多数セルでもA4のまま、格子巻戻しで重なりが生じ、規定の最終overflow警告もない。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05B CDLファイル一覧の作成と自動配置.md:48`: 「7. **用紙の選択**（2026-11-03 追加）。ファイルに用紙の指定（`__tool_info__("tecscde")` の `paper`）が**ないとき**は、自動配置するセルが、すでに位置を持つセルと合わせて、重ならず用紙の内に収まる**最小の用紙**（A4横 → A3横 → A2横の順に試す）を選ぶ。A2横でも収まらないときは A2横とし、収まらなかったセルの数を警告で知らせる（項目5）。ファイルに用紙の指定が**あるとき**は、その用紙を尊重する（収まらなければ、項目5の警告で知らせる）。自動で選ぶ向きは横のみ。選んだ用紙は、保存すると `paper` として書かれる。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04D 読み込み時の最小用紙選択.md:33`: 「全ソースの解析・同名セルの採否・保存済み位置の検証を済ませてから、固定セル集合を確定します。ソースを読む途中で自動配置を確定し、後から読んだソースの固定セルと衝突する順序にはしません。」
- [document-builder.ts](<../../src/renderer/cdl/document-builder.ts:269>): 「let paper: PaperSpec = PaperSpec.default();」
- [document-builder.ts](<../../src/renderer/cdl/document-builder.ts:476>): 「const pos = autoPlacementPosition(autoIndex, paperW, paperH);」

推奨修正: 04Dの全固定セル確定→独立試行→最終配置と警告へ置き換える。


<a id="issue-27"></a>

## 27. 複数ファイルの用紙採用元・競合警告・用紙保存先が契約に未対応

分類: 仕様実装差（2026-11-08確定）

最後に解析したpaperで上書きし、開いた順の最初の有効宣言を採らない。採用元の識別・W-PAPER-CONFLICT/INVALIDがなく、serializeSourceは従来paperを保持／主は現在paperを書く方式で、採用元1ファイルだけ更新する契約を満たさない。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05B CDLファイル一覧の作成と自動配置.md:50`: 「1. 開いた順に最初に有効な `paper` を宣言しているファイルを**採用元**とし、その `paper` を採用する。向きの記載がなければ横とする。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04D 読み込み時の最小用紙選択.md:64`: 「通常の保存では、選んだ用紙を`__tool_info__("tecscde")`の`paper`へ書きます。書き込み先は、**採用元の1ファイル**（どのファイルも宣言していなければ最初に開いたファイル）だけとし、他のファイルの`paper`は書き換えません。用紙だけを変更した場合も、その書き込み先を保存対象に含めます（外部仕様5.3.x項目8）。編集可能セルの位置は[[TECSCDE-DT-EL内部仕様 - 04C ファイル別保存契約|4C]]の定義元別保存契約に従って保存します。読み取り専用・Plugin生成セルをこの処理のために保存対象へ加えません。次回の読み込みでは、保存した用紙は指定済みとして尊重し、有効な保存済み位置を再配置しません。」
- [document-builder.ts](<../../src/renderer/cdl/document-builder.ts:327>): 「paper = PaperSpec.create(p.paper.size, p.paper.orientation ?? "LANDSCAPE");」
- [tool-info.ts](<../../src/renderer/cdl/tool-info.ts:326>): 「const size = VALID_PAPER_SIZES.includes(p.size as PaperSize) ? (p.size as PaperSize) : undefined;」
- [serializer.ts](<../../src/renderer/cdl/serializer.ts:154>): 「{ size: prior?.paper?.size ?? doc.paper.size, orientation: prior?.paper?.orientation ?? doc.paper.orientation },」

推奨修正: 開いた順と採用元SourceIdを保持し、検証警告と採用元だけの保存へ統一する。


<a id="issue-28"></a>

## 28. 通常の再配置・全体再配置が未実装

分類: 仕様実装差（確定追加設計）

既存はAlignTop/Leftだけで、全対象の配置と経路を計画するRelayoutコマンドと2つの操作入口がない。active最上段操作はUI担当の別項目。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:28`: 「1. ツールバーに「再配置」と「全体再配置」を設ける（整列の隣）。「再配置」は、選択したセルのうち、編集できるセルが1つ以上あるときだけ使える。「全体再配置」は、選択に関係なく、編集できるすべてのセルを対象に、6の操作を1回で行う。編集できるセルが1つも無いときは使えない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04G 再配置コマンド設計.md:18`: 「| 再配置 | 選択セルのうち、存在し編集可能なセル | `RelayoutSelectedCellsCommand(plan)` | 対象が1個以上 |」
- [align-actions.ts](<../../src/renderer/app/align-actions.ts:10>): 「export type AlignAxis = "top" | "left";」

推奨修正: 04Gの現在用紙・固定障害物・有限探索・1Undoを実装する。


<a id="issue-29"></a>

## 29. 主ファイル保存のセル・結合レイアウトの定義元選別が不統一

分類: 仕様実装差（確定保存契約）

主ファイルは別serializeへ分岐し、セルはtemplates数1以下なら定義元を無視する。さらに主のjoinListはsource.editableだけで全ソースを収録する。再現では主Aの出力へ別ファイルBのB.c経路が混入した。

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:34`: 「- 保存対象の可変長呼び口・受け口ごとに現在の個数を記録する。保存先は所有セルの定義元ファイルであり、他ソースの同名セルへ転用しない。受け口の個数情報と、その受け口を参照する呼び口側の結合代入は、それぞれの所有元へ保存する。読み取り専用・Plugin生成ソースを書き換えない。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04C ファイル別保存契約.md:21`: 「- **結合の書き出し**: 呼び口側のセルが選別した保存対象に含まれる結合だけを、CDLの結合代入と`joinList`へ出す（外部仕様5.4.1）。受け口側が別ソースでも結合参照は保持するが、その相手セルの定義は出力しない。別ソースの呼び口から入る結合は、その別ソースの保存対象とする。」
- [serializer.ts](<../../src/renderer/cdl/serializer.ts:124>): 「if (sourceKey === doc.editingFileName) return CdlSerializer.serialize(doc);」
- [serializer.ts](<../../src/renderer/cdl/serializer.ts:168>): 「.filter((c) => c.editable && (doc.sourceTemplates.size <= 1 || c.locale === doc.editingFileName))」
- [serializer.ts](<../../src/renderer/cdl/serializer.ts:201>): 「if (!sourceCell?.editable) continue; // 5.4.1: 編集可能セル由来の結合のみ書き出す」

推奨修正: 主もlocale===sourceKeyの単一契約とし、セル・結合・レイアウトの選別を一致させる。


<a id="issue-30"></a>

## 30. 読み取り専用セル由来の結合作成・バー移動が拒否されない

分類: 仕様実装差（既存編集可否要件）

Gestureのcport開始、CreateJoinCommand、MoveJoinBarCommandが呼び口セルのeditableを検証しない。readonly AからBへの結合をコマンドで作れることを再現した。読み取り専用セルを動かす話とは区別する。

- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06A 編集操作（前半）.md:83`: 「- カスケード削除（セル削除→所属ポート・結合も削除）と、読み込み専用オブジェクトの削除拒否は現行版を踏襲する。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 03 モデル設計.md:43`: 「| `editable` | 編集・削除・保存の対象にできるか | 通常CDLは`true`。Plugin生成セルは`false`。`systemDefined`かつ`allowEditSystemDefined=false`なら`false`（**ソース単位**で決める。下記） |」
- [join-commands.ts](<../../src/renderer/commands/join-commands.ts:34>): 「if (!source || !target) return doc;」
- [join-commands.ts](<../../src/renderer/commands/join-commands.ts:104>): 「return doc.withJoin(join.moveBar(this.barIndex, this.newFixed));」

推奨修正: 呼び口側所有ソースの編集可否を開始時とapply時に検証し、readonly由来の意味変更・手動経路変更を拒否する。


<a id="issue-31"></a>

## 31. セルタイプ未選択・接続済み呼び口の操作が無通知で終わる

分類: 仕様実装差（既存フィードバック要件）

新規モードで型未選択なら何もせずreturn。接続済み呼び口は案内せず選択を空にし、Shift選択にもならない。

- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06A 編集操作（前半）.md:38`: 「- セルタイプ未選択時のクリックは、現行版のように黙って無視せず、**ステータス表示または軽い警告でセルタイプの選択を促す**（9章）。」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06A 編集操作（前半）.md:103`: 「- **結合済みの呼び口をクリックした場合の挙動は現行版を踏襲する**（メッセージで案内し、Shift クリックでのハイライトのみ許可）。」
- `work/active/TECSCDE-TS内部仕様/TECSCDE-TS内部仕様 - 04 編集コマンドとUndo-Redo設計.md:97`: 「| `AddCellCommand` | 6.1.2 | セルタイプ未選択時は生成しない（9章[未着手]で促す） |」
- [gesture-controller.ts](<../../src/renderer/render/gesture-controller.ts:143>): 「if (hit.kind === "none" && celltypeName) {」
- [gesture-controller.ts](<../../src/renderer/render/gesture-controller.ts:162>): 「// 既に結合済みの呼び口はハイライトのみ（結合モードには入らない、外部仕様6.4.1）。」

推奨修正: 外部6.1.2/6.4.2の軽い通知と接続済みポートの選択規則を配線する。


<a id="issue-32"></a>

## 32. 保存済み結合経路の要素・端点整合検証が不足

分類: 仕様実装差・内部詳細化不足

join_listはbarsが配列なら採用し、各バーのH/V・有限数値・2本以上・現在ポートとの接続整合を確認しない。保存位置が変わった不整合経路も無条件で復元される。

- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 05B ファイル操作（後半）.md:76`: 「**保守的な復元という設計方針を引き継ぐ。** 保存されたレイアウトは「復元できるなら復元する、整合しないなら捨てて引き直す」ものとして扱い、整合しない情報を無理に反映しない。座標情報は図の見た目に関する補助情報であり、CDL の意味論（どのセルがどう結合されているか）より優先度が低いためである。」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 05B ファイル操作（後半）.md:69`: 「2. 最初のバーの向きが、呼び口が接する辺の向きと直交している」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04B CDLパーサ設計.md:104`: 「6. **結合（2周目）**: 全セルが揃ってから解決する。結合先（セルまたは受け口）が無ければ`W-MISSING-JOIN-TARGET`で飛ばす。バーは、保存されたものがあればそれ、無ければ`autoRouteBars`で自動経路にする。」
- [tool-info.ts](<../../src/renderer/cdl/tool-info.ts:360>): 「Array.isArray(v.bars)」
- [document-builder.ts](<../../src/renderer/cdl/document-builder.ts:584>): 「const bars: readonly Bar[] = savedBars」

推奨修正: 項目別スキーマと幾何検証を追加し、不整合だけ破棄・再経路化して件数警告する。


<a id="issue-33"></a>

## 33. セル・ポート・結合レイアウト内部の未知キーを保存で失う

分類: 外部の往復保持要件と実装の差・内部詳細化不足

未知キー保持はtool_info最上位のunknownFieldsだけで、cell_listのセル項目、portsの個別項目、join_listの経路項目はモデルから再構成して追加フィールドを引き継がない。既知要素に付属した将来拡張情報が無編集保存でも失われる。array_elementsの新契約を理由に未知情報の往復保持を緩和する決定はない。

- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 05B ファイル操作（後半）.md:82`: 「- **未知のキーを保持する。** 検証で未知のキーを見つけた場合、拒否せず保持して書き戻す（5.1.2 の方針と同じ）。」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:39`: 「- 既存の3ブロック構成を維持する追加キーとし、未知の情報の往復保持を継続する。旧ツールでの個数復元は保証しない。形式版の既存規則を維持し、旧ツールとの実際の読み込み・往復互換性は別途検証する。」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 04C ファイル別保存契約.md:16`: 「- **`serializeSource(doc, sourceKey)`**: 主ファイルかどうかにかかわらず、`cell.editable && cell.locale === sourceKey`のセルだけを選別して書く。対象ソースの`sourceTemplate`を使い、テンプレートがない場合も選別範囲を広げない。主ファイルだけ全編集可能セルを出力する分岐は設けない。`tecscde`ブロックのレイアウトは、選別したセル・ポート・結合のバーから作り直す。主ファイルの`tecsgen`ブロックは既存の版・保存時刻・`directImport`更新規則に従い、それ以外のソースの`tecsgen`ブロックは変えない。」
- [serializer.ts](<../../src/renderer/cdl/serializer.ts:134>): 「cellList[cell.name] = {」
- [serializer.ts](<../../src/renderer/cdl/serializer.ts:189>): 「ports[p.name] = { edge: p.edgeSide, offset: p.offset };」

推奨修正: 定義元別の既知要素に未知フィールドを保持し、識別対応が取れる要素の保存で引き継ぐ。削除済み要素は復活させない。内部04Cにも階層ごとの保持契約を明記する。


<a id="issue-34"></a>

## 34. 情報ボタン・版情報モーダル・コピー・設定欄のUIがない

分類: 現行確定要件の実装欠落（V0.2.0設定欄を含む）

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:86` — 「ツールバーに「**情報**」ボタン」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:97` — 「「**コピー**」ボタン」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:33` — 「情報ダイアログは従来どおりモーダル」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:37` — 「tecsgenパスの入力欄」

現行実装:
- [index.html:516](<../../src/renderer/index.html:516>) — 「<div id="toolbar">」
- [shell.ts:259](<../../src/renderer/app/shell.ts:259>) — 「case "openFolder":」
- [shell.ts:303](<../../src/renderer/app/shell.ts:303>) — 「case "copyTecsgenCommand":」

差と影響: ツールバーとrunAction全体を確認しても情報アクション/ダイアログがなく、版確認・報告用コピー・設定UIへ到達できません。tecsgen設定基盤は別担当。
修正方向: 情報モーダルを追加し、版情報・コピーと設定ゲートウェイへ接続します。


<a id="issue-35"></a>

## 35. ファイルブラウザ・セルタイプ一覧のモードレス化が未反映

### ファイルブラウザは固定パネルのままで「ファイル」から開くモードレス化が未反映

分類: V0.2.0設計の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:59` — 「**ダイアログとして提供する」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:35` — 「「**ファイル**」ボタン」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:16` — 「同一renderer内のモードレスダイアログ」

現行実装:
- [index.html:517](<../../src/renderer/index.html:517>) — 「data-action="openFolder"」
- [index.html:553](<../../src/renderer/index.html:553>) — 「<div id="file-browser"></div>」
- [shell.ts:260](<../../src/renderer/app/shell.ts:260>) — 「void this.fileBrowser.chooseRoot()」

差と影響: 現在のボタンは「フォルダを開く」で直接ルート選択します。モードレスの開閉や再表示ではありません。
修正方向: FileBrowserViewを維持し、モードレスの開閉とルート選択を分離します。

### セルタイプ一覧のモードレス化と専用起動ボタンが未反映

分類: V0.2.0設計の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:35` — 「セルタイプ一覧は「**セルタイプ一覧**」ボタン」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:36` — 「2つのダイアログは**モードレス**」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:21` — 「| セルタイプ一覧 |」

現行実装:
- [index.html:554](<../../src/renderer/index.html:554>) — 「<div id="palette">」
- [shell.ts:137](<../../src/renderer/app/shell.ts:137>) — 「this.palette = new PaletteView」

差と影響: 一覧が常時固定パネルで、専用ダイアログを開閉できません。
修正方向: PaletteViewをモードレスの単一インスタンスへ移し、キャンバス操作と並行利用します。


<a id="issue-36"></a>

## 36. 廃止対象の表示制御バーが現役のまま

分類: V0.2.0設計の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:31` — 「**表示制御バーをなくす。**」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:16` — 「「表示」ボタンと表示制御バーを廃止」

現行実装:
- [index.html:543](<../../src/renderer/index.html:543>) — 「<div id="display-bar">」
- [shell.ts:173](<../../src/renderer/app/shell.ts:173>) — 「this.bindDisplayBar();」

差と影響: 従来版UIを使用し続けています。フィルタ機能自体は実装済みで、機能削除を要求する指摘ではありません。
修正方向: 既存機能を保持して現行差分のUI配置へ移行します。


<a id="issue-37"></a>

## 37. セルの定義元フルパス・読取専用表示ボタンがない

分類: 確定要件の実装欠落

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:71` — 「プロパティパネルの**一番下**」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 03 画面構成.md:79` — 「**セルの定義ファイルの表示ボタン**」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:48` — 「セルの定義ファイルは単一セル選択時だけ」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:52` — 「`DefinitionFileView`」

現行実装:
- [property-panel.ts:123](<../../src/renderer/app/property-panel.ts:123>) — 「private renderCell」
- [property-panel.ts:171](<../../src/renderer/app/property-panel.ts:171>) — 「const attrNames = celltype?.attributeNames」

差と影響: renderCellの全内容は名前・型・region・属性・未対応通知のみで、locale表示とファイル閲覧がありません。
修正方向: 単一選択のlocaleを末尾に表示し、パスなし/無効時を区別して副作用のない表示APIへ接続します。


<a id="issue-38"></a>

## 38. セルタイプ詳細モーダルと定義ファイルのフルパス・閲覧がない

分類: 従来の詳細表示要件とV0.2.0拡張の実装欠落

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 03 画面構成.md:170` — 「| セルタイプのプロパティ |」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:34` — 「その**一番下**」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:39` — 「**定義ファイルの表示ボタン**」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:50` — 「セルタイプ詳細ダイアログも定義元のフルパス」

現行実装:
- [palette.ts:22](<../../src/renderer/app/palette.ts:22>) — 「this.celltypeList.addEventListener("click"」
- [palette.ts:27](<../../src/renderer/app/palette.ts:27>) — 「this.store.setMode("newCell");」
- [palette.ts:71](<../../src/renderer/app/palette.ts:71>) — 「for (const name of names)」

差と影響: PaletteViewは一覧選択→newCellだけで、詳細表示アクション/ビューが存在しません。
修正方向: 一覧とは別の読み取り専用詳細モーダルを設け、定義元表示と閲覧へ接続します。


<a id="issue-39"></a>

## 39. 複数セル選択時に共通編集項目を出さず、一律に案内だけを表示する

分類: 外部要件に対する内部具体化不足＋実装欠落

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 03 画面構成.md:139` — 「複数選択時は、共通して編集できる項目のみを表示」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:44` — 「## 2B.3 プロパティと定義ファイルウィンドウ」

現行実装:
- [property-panel.ts:62](<../../src/renderer/app/property-panel.ts:62>) — 「if (selection.cellIds.size > 1」
- [property-panel.ts:63](<../../src/renderer/app/property-panel.ts:63>) — 「(複数選択 — 個別編集はセルを1つだけ選択してください)」

差と影響: 同一region/同一属性等の共通編集可能項目があっても、一律に表示・編集ができません。内部2B.3は定義元の非表示を規定するだけで共通項目の導出契約がありません。
修正方向: 共通編集対象・混在値・readonly混在時・1Undoを具体化してUIへ結線します。


<a id="issue-40"></a>

## 40. 選択肢付き属性をコンボにせず、すべて自由入力フィールドにする

分類: 外部要件に対する内部具体化不足＋実装欠落

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 06B 編集操作（後半）.md:37` — 「選択肢付き属性はコンボ」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:44` — 「## 2B.3 プロパティと定義ファイルウィンドウ」

現行実装:
- [property-panel.ts:14](<../../src/renderer/app/property-panel.ts:14>) — 「function field(labelText」
- [property-panel.ts:19](<../../src/renderer/app/property-panel.ts:19>) — 「document.createElement("input")」
- [property-panel.ts:172](<../../src/renderer/app/property-panel.ts:172>) — 「for (const attrName of attrNames)」

差と影響: 属性値の候補をモデルから受けてselectで制限する分岐がなく、指定された編集方式を満たしません。
修正方向: 選択肢メタデータと属性エディタの契約を整え、候補ありはコンボ、その他は自由入力に分けます。


<a id="issue-41"></a>

## 41. 用紙変更・Undo/Redo・アプリケーション既定の設定と新規適用が未実装

分類: 確定要件の実装欠落

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 03 画面構成.md:78` — 「UI から選択可能とする」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06 表示制御設計.md:25` — 「本章・第6B章で具体化した事項以外の詳細」

現行実装:
- [index.html:516](<../../src/renderer/index.html:516>) — 「<div id="toolbar">」
- [shell.ts:257](<../../src/renderer/app/shell.ts:257>) — 「runAction(action: string)」

差と影響: toolbarとrunAction全体にpaperの選択・変更入口がありません。自動最小用紙選択とは別の従来要件です。
修正方向: 用紙変更UIを追加して専用コマンドへ接続します。競合/自動選択はroot担当です。

追加確定規則: 外部03:53-55（3.2.y）は「利用者がアプリケーション既定を設定していればその用紙、なければA4横」「現在の用紙をアプリケーション既定として明示的に設定できる」「変更は『元に戻す』『やり直し』の対象」とする。内部04D.4も新規適用へ追随するが、`src/renderer/model/paper.ts`の`PaperSpec.default()`、`src/renderer/model/document.ts:71-86`の`empty()`、`src/renderer/app/file-actions.ts:165`は固定既定で、AppSettingsとUIに用紙既定の設定経路がない。この3.2.yの一式も同機能として計上する。


<a id="issue-42"></a>

## 42. 現在の入力モードをステータスへ文字表示しない

分類: 外部要件のUI実装欠落

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 03 画面構成.md:197` — 「現在のモードは 3.1.2 のステータス表示に文字で示す」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 02B V0.2.0画面構成.md:16` — 「ステータス表示を常時配置」

現行実装:
- [shell.ts:404](<../../src/renderer/app/shell.ts:404>) — 「private refreshStatus(): void」
- [index.html:572](<../../src/renderer/index.html:572>) — 「<div id="statusbar">」

差と影響: refreshStatusは倍率・region・path/dirtyのみで、modeを表示しません。ボタン押下だけではステータス文字表示要件を満たしません。
修正方向: 現在モード文字の固定領域を設け、store通知へ同期します。


<a id="issue-43"></a>

## 43. 未保存状態をウィンドウタイトルへ反映しない

分類: 確定要件の実装欠落

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:90` — 「ステータス表示・タイトルに未保存を示す」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 05B ファイル操作（後半）.md:140` — 「| ページタイトル |」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07 ファイルI-O設計.md:190` — 「renderer**: `AppShell`」

現行実装:
- [index.html:15](<../../src/renderer/index.html:15>) — 「<title>TECSCDE</title>」
- [shell.ts:404](<../../src/renderer/app/shell.ts:404>) — 「private refreshStatus(): void」
- [shell.ts:409](<../../src/renderer/app/shell.ts:409>) — 「const dirty = path !== null && this.store.isDirty();」

差と影響: document.title/setTitle更新をsrc全体で検索しても存在せず、タイトルは常にTECSCDEです。副次的に新規docはpathがnullなのでdirty強調も有効になりません（「未保存」表記自体は常に出ます）。
修正方向: ファイル名とdirty接頭辞をタイトルに同期します。新規docでも変更有無の文字・強調を区別します。


<a id="issue-44"></a>

## 44. activeセルの青背景・状態色優先順位が未実装

分類: V0.2.0確定仕様の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:72` — 「セルの**背景色を青色**」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:80` — 「アクティブ（青） > 編集不可（灰）」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:34` — 「| 塗り |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:24` — 「`isActiveCell(doc, cell)`」

現行実装:
- [cell-renderer.ts:65](<../../src/renderer/render/cell-renderer.ts:65>) — 「const classes = ["cell-rect"]」
- [cell-renderer.ts:68](<../../src/renderer/render/cell-renderer.ts:68>) — 「if (cell.celltypeUnresolved)」
- [index.html:448](<../../src/renderer/index.html:448>) — 「.cell-rect.readonly」

差と影響: 描画はreadonly/unresolvedだけを参照し、activeを判定・描画しません。
修正方向: activeメタデータと共通状態スナップショットを接続し、決定済み塗り/枠規則を実装します。


<a id="issue-45"></a>

## 45. activeOnlyフィルタと操作UIが未実装

分類: V0.2.0確定仕様の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:69` — 「「**アクティブなセルだけを表示する**」」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:19` — 「| activeOnly |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:54` — 「`activeOnly === false || isActiveCell」

現行実装:
- [display-filters.ts:19](<../../src/renderer/view-state/display-filters.ts:19>) — 「private constructor(」
- [view.ts:20](<../../src/renderer/render/view.ts:20>) — 「export interface CanvasView」
- [svg-renderer.ts:118](<../../src/renderer/render/svg-renderer.ts:118>) — 「const hidden = view.hiddenRegionIds.has(cell.regionId);」

差と影響: DisplayFilters/CanvasView/rendererの可視判定にはactiveOnlyがありません。
修正方向: active判定を共通化し、既存リージョン条件との積集合を描画・ヒットテスト・検索ジャンプへ射影します。


<a id="issue-46"></a>

## 46. ポート選択に追従する赤い太線の結合強調が未実装

分類: V0.2.0確定仕様の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:78` — 「トグルボタン「結合強調」」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:86` — 「赤に加えて**線を太くして**」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:60` — 「`connectionFocusEnabled: boolean`」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:63` — 「`CanvasView.focusedJoinIds`」

現行実装:
- [view.ts:20](<../../src/renderer/render/view.ts:20>) — 「export interface CanvasView」
- [join-renderer.ts:59](<../../src/renderer/render/join-renderer.ts:59>) — 「line.setAttribute("class", "join-line");」
- [index.html:516](<../../src/renderer/index.html:516>) — 「<div id="toolbar">」

差と影響: focus状態/トグル/強調ID/描画クラスがありません。ポート選択の基盤不足はrootの選択項目と重複するためそこを前提とします。
修正方向: ポート選択の整備後、直接結合の和集合を導出して独立の表示機構として実装します。


<a id="issue-47"></a>

## 47. リージョン矩形モード・親子外周・名前表示が未実装

分類: V0.2.0確定仕様の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:113` — 「リージョンの**追加の表示モード**」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:117` — 「親リージョンの矩形領域は」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:121` — 「各リージョンの名前を、外周の左上」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:111` — 「`computeRegionOutlines(doc, visibleCellIds, regionTree)`」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:21` — 「`ViewState.regionOutlineMode`」

現行実装:
- [svg-renderer.ts:62](<../../src/renderer/render/svg-renderer.ts:62>) — 「this.svg.append(this.joinLayer」
- [view.ts:20](<../../src/renderer/render/view.ts:20>) — 「export interface CanvasView」
- [index.html:545](<../../src/renderer/index.html:545>) — 「id="region-filter-toggle"」

差と影響: SVGレイヤと表示状態に外周がなく、現在の「リージョン」はフィルタpopoverを開くだけです。色帯・凡例自体はあります。
修正方向: 可視セル部分木の矩形和集合と親子余白・外周線分を導出し、別のtoggleで切り替えます。


<a id="issue-48"></a>

## 48. RO・!・Uの独立記号/状態凡例/理由表示が未実装

分類: 確定した非色覚的表現要件の実装欠落

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:103` — 「四角囲みの`RO`」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:104` — 「三角囲みの`!`」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 04 コンポーネント図の表現.md:105` — 「丸囲みの`U`」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 05B 色に依存しない状態表示.md:51` — 「RO → ! → U」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 05B 色に依存しない状態表示.md:67` — 「固定の凡例領域」

現行実装:
- [cell-renderer.ts:66](<../../src/renderer/render/cell-renderer.ts:66>) — 「if (!cell.editable) classes.push("readonly");」
- [cell-renderer.ts:68](<../../src/renderer/render/cell-renderer.ts:68>) — 「if (cell.celltypeUnresolved)」
- [property-panel.ts:125](<../../src/renderer/app/property-panel.ts:125>) — 「このセルは読み込み専用ファイル由来」

差と影響: canvasは色のクラスだけです。propertyのreadonly文言はありますが、全状態の独立バッジと常設凡例、未結合件数、理由連動はありません。
修正方向: 5Bの共通状態導出と記号・凡例・説明を実装し、任意警告と構造未解決を分けます。


<a id="issue-49"></a>

## 49. SVG・PNG・PDF出力と表示スナップショット・バイト列IPCが未実装

### SVG/PNG/PDFのexport UI・生成処理・表示スナップショットがない

分類: 従来出力要件＋V0.2.0表示引継ぎの実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:74` — 「| SVG |」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:75` — 「| PNG |」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:76` — 「| PDF |」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:80` — 「画面に見えているとおりの内容を出力」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07F エクスポート設計（たたき台）.md:40` — 「ツールバーに「エクスポート」ボタン」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 07F エクスポート設計（たたき台）.md:32` — 「確定したスナップショットを」

現行実装:
- [index.html:516](<../../src/renderer/index.html:516>) — 「<div id="toolbar">」
- [shell.ts:257](<../../src/renderer/app/shell.ts:257>) — 「runAction(action: string)」
- [file-gateway.ts:24](<../../src/renderer/gateways/file-gateway.ts:24>) — 「export(path: string, data: string)」

差と影響: UI/rendererにはexport呼出元、SVG文字列化、PNG変換、スナップショット/境界/凡例生成がありません。ファイル書込の下回りだけです。型/IPC/mainの不足はfile担当で別途報告。
修正方向: 7Fの共通SVGと表示スナップショットを中心に3形式のUI/生成・境界・失敗通知を実装します。

### export string|Uint8Array共通型が未実装

分類: 仕様実装差（静的照合で確定。未実装を含む）

- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 05 ファイル操作.md:75` — 「| PNG | 対応（SVG経由のラスタライズ） | 対応（変更なし） |」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 10 モジュール間インタフェース一覧.md:123` — 「sharedの`ExportData = string | Uint8Array`を、`FileGateway.export`・preloadの`file.export`・`file:export`受信・`FileService.exportFile`の共通型とする。preloadは値を変換せず中継し、mainだけがUint8Arrayのビュー範囲を`Buffer.from(data)`でコピーして、内部の原子的書き込みへ渡す。renderer側APIにBufferを要求しない。詳細は[[TECSCDE-DT-EL…」
- `src/shared/ipc-types.ts:137` — 「export(path: string, data: string): Promise<void>;」
- `src/preload/index.mts:28` — 「export: (path: string, data: string): Promise<void> => ipcRenderer.invoke("file:export", path, data),」
- `src/main/file-service.ts:136` — 「async exportFile(path: string, data: string): Promise<void> {」

影響: PNG bytesを通すAPIがstring限定。renderer画像生成/UI未実装全体はUI担当へ委譲し、ここは型伝達とmain変換だけ。
推奨修正: ExportDataをshared/preload/renderer/mainで共用し、mainだけでUint8ArrayをBufferへコピー。


<a id="issue-50"></a>

## 50. 位置のみの診断からソースの行・列へジャンプできない

分類: 外部要件と08B設計の実装欠落

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 09 エラーと警告.md:20` — 「行・列を保持して該当箇所へジャンプ」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 09 エラーと警告.md:50` — 「対応する CDL テキスト上の位置へ移動」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 08B 診断位置へのソースジャンプ.md:19` — 「有効な`location`とソース識別」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 08B 診断位置へのソースジャンプ.md:59` — 「`DiagnosticSourceRegistry`」

現行実装:
- [diagnostics-panel.ts:68](<../../src/renderer/app/diagnostics-panel.ts:68>) — 「private jumpTarget(d: Diagnostic)」
- [diagnostics-panel.ts:69](<../../src/renderer/app/diagnostics-panel.ts:69>) — 「return d.relatedCellId !== undefined」
- [types.ts:15](<../../src/renderer/diagnostics/types.ts:15>) — 「export interface Diagnostic」

差と影響: locationのみは非jumpableです。ソースビュー/Registry/単位変換/sourceRefもなく、図IDが古い場合の位置fallbackもありません。
修正方向: 08Bのソース識別・本文snapshot・座標変換と読取専用ビューを実装し、図jumpと使い分けます。


<a id="issue-51"></a>

## 51. 診断の図ジャンプが非表示フィルタを緩和しない

分類: 従来の共通ジャンプ要件の実装不一致

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 09 エラーと警告.md:28` — 「同じ一覧・同じジャンプ機構」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:63` — 「対象を表示するために必要なフィルタを緩和」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 08B 診断位置へのソースジャンプ.md:25` — 「図ジャンプには第6章の既存の検索巡回・パン・フィルタ緩和」

現行実装:
- [diagnostics-panel.ts:73](<../../src/renderer/app/diagnostics-panel.ts:73>) — 「private jumpTo(index: number)」
- [diagnostics-panel.ts:79](<../../src/renderer/app/diagnostics-panel.ts:79>) — 「this.store.setSelection(SelectionState.ofCells」
- [search-box.ts:83](<../../src/renderer/app/search-box.ts:83>) — 「filters.withRegionsRevealed」

差と影響: 検索jumpはregionsToRevealを使いますが、診断jumpは選択とpanだけなので、非表示対象を指しても見えないままです。
修正方向: 検索と診断の図jumpを共通関数化し、セル/結合両端の必要フィルタを緩和します。


<a id="issue-52"></a>

## 52. 診断一覧が4列表でなく1行文字列のdivで、種別/該当箇所/移動操作が独立しない

分類: 外部9.3.2と内部8B一覧契約の実装不一致

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 09 エラーと警告.md:83` — 「「ジャンプ操作」の4列」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 08B 診断位置へのソースジャンプ.md:25` — 「種別・該当箇所・メッセージ・ジャンプ操作という4列表」

現行実装:
- [diagnostics-panel.ts:57](<../../src/renderer/app/diagnostics-panel.ts:57>) — 「document.createElement("div")」
- [diagnostics-panel.ts:63](<../../src/renderer/app/diagnostics-panel.ts:63>) — 「item.textContent = formatDiagnostic(d);」
- [format.ts:8](<../../src/renderer/diagnostics/format.ts:8>) — 「return `[${d.code}]」

差と影響: severityはCSS色に入り、対象と本文とjump操作は分離されません。コードによってseverityが分かる保証もありません。
修正方向: 4列のtable/対応するaccessible構造で表示し、操作を明示したボタンにします。


<a id="issue-53"></a>

## 53. シグニチャ名検索で結合をヒットさせず、ポートを持つセルだけが一致する

分類: 従来の検索要件の実装不一致

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 07 表示機能.md:108` — 「シグニチャ名（4.5 の結合ラベル）」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 07 表示機能.md:109` — 「一致したセル・結合は強調表示」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06 表示制御設計.md:40` — 「セル名・セルタイプ名・結合ラベルを検索」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06 表示制御設計.md:41` — 「結合の一致をその両端セルの一致へ置き換えない」

現行実装:
- [search.ts:51](<../../src/renderer/view-state/search.ts:51>) — 「...cell.cports.flatMap」
- [search.ts:68](<../../src/renderer/view-state/search.ts:68>) — 「if (matches(`${join.cportName} ${join.eportName} ${label}`」
- [join-renderer.ts:70](<../../src/renderer/render/join-renderer.ts:70>) — 「label.textContent = cport.signature;」

差と影響: 結合の検索対象にはsignatureが入らず、cell検索のポートsignatureだけに入ります。画面のsignatureラベルで検索すると結合専用強調/結合ヒットになりません。
修正方向: 表示ラベルと同じsignatureをjoin検索へ入れ、定義された検索対象とヒット種別を一致させます。


<a id="issue-54"></a>

## 54. ジャンプで緩和した事実のrevealed印が再描画直後に失われる

分類: フィルタ緩和表示要件の実装不一致

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:64` — 「緩和した事実は結果一覧の`revealed`印」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計.md:156` — 「緩めた事実は一覧の`revealed`印」

現行実装:
- [search.ts:59](<../../src/renderer/view-state/search.ts:59>) — 「revealed: hiddenRegionIds.has(cell.regionId)」
- [search-box.ts:83](<../../src/renderer/app/search-box.ts:83>) — 「filters.withRegionsRevealed」
- [search-box.ts:56](<../../src/renderer/app/search-box.ts:56>) — 「(hit.revealed ? " revealed"」

差と影響: revealedは緩和履歴でなく「現在hidden」の判定です。jumpでsetView→同期render→searchDocument再計算によりfalseとなり、印が消えます。一端だけhiddenのjoinもbothHidden条件で印が付きません。
修正方向: ジャンプ時の緩和事実をUI状態として持つか、revealedの定義と外部説明を整理します。


<a id="issue-55"></a>

## 55. フィルタで消した選択セルの枠だけがcanvasに残る

分類: 非表示可視集合に対する描画不一致

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 07 表示機能.md:142` — 「リージョンに属するセルを**非表示**にする」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:54` — 「同じ可視集合」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計.md:117` — 「非表示リージョンのセルを」

現行実装:
- [svg-renderer.ts:118](<../../src/renderer/render/svg-renderer.ts:118>) — 「const hidden = view.hiddenRegionIds.has(cell.regionId);」
- [svg-renderer.ts:197](<../../src/renderer/render/svg-renderer.ts:197>) — 「for (const id of selection.cellIds)」
- [svg-renderer.ts:209](<../../src/renderer/render/svg-renderer.ts:209>) — 「this.selectionLayer.appendChild(rect);」

差と影響: 本体groupはdisplay:noneですが、独立selectionLayerのセル枠にはhidden検査がありません。選択を保持したままregionを隠すと空の選択枠が残ります。
修正方向: 選択ID自体は保持し、selection描画だけを同じ可視集合で抑止します。


<a id="issue-56"></a>

## 56. ナビゲータの縮小図・ドラッグ・手動表示の上書きが未対応

### ナビゲータに図の縮小内容がなく、用紙とviewportの2矩形だけ

分類: 従来のナビゲータ要件の具体化/実装不足

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 03 画面構成.md:146` — 「ナビゲータ（図全体の縮小表示）は提供する」

内部仕様:
- `work/active/TECSCDE-TS内部仕様/TECSCDE-TS内部仕様 - 06 表示制御設計.md:63` — 「用紙全体の縮小表示＋現在の表示範囲」

現行実装:
- [navigator-panel.ts:30](<../../src/renderer/app/navigator-panel.ts:30>) — 「this.paperRect = this.createRect」
- [navigator-panel.ts:31](<../../src/renderer/app/navigator-panel.ts:31>) — 「this.viewportRect = this.createRect」
- [navigator-panel.ts:32](<../../src/renderer/app/navigator-panel.ts:32>) — 「this.svg.append(this.paperRect, this.viewportRect);」

差と影響: モデルはpaperとviewportしか含まず、セル・結合の位置関係を縮小して把握できません。
修正方向: 縮小図形をナビゲータ用の派生シーンへ含め、用紙/viewport矩形と重ねます。

### ナビゲータのドラッグによるパンがない

分類: 従来の操作要件の実装欠落

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 07 表示機能.md:50` — 「ナビゲータ上のクリックまたはドラッグ」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06 表示制御設計.md:25` — 「本章・第6B章で具体化した事項以外の詳細」
- `work/active/TECSCDE-TS内部仕様/TECSCDE-TS内部仕様 - 06 表示制御設計.md:61` — 「### 6.3 ナビゲータ」

現行実装:
- [navigator-panel.ts:34](<../../src/renderer/app/navigator-panel.ts:34>) — 「this.svg.addEventListener("click"」

差と影響: NavigatorView全体でclickしか登録せず、pointerdown/move/dragの経路がありません。
修正方向: clickとdragの双方を同じ正規化座標→pan処理へつなぎます。

### ナビゲータの手動ONが自動非表示を上書きできない

分類: 従来の表示切替要件の実装不一致

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 07 表示機能.md:51` — 「この自動判定を利用者が上書きするための手段」

内部仕様:
- `work/active/TECSCDE内部仕様/TECSCDE内部仕様 - 07 表示制御設計.md:32` — 「この自動判定への上書き手段」

現行実装:
- [navigator-panel.ts:52](<../../src/renderer/app/navigator-panel.ts:52>) — 「this.visible = !this.visible;」
- [navigator-panel.ts:60](<../../src/renderer/app/navigator-panel.ts:60>) — 「const hidden = !this.visible || model.autoHidden;」

差と影響: autoHidden=trueならvisibleをtrueにしても常にhiddenで、手動表示の上書きになりません。
修正方向: auto/forced-on/forced-off等で自動判定と手動指定を分離します。


<a id="issue-57"></a>

## 57. ポート記号の向き・3mm寸法・ズーム追従が仕様と異なる

### 同じ辺にある呼び口/受け口の三角形が同じ向きで、色以外に区別できない

分類: 従来のポート図形要件の実装不一致

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 04 コンポーネント図の表現.md:128` — 「呼び口と受け口は記号の向きで区別し」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 04 コンポーネント図の表現.md:128` — 「**色のみに依存しない**」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 05 描画・インタラクション設計.md:23` — 「基本設計は」
- `work/active/TECSCDE-TS内部仕様/TECSCDE-TS内部仕様 - 05 描画・インタラクション設計.md:31` — 「矩形・ラベル・ポート記号」

現行実装:
- [cell-renderer.ts:25](<../../src/renderer/render/cell-renderer.ts:25>) — 「function portSymbolPoints(edge: EdgeSide, size: number)」
- [cell-renderer.ts:124](<../../src/renderer/render/cell-renderer.ts:124>) — 「portSymbolPoints(port.edgeSide, PORT_SYMBOL_PX)」
- [cell-renderer.ts:125](<../../src/renderer/render/cell-renderer.ts:125>) — 「`port-symbol port-symbol-${kind}`」

差と影響: 三角形の点列はedgeだけで決まり、kindはclass/塗り色にしか使いません。同辺では両者とも同じ形/向きです。
修正方向: kindとedgeから呼び口/受け口の向きを別に生成します。

### ポート三角記号の寸法が3mmでなく固定pxで、ズームにも追従しない

分類: 従来の物理寸法要件の実装不一致

外部仕様:
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 04 コンポーネント図の表現.md:100` — 「一辺 `Triangle_Len = 3 mm`」
- `work/active/TECSCDE外部仕様/TECSCDE外部仕様 - 04 コンポーネント図の表現.md:112` — 「寸法は現行版を踏襲」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 05 描画・インタラクション設計.md:23` — 「基本設計は」

現行実装:
- [cell-renderer.ts:22](<../../src/renderer/render/cell-renderer.ts:22>) — 「const PORT_SYMBOL_PX = 4;」
- [cell-renderer.ts:124](<../../src/renderer/render/cell-renderer.ts:124>) — 「portSymbolPoints(port.edgeSide, PORT_SYMBOL_PX)」

差と影響: posはkで変換しますが三角点列は常に固定pxです。100%でも3mmの正三角形ではなく、倍率変更でも三角形自体の大きさは一定です。
修正方向: 3mm/2.598mmのモデル座標をkで投影し、向き別点列を作ります。


<a id="issue-58"></a>

## 58. アクティブセル最上段移動のボタン・計画・コマンド・結果通知が未実装

分類: V0.2.0の確定仕様と内部設計の実装未対応

外部仕様:
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:39` — 「ボタン「**アクティブを最上段へ**」」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:44` — 「**次の行（縦30 mm下）へ送り**」
- `work/active/TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 07 表示機能.md:46` — 「**操作全体を行わない**」

内部仕様:
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:77` — 「`prepareMoveActiveToTop(doc)`」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:96` — 「data-action="moveActiveToTop"」
- `work/active/TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 06C V0.2.0表示と配置.md:87` — 「`MoveActiveCellsToTopCommand(plan)`」

現行実装:
- [shell.ts:257](<../../src/renderer/app/shell.ts:257>) — 「runAction(action: string)」
- [shell.ts:379](<../../src/renderer/app/shell.ts:379>) — 「private refreshToolbarState(): void」
- [index.html:525](<../../src/renderer/index.html:525>) — 「data-action="alignLeft"」

差と影響: toolbar・runAction・commandsの現行ソースに当該ボタン/アクション/計画/コマンドがありません。src全体でMoveActiveCellsToTopCommand、prepareMoveActiveToTop、moveActiveToTop、アクティブを最上段の正確な文字列検索を行い0件と確認しました。対象選択、非表示を含むactive全体の配置、溢れ/失敗、成功ステータスへ到達できません。通常再配置（root担当）とは独立した確定仕様です。
修正方向: 6C.4に従って現在用紙・固定障害物で重なりなしの計画を作り、全拒否/次行送り、1Undo、状態保持、通知とボタン有効条件を実装します。


<a id="issue-59"></a>

## 59. V0.2.0のtecsgen設定・自動探索・保存後の再確認が未実装

- 分類: 外部・内部は整合、実装未反映（予定設計）。範囲のTBCそのものは指摘対象外。
- 外部: `TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 02 動作環境.md:86`は `TECSGEN_COMMAND > tecsgenPath > 実在するTECSPATH > PATH`、保存した自動検出値を使用。`TECSCDE-DT外部仕様 - 08 CDL 連携.md:67-70`は即時反映・保存時の再確認。
- 内部: `TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理.md:30-35,41-57,63-69`が解決器、設定保存、revision、旧診断置換を具体化。
- 実装: `src/main/app-settings.ts:9-27`にtecsgenPath/cdlFilesRootなし、`src/shared/ipc-types.ts:124-127,181-183`の設定APIはallowEditSystemDefined取得のみ。`src/main/tecsgen-runner.ts:122-126`はTECSGEN_COMMANDまたはPATH上tecsgenだけ。`src/renderer/main.ts:52-53`は起動時1回、`src/renderer/app/tecsgen-version.ts:92-95`も警告あり時だけ更新し、再確認成功時の旧警告消去なし。`src/renderer/tecsgen/failure-summary.ts:24-25`の案内にも情報ボタン経由設定なし。
- 影響: UI側設定欄を足すだけでは動かず、設定パス・TECSPATH自動探索・自動保存・即時反映・再確認・旧診断除去が成立しません。
- 修正方向: 9D契約に沿ってmainの解決・保存を追加し、全tecsgen呼出しへ同じ実行設定を適用。保存後再確認は新revisionのみ採用し、対象診断だけ差し替えます。情報UI自体の欠落はUI担当項目と統合可能。


<a id="issue-60"></a>

## 60. 確定済みのPlugin型取り込み内部経路・方式選択が未実装

- 分類: 外部・内部は整合、確定済み経路の実装未反映。対象プラグイン未登録自体は指摘対象外。
- 外部: `TECSCDE-DT外部仕様 - 08 CDL 連携.md:74-85`はメモリ内経路、外部との併用、設定による方式選択、次回読込時適用、自動切替禁止、方式ログを確定。`:88`はゴールデン照合まで付表を空にすると明記するため、候補MrubyBridge未実装を独立の欠落としません。
- 内部: `TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理.md:94-105`はPluginTypeProviderの2実装、pluginTypeSource設定、Worker/VFS、空のPluginRegistry、対象外警告、仮想表示を具体化。
- 実装: `src/main/app-settings.ts:9-27`と`src/shared/ipc-types.ts:124-127,181-183`にpluginTypeSourceなし。`src/renderer/app/file-actions.ts:66-75`は外部generatedTypesを直接呼び、`src/main/tecsgen-runner.ts:150-168`は外部実行・一時ディスク生成だけ。src内のPluginTypeProvider/VirtualFileSystem/InternalTecsgenProcessorの完全一致検索も0件。
- 影響: 対象プラグインを0件として扱う場合を含め、内部方式の選択、外部非実行、対象外通知という確定済みの経路を使えません。
- 修正方向: 方式選択とProvider/Worker/VFSの基盤を実装し、付表は照合完了まで空のままにします。未登録候補を完成済み扱いせず、Ruby全プラグイン互換やtecsgen全体の代替を要求しません。TBCや登録待ち条件そのものは別記します。


<a id="issue-61"></a>

## 61. TECSGEN_COMMANDが空文字のとき、起動失敗にせず既定コマンドへ戻る

- 分類: 実装と確定外部仕様の不一致。
- 外部: `TECSCDE-DT外部仕様 - 02 動作環境.md:55`は「値が空、または解釈できないときは、起動に失敗した旨のエラー」。`TECSCDE-DT外部仕様 - 09 エラーと警告.md:74`は空設定をE-TECSGEN-LAUNCH-FAILEDの例とする。
- 内部: `TECSCDE-DT-EL内部仕様 - 09 tecsgen連携設計.md:142,159`はTECSGEN_COMMAND空をlaunch-error／例外からの写像として扱う。
- 実装: `src/main/tecsgen-runner.ts:122-127`は `process.env.TECSGEN_COMMAND ? ... : ["tecsgen"]` とtruthy判定し、空文字を未設定と同じ扱いにします。空白だけや引用符内の空値と、実際の空文字で結果が異なります。
- 影響: 不正な明示設定を無視し、意図しないPATH上の別tecsgenを起動します。
- 修正方向: undefinedと空文字を区別して存在判定し、明示された空値はlaunch-errorへ変換します。


<a id="issue-62"></a>

## 62. コピー用コマンドが、引用符を含むcpp等を正しく引用しない

- 分類: コマンド提示要件に対する実装不備。実行APIの引数配列は別経路なのでその問題と混同しない。
- 外部: `TECSCDE-DT外部仕様 - 08 CDL 連携.md:52,59`はコマンド提示・コピーの維持。継承元 `TECSCDE外部仕様/TECSCDE外部仕様 - 08 CDL 連携.md:93`は「利用者がローカル環境でそのまま実行できる」コマンドライン。
- 内部: `TECSCDE-DT-EL内部仕様 - 09 tecsgen連携設計.md:23,28`はTSの組み立てとbuildArgsからのコピー文字列を使う。
- 実装: `src/renderer/tecsgen/command-builder.ts:33-35`は空白があれば単に二重引用符で囲み、内部の引用符をエスケープしません。`:49-50`がこの処理をコピー出力へ使用。例としてcppが `ruby "C:\Program Files\cpp.rb"` の場合、`-c "ruby "C:\Program Files\cpp.rb""` となります。
- 検証: PowerShell Parserの構文解析のみで、この出力は `"ruby "`、`C:\Program`、`Files\cpp.rb""` へ分裂し、一つの-c引数にならないことを確認。コマンドは実行していません。
- 影響: execFileでは渡せる設定でも、コピーして実行すると引数が変わります。
- 修正方向: コピー先シェルの契約を定め、空白だけでなく引用符等も正しくescapeする表示用処理を実装します。


<a id="issue-63"></a>

## 63. アプリ版がpackage.jsonへ一本化されず、診断ログ先頭行にも版がない

- 分類: 外部・内部は整合、実装未反映。現時点の値が偶然同じでも構造要件は未充足。
- 外部: `TECSCDE-DT外部仕様 - 02 動作環境.md:102-103`はpackage.json.versionを唯一の情報源とし、形式版は別管理。
- 内部: `TECSCDE-DT-EL内部仕様 - 02 モジュール構成とプロセス境界.md:105-110`はesbuild/vitestのdefineとmainのapp.getVersionへ一本化し、手書きTECSCDE_TS_VERSIONをやめる。
- 実装: `package.json:3`は0.1.0、`src/renderer/model/tool-info-types.ts:18`も独立した手書き0.1.0。`scripts/build-renderer.mjs:18-30`のoptionsにdefineなし。`src/renderer/cdl/serializer.ts:7,176`はこの手書き定数を保存値へ使用。`src/main/index.ts:42`もLogServiceへ版を渡しません。
- 追加根拠（旧T09を統合）: `TECSCDE-DT外部仕様 - 09 エラーと警告.md:95`はログ先頭行の版を要求。内部02:109-110も版をLogServiceへ渡す契約です。実装`src/main/log-service.ts:24-29,55`は版引数なし・起動日時だけのheader、`src/main/index.ts:42`も版を渡していません。
- 影響: package版だけ更新しても保存CDLが追従せず、ログから実行版を特定できません。
- 修正方向: ビルド／テストの注入値とmainのapp.getVersionへ一本化。形式版は独立維持。情報UIの欠落はUI担当と重複させないでください。


<a id="issue-64"></a>

## 64. 診断ログが固定logs/ではなく起動cwd優先になる

- 分類: 実装と外部／内部の不一致。
- 外部: `TECSCDE-DT外部仕様 - 09 エラーと警告.md:92`は設定フォルダ配下logs/固定、cwdには作らない。`TECSCDE-DT外部仕様 - 02 動作環境.md:98`も同じ。
- 内部: `TECSCDE-DT-EL内部仕様 - 02 モジュール構成とプロセス境界.md:92`はlogsDirectory＝設定ファイルと同じフォルダのlogs/と記録。
- 実装: `src/main/index.ts:41-42`は `[process.cwd(), join(app.getPath("userData"), "logs")]`、`src/main/log-service.ts:57-63`は先に書けた候補を採用。
- 影響: 通常は作業ディレクトリに書き、Windowsではfallback先も設定のLocal AppDataではなくRoaming userDataになり得ます。
- 修正方向: 設定ディレクトリ取得関数を共有してlogs/へ固定。失敗時はT08の通知へ。


<a id="issue-65"></a>

## 65. 診断ログの新しい30個以外を削除する保持処理がない

- 分類: 実装未反映。
- 外部: `TECSCDE-DT外部仕様 - 09 エラーと警告.md:102`は起動時に名前順で新しい30個を残し、それ以前の同名形式だけ削除。
- 内部: `TECSCDE-DT-EL内部仕様 - 02 モジュール構成とプロセス境界.md:92`は起動時pruneOldLogsを記録。
- 実装: `src/main/log-service.ts:18-69`に列挙・保持数制限・削除なし。`src/main/index.ts:41-42`も作成のみ。srcのpruneOldLogs完全一致検索は0件。
- 影響: 起動ごとのログが無制限に蓄積します。
- 修正方向: 固定logs/内で対象名だけ30個に制限し、削除失敗はアプリ停止にしません。


<a id="issue-66"></a>

## 66. ログ書込失敗が画面の一度限りの警告にならない

- 分類: 実装と外部／内部の不一致。
- 外部: `TECSCDE-DT外部仕様 - 09 エラーと警告.md:103,107`はW-LOG-WRITE-FAILEDを一覧へ一度だけ、ログ自身には記録しない。
- 内部: `TECSCDE-DT-EL内部仕様 - 02 モジュール構成とプロセス境界.md:92`はappendのnewFailureをrendererが受けて通知する契約。
- 実装: `src/main/log-service.ts:50-52,64-68`はconsole.errorだけ。`src/shared/ipc-types.ts:185-186`と`src/renderer/gateways/log-gateway.ts:5-6`はPromise<void>。`src/renderer/app/diagnostics-logger.ts:33-34`もcatchをconsoleに送るだけで画面へ通知しません。
- 影響: 利用者はログを保存できていないことに気付けません。
- 修正方向: 最初の新規失敗を結果型で返し、loggerを再帰させず画面専用の警告を一度出します。UI担当の同指摘と統合してください。


<a id="issue-67"></a>

## 67. 診断もtecsgen版もない正常起動でログを作り得る

- 分類: ログ作成条件の実装不一致。
- 外部: `TECSCDE-DT外部仕様 - 09 エラーと警告.md:101`は診断0件かつtecsgen版取得なしの起動でファイルを作らない。
- 内部: `TECSCDE-DT-EL内部仕様 - 02 モジュール構成とプロセス境界.md:92`は外部9.5採用。専用設計節はなく、この具体条件の詳細化不足もある。
- 実装: `src/renderer/app/diagnostics-logger.ts:21-25`はファイル名が変わっただけで区切り行をoutへ追加、`:33-34`で送信。`src/renderer/main.ts:49-50`がストア変更ごとにsyncし、`src/main/log-service.ts:38-41,55-63`が区切りだけでも新規ファイルを作ります。
- 影響: 診断も版記録もない、ファイル区切りとheaderだけのログが残ります。
- 修正方向: 初回の診断／版行まで区切りを保留し、最初の実際の記録と一緒に作成します。


<a id="issue-68"></a>

## 68. 複数行メッセージが診断ログの1行1件規則を破る

- 分類: 外部規則と実装の不一致／内部ログ詳細化不足。
- 外部: `TECSCDE-DT外部仕様 - 09 エラーと警告.md:94,96`は1行1件、パネルと同じ書式。
- 内部: `TECSCDE-DT-EL内部仕様 - 09 tecsgen連携設計.md:168`は失敗概要に最大10行を添える。ログ処理は内部02:92で外部9.5採用とするだけで、複数行メッセージをどう1行へ表現するかを定めていません。
- 実装: `src/renderer/tecsgen/failure-summary.ts:38-45`がmessage内に改行を生成、`src/renderer/diagnostics/format.ts:6-8`はraw messageを保持、`src/main/log-service.ts:40`はそのままjoinして書き込みます。
- 影響: 一つの診断が複数物理行になり、コードのない続き行が出ます。
- 修正方向: パネルとの内容同一性を保つ改行エスケープ等の規約を内部ログ契約へ追加し実装。外部の1行規則を緩和するなら外部仕様変更の判断が必要です。


<a id="issue-69"></a>

## 69. V0.2.0のユーザーズ／リファレンスマニュアル成果物がworkspaceに未整備

- 分類: V0.2.0予定成果物の未整備。仕様間の矛盾ではなく、現版のリリース未達や既存マニュアルの全世界的不存在を意味しません。
- 外部: `TECSCDE-DT外部仕様/TECSCDE-DT外部仕様 - 01 概要.md:63-68`はV0.2.0の作業項目として「ユーザーズマニュアルの作成」「リファレンスマニュアルの作成」を要求。
- 内部: `TECSCDE-DT-EL内部仕様/TECSCDE-DT-EL内部仕様 - 01 概要.md:59-63`は手順書／リファレンスの構成案と実装後の画面照合を定め、本文執筆完了を意味しないと明記。`TECSCDE-DT-EL内部仕様 - 11 未決事項と実装単位案.md:85`もV02-11として画面・操作・エラーとの照合を要求。
- workspace文書: `README.md:7-9`は外部の開発記録へのリンク、`:58-98`は開発者向け構造・コマンド、`:100-130`は一部の読み込み保存・型・Plugin・ログの概要、`:148-160`はインストール・更新の概要です。ユーザーズ／リファレンスマニュアルへの案内や、V0.2.0の全操作・画面・設定・診断の体系的な説明はありません。`README.md:128`のログ案内はcwd優先で、現行外部9.5の固定logs/とも異なります（詳細はT06へ統合）。
- 成果物探索: 現workspaceの`docs/`には`docs/design/import-c-port-type-resolution.md`と`docs/diagrams/class_dependency.mmd`だけを確認。manual/guide/reference/マニュアル/ガイドの名前およびPDF/DOCXのファイル一覧にも本製品の操作・参照マニュアルは見つかりません。見つかったPDFはtests/hr-tecs内の他製品fixtureです。
- 影響: このworkspaceを配布元としても、V02-11の2種類の利用者向け成果物は揃いません。既存READMEだけでは要求範囲をカバーしたとは判定できません。
- 修正方向: 内部1.6の構成案に沿って2成果物を作成し、READMEから案内。確定したV0.2.0の実装・画面・操作・設定・エラーへ照合し、未実装の予定機能を利用可能と記載しません。
- 未確認: 外部の公開サイト／別checkout／Vaultの別作業フォルダでのマニュアル執筆状況は調査していません。既存の全ガイドが最新UIに合うかという実機照合も未実施です。


## 別記: 不一致件数へ数えていない事項

### A. 手動追加スケッチの詳細化不足（旧監査#24）

内部07C:58は`importPaths: []`、60行は`applyResolvedReferences`で選択ファイル自身と再帰import先を全て追加とする。現行実装`src/renderer/app/file-actions.ts:190`は`resolveAddedReference`を使っており、手動再帰全体を未実装とは判定しない。ただしスケッチだけでは現在のopts由来探索context・再帰処理・sourceOrder更新を読み取れない。07E/07Iを正とする参照へ整理する必要がある。詳細不足であり、再帰処理不存在という断定ではない。

### B. モーダル中のキャンバス編集抑止（旧監査#25）

親外部03:173はモーダル中のキャンバス操作停止を要求する。内部02Bはモーダル/モードレスを区別する一方、04E/04Fの個別キーガードは入力欄・IME・別操作を挙げるだけで共有modal gateを具体化していない。現行UIに対象モーダル自体が未実装なので、現行のモーダル中誤編集バグと断定しない。02Bの共通入力境界とInsert/Delete/ショートカット/マウスの関係を実装時に確認する。

### C. 不完全表示のクラス名の具体化

内部05B:35は`.unresolved`をセルタイプ未解決に限定し、不完全一般と同義にしない。内部06C:35-37は不完全の橙破線とactive/readonly/unresolvedを挙げるが、不完全一般にunresolvedを必ず割り当てるとは明記しない。断定的矛盾へ計上せず、型以外の構造未解決に用いる別クラスまたは状態フラグの接続を確認する。

### D. 古い状態記録の整理候補

内部07B:181の「新規作成機能は未実装」は、現行`newDocument`と07C/07Jの後続契約には当てはまらない。ただし旧時点の記録として読む余地があるため、確定矛盾件数へ加えない。内部07E:123の「loadSources自身のシグネチャは変更しない」も、07IのprimarySourceKeyによるLoadOptions拡張と純粋性維持を区別して整理できるが、関数引数の個数が変わるとは限らず独立した矛盾へ数えない。

### E. 別表: T12 macOS/Linux設定のcheckout差（不整合件数から除外）

- 分類: checkout差分。外部仕様違反や文書の設定済み誤記ではありません。
- 外部: `TECSCDE-DT外部仕様 - 02 動作環境.md:58`は配布方法を範囲外とし、OSの動作要件`:27`とは区別。
- 内部: `TECSCDE-DT-EL内部仕様 - 11B 配布方式と署名.md:22-29`は基準main/86f8910の登録済みと、旧a1f4ab9のWindowsのみを区別し、設定登録は実機検証成功を意味しないと明示。
- 実装: 今回HEAD5cf2d85の`forge.config.js:28`はmaker-squirrelのみ。`.github/workflows/release.yml:16-19`はWindowsのみ。
- 影響: 今回workspaceからは文書のmacOS/Linuxパッケージ設定を再現できません。アプリがそのOSで動作しないと断定する証拠にはなりません。
- 修正方向: 今回checkoutへ取り込む対象なら基準実装の設定をportし、OSビルド・成果物生成・インストール確認は別途実施。文書の状態を今回checkoutへ機械的に下げないでください。


## 検証と限界

- `npm run check`は子プロセスの`npm`探索失敗で停止した。仕様不一致による失敗とは扱わない。
- 同じチェック構成をNodeで直接実行し、renderer/main TypeScript検査、esbuild、Vitest、dependency-cruiserは成功した。
- Vitest: 57ファイル成功・1ファイルskip、565テスト成功・5テストskip（全58ファイル・570テスト）。依存検査: 122 modules / 427 dependencies、違反なし。
- 実コード再現: c[2]結合が欠落、c[]2本が1結合へ集約、複数セル貼付けで結合が増えない、readonly呼び口から結合を作成できる、先A3/後A4で後A4を無警告採用、主Aのjoin_listへ別ソースB.cが混入することを確認。Node上で既存TypeScriptを一時バンドルし、同梱WASMを初期化した。テスト用のアプリコード変更はしていない。
- 比較対象: 現行正式外部・内部の全章と分割章、および継承親仕様の必要箇所と対応実装・設定。追加案は正式本文への反映後の優先規則を尊重した。
- 未確認: Electron実機の見た目・入力・印刷、OS関連付け、OSクリップボード、実tecsgen/プリプロセッサ、macOS/Linuxビルド・インストール・公開、外部サイトのマニュアル状態。skipの性能/環境依存検証を成功扱いにしない。
- 今回の静的照合と明示した再現で確認できた全項目であり、未知の不具合が存在しないという保証ではない。TBCや登録待ちPlugin付表を確定仕様・未実装欠落へ水増ししていない。

対象ノート棚卸し（正式ノート/フォルダ内全Markdown）:
- TECSCDE-DT外部仕様: 16/23
- TECSCDE-DT-EL内部仕様: 40/40

### 確認範囲

DT外部04/05/05B/06/06A/06B、内部03/03B/04/04B/04C-H/07J、継承親外部04/05A/05B/06A/06BとTS内部03/04を読了。コマンド群、model、CDL、Gestureの関連経路を照合。型抽出詳細はtecsgen担当、UI全体・ファイル入出力は他担当へ分担。


### 範囲と限界

仕様: DT外部05/05A/新05B/11、必要箇所は02/03/08・親05A/05B/08も照合。内部07/07B/07C/07D/07E/07H/07I/07J/07K/04C/10を照合し、04B/分割04Hの読込保存関連も補助確認。旧03B/04H、配列/array_elements、paper、serializer joinList source選別はroot担当に委譲し重複計上しない。
コード: main index/file-service/close-guard/app-settings/ipc、preload、shared/ipc-types、renderer file-actions/import-resolution/file-gateway/file-browser-panelを読了。storeのdirty/保存/読込関連部、document-builderのeditingSource推定を確認。
未確認: OS関連付け実機とインストーラ登録、GUI・画像生成、tecsgen本体/型/モデル全体、動的な並行保存事故、全fixture期待値。本担当はコード変更せず、テスト成否は親担当の実行結果へ委ねる。Node path.win32のjoin/resolve比較のみ読取専用で実行。


### 読了範囲・未確認

仕様: 現行DT外部03・04・07・09、補助として05（export/dirty）、親外部03・04・06B・07・09・05B。内部02B・05・05B・06・06B・06C・07F・08・08B、継承先のTS05/06・汎用内部07の該当規範。現行の優先注記と11/08の決定を尊重し、古いTBCや実装記録を現仕様として流用していません。
実装: renderer app shell/palette/property/search/diagnostics/navigator/region views、render cell/join/svg/view/search-highlights、view-state search/filter/view/navigator、index.html、FileGateway、diagnostic types/format/logger。exportの呼出・生成関数をsrc全体の正確な識別子/呼出パターンで確認し、下回りのみと判断しました。
未確認: Electronの見た目・実際の色覚/コントラスト・印刷ページ寸法・canvas上限・OSクリップボード/保存ダイアログ・外部ツール実行は未実施です。該当する将来受入試験を実行済みとはしていません。


### 読了・照合範囲と未確認

- 現行Vault: DT外部01/02/08/09/10、必要な親外部01/02/08/09/10、DT-EL内部01/02/08/08B/09/09B（差分含む）/09C/09D/11/11B、関連する04B/07Cの該当節。
- 実装: main tecsgen-runner/index/ipc/app-settings/log-service、preload、shared IPC、renderer tecsgen-actions/version/command-builder/failure-summary、diagnostics parser/format/logger、Cdecl grammar/types/extractor/type-registry、signature-types、tool-info版定数、build script、package/forge/release設定。file-actionsはPlugin起動と結果採用の範囲を確認。
- UI・読み込み保存・起動/セッション本体は他担当。署名サービスの現行外部条件、配布実行履歴、実際のtecsgen/プリプロセッサ、macOS/Linuxビルド・公開、OS実機操作は今回未確認。source読み取り中心の監査であり動作保証ではありません。

# construct.txt 仕様整合処理結果

基準コード: 5cf2d85。#9〜69を入力順に処理。ソースコードは変更しない。外部・内部の契約補足は仕様書Vault内の各索引から参照する。

## #9 ファイル関連付けの複数入力・既起動インスタンスへの配送・受付キューが未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査9
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査9
- 根拠: `src/main/index.ts:44`, `src/main/index.ts:55`, `src/main/index.ts:121`, `src/preload/index.mts:78`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #10 起動・ブラウザ等の拡張子判定に、大文字小文字を区別する処理が残る

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査10
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査10
- 根拠: `src/main/file-service.ts:21`, `src/main/index.ts:48`, `src/main/index.ts:125`, `src/renderer/app/file-browser-panel.ts:40`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #11 -S配下の_CDL_FILES.txtによる探索が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査11
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査11
- 根拠: `src/main/file-service.ts:173`, `src/renderer/app/import-resolution.ts:102`, `src/shared/ipc-types.ts:96`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #12 絶対パスの-I・-Sをjoinで連結し、探索先を壊す

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査12
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査12
- 根拠: `src/main/file-service.ts:185`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #13 basenameだけの既読キャッシュが、別ディレクトリの同名ファイルを誤解決する

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査13
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査13
- 根拠: `src/renderer/app/import-resolution.ts:119`, `src/renderer/app/import-resolution.ts:129`, `src/renderer/app/import-resolution.ts:132`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #14 設定の読み込み・部分更新・書き込みを直列化せず、並行更新を失う可能性がある

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査14
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査14
- 根拠: `src/main/app-settings.ts:69`, `src/main/app-settings.ts:72`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #15 設定・セッションの実行時型検証と正規化がない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査15
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査15
- 根拠: `src/main/app-settings.ts:51`, `src/main/index.ts:157`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #16 「消去」で保持すべき参照ソースの本文・未保存編集をモデルから落とす

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査16
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査16
- 根拠: `src/renderer/app/file-actions.ts:163`, `src/renderer/app/file-actions.ts:165`, `src/renderer/app/file-actions.ts:166`, `src/renderer/app/store.ts:331`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #17 主ファイル未確定時のCtrl＋手動追加を無通知で拒否する

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査17
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査17
- 根拠: `src/renderer/app/file-actions.ts:183`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #18 CDLファイル一覧生成のサービス・IPC・操作入口が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 09-18 読み込みと設定.md` 監査18
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 09-18 読み込みと設定.md` 監査18
- 根拠: `src/main/file-service.ts:37`, `src/main/ipc.ts:33`, `src/shared/ipc-types.ts:134`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #19 配列結合の添字省略の採番と、明示・省略混在の警告が未反映

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査19
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査19
- 根拠: `src/renderer/cdl/cst.ts:460`, `src/renderer/cdl/document-builder.ts:574`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #20 固定長・可変長配列を、要素ごとのポートへ展開しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査20
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査20
- 根拠: `src/renderer/cdl/document-builder.ts:93`, `src/renderer/model/port.ts:31`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #21 ポート選択・移動・辺変更・ポート起点の結合削除へUIから到達できない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査21
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査21
- 根拠: `src/renderer/render/gesture-controller.ts:153`, `src/renderer/render/gesture-controller.ts:198`, `src/renderer/render/view.ts:62`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #22 Insertによる可変長配列要素挿入と拒否通知が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査22
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査22
- 根拠: `src/renderer/commands/port-commands.ts:41`, `src/renderer/render/gesture-controller.ts:299`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #23 Deleteによる配列要素削除・再添字・先頭／固定長拒否が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査23
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査23
- 根拠: `src/renderer/render/gesture-controller.ts:303`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #24 採用済みのarray_elementsによる未結合末尾要素の保存・復元が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査24
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査24
- 根拠: `src/renderer/cdl/serializer.ts:189`, `src/renderer/cdl/tool-info.ts:317`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #25 複数セルのコピー・貼り付けで、選択セル間の結合を保持しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査25
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査25
- 根拠: `src/renderer/cdl/fragment.ts:18`, `src/renderer/commands/clipboard-commands.ts:36`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #26 読み込み時の衝突回避・最小用紙選択・overflow通知が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査26
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査26
- 根拠: `src/renderer/cdl/document-builder.ts:269`, `src/renderer/cdl/document-builder.ts:476`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #27 複数ファイルの用紙採用元・競合警告・用紙の保存先が契約と異なる

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査27
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査27
- 根拠: `src/renderer/cdl/document-builder.ts:327`, `src/renderer/cdl/serializer.ts:154`, `src/renderer/cdl/tool-info.ts:326`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #28 通常の「再配置」「全体再配置」が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 19-28 配列と配置.md` 監査28
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 19-28 配列と配置.md` 監査28
- 根拠: `src/renderer/app/align-actions.ts:10`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #29 主ファイル保存で、セル・結合レイアウトの定義元による選別が不統一

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査29
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査29
- 根拠: `src/renderer/cdl/serializer.ts:124`, `src/renderer/cdl/serializer.ts:168`, `src/renderer/cdl/serializer.ts:201`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #30 読み取り専用セル由来の結合作成・バー移動を拒否しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査30
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査30
- 根拠: `src/renderer/commands/join-commands.ts:34`, `src/renderer/commands/join-commands.ts:104`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #31 セルタイプ未選択・接続済み呼び口の操作が、要求された案内なしで終わる

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査31
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査31
- 根拠: `src/renderer/render/gesture-controller.ts:143`, `src/renderer/render/gesture-controller.ts:162`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #32 保存済み結合経路のバー・端点整合の検証が不足

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査32
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査32
- 根拠: `src/renderer/cdl/document-builder.ts:584`, `src/renderer/cdl/tool-info.ts:360`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #33 セル・ポート・結合レイアウト内部の未知キーを保存で失う

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査33
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査33
- 根拠: `src/renderer/cdl/serializer.ts:134`, `src/renderer/cdl/serializer.ts:189`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #34 情報ボタン・版情報モーダル・コピー・設定欄のUIがない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査34
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査34
- 根拠: `src/renderer/index.html:516`, `src/renderer/app/shell.ts:257`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #35 ファイルブラウザ・セルタイプ一覧のモードレス化が未反映

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査35
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査35
- 根拠: `src/renderer/index.html:553`, `src/renderer/index.html:554`, `src/renderer/app/shell.ts:260`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #36 廃止対象の表示制御バーが現役のまま

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査36
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査36
- 根拠: `src/renderer/index.html:543`, `src/renderer/app/shell.ts:173`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #37 セルの定義元フルパス表示・読み取り専用表示ボタンがない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査37
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査37
- 根拠: `src/renderer/app/property-panel.ts:123`, `src/renderer/app/property-panel.ts:171`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #38 セルタイプ詳細モーダル・定義ファイルのフルパス表示・閲覧がない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 29-38 保存と画面.md` 監査38
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 29-38 保存と画面.md` 監査38
- 根拠: `src/renderer/app/palette.ts:22`, `src/renderer/app/palette.ts:27`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #39 複数セル選択時に共通編集項目を表示しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査39
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査39
- 根拠: `src/renderer/app/property-panel.ts:62`, `src/renderer/app/property-panel.ts:63`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #40 選択肢付き属性もコンボにせず、自由入力にする

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査40
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査40
- 根拠: `src/renderer/app/property-panel.ts:19`, `src/renderer/app/property-panel.ts:172`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #41 用紙変更・Undo/Redo・アプリケーション既定の設定と新規適用が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査41
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査41
- 根拠: `src/renderer/app/shell.ts:257`, `src/renderer/index.html:516`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #42 現在の入力モードをステータスへ文字表示しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査42
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査42
- 根拠: `src/renderer/app/shell.ts:404`, `src/renderer/index.html:572`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #43 未保存状態をウィンドウタイトルへ反映しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査43
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査43
- 根拠: `src/renderer/index.html:15`, `src/renderer/app/shell.ts:409`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #44 activeセルの青背景・状態色の優先順位が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査44
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査44
- 根拠: `src/renderer/render/cell-renderer.ts:65`, `src/renderer/index.html:448`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #45 activeOnlyフィルタと操作UIが未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査45
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査45
- 根拠: `src/renderer/view-state/display-filters.ts:19`, `src/renderer/render/svg-renderer.ts:118`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #46 ポート選択に追従する赤い太線の結合強調が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査46
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査46
- 根拠: `src/renderer/render/view.ts:20`, `src/renderer/render/join-renderer.ts:59`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #47 リージョン矩形モード・親子外周・名前表示が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査47
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査47
- 根拠: `src/renderer/render/svg-renderer.ts:62`, `src/renderer/render/view.ts:20`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #48 RO・!・Uの独立記号、状態凡例、理由表示が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 39-48 編集と表示.md` 監査48
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 39-48 編集と表示.md` 監査48
- 根拠: `src/renderer/render/cell-renderer.ts:66`, `src/renderer/render/cell-renderer.ts:68`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #49 SVG・PNG・PDF出力、表示スナップショット、バイト列IPCが未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査49
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査49
- 根拠: `src/renderer/app/shell.ts:257`, `src/renderer/gateways/file-gateway.ts:24`, `src/shared/ipc-types.ts:137`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #50 位置情報だけの診断から、ソースの行・列へジャンプできない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査50
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査50
- 根拠: `src/renderer/app/diagnostics-panel.ts:68`, `src/renderer/app/diagnostics-panel.ts:69`, `src/renderer/diagnostics/types.ts:15`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #51 診断の図ジャンプが非表示フィルタを緩和しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査51
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査51
- 根拠: `src/renderer/app/diagnostics-panel.ts:73`, `src/renderer/app/diagnostics-panel.ts:79`, `src/renderer/app/search-box.ts:83`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #52 診断一覧が要求された4列表になっていない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査52
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査52
- 根拠: `src/renderer/app/diagnostics-panel.ts:57`, `src/renderer/app/diagnostics-panel.ts:63`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #53 シグニチャ名検索で結合をヒットさせず、ポートを持つセルだけが一致する

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査53
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査53
- 根拠: `src/renderer/view-state/search.ts:51`, `src/renderer/view-state/search.ts:68`, `src/renderer/render/join-renderer.ts:70`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #54 ジャンプでフィルタを緩和した事実のrevealed印が再描画直後に失われる

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査54
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査54
- 根拠: `src/renderer/view-state/search.ts:59`, `src/renderer/view-state/search.ts:69`, `src/renderer/app/search-box.ts:83`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #55 フィルタで非表示にした選択セルの枠だけが残る

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査55
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査55
- 根拠: `src/renderer/render/svg-renderer.ts:197`, `src/renderer/render/svg-renderer.ts:209`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #56 ナビゲータの縮小図・ドラッグ・手動表示による自動判定の上書きが未対応

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査56
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査56
- 根拠: `src/renderer/app/navigator-panel.ts:32`, `src/renderer/app/navigator-panel.ts:34`, `src/renderer/app/navigator-panel.ts:60`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #57 ポート記号の向き・3mm寸法・ズーム追従が仕様と異なる

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査57
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査57
- 根拠: `src/renderer/render/cell-renderer.ts:22`, `src/renderer/render/cell-renderer.ts:25`, `src/renderer/render/cell-renderer.ts:124`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #58 activeセルを最上段へ移動する操作・計画・コマンド・通知が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 49-58 出力と検索.md` 監査58
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 49-58 出力と検索.md` 監査58
- 根拠: `src/renderer/app/shell.ts:257`, `src/renderer/app/shell.ts:379`, `src/renderer/index.html:525`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #59 tecsgen設定・自動探索・保存後の再確認が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査59
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査59
- 根拠: `src/main/tecsgen-runner.ts:124`, `src/shared/ipc-types.ts:126`, `src/renderer/app/tecsgen-version.ts:92`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #60 確定済みのPlugin型取り込み内部経路・方式選択が未実装

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査60
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査60
- 根拠: `src/renderer/app/file-actions.ts:75`, `src/shared/ipc-types.ts:126`, `src/main/tecsgen-runner.ts:151`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #61 空のTECSGEN_COMMANDを起動失敗にせず、既定コマンドへ戻る

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査61
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査61
- 根拠: `src/main/tecsgen-runner.ts:122`, `src/main/tecsgen-runner.ts:124`, `src/main/tecsgen-runner.ts:127`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #62 コピー用コマンドが、引用符を含むcpp等を正しく引用しない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査62
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査62
- 根拠: `src/renderer/tecsgen/command-builder.ts:34`, `src/renderer/tecsgen/command-builder.ts:50`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #63 アプリ版がpackage.jsonへ一本化されず、ログ先頭行にも版がない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査63
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査63
- 根拠: `src/renderer/model/tool-info-types.ts:18`, `scripts/build-renderer.mjs:18`, `src/main/log-service.ts:55`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #64 診断ログが指定の固定logs/ではなく、起動cwd優先になる

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査64
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査64
- 根拠: `src/main/index.ts:42`, `src/main/log-service.ts:57`, `src/main/app-settings.ts:37`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #65 診断ログを新しい30個に制限する処理がない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査65
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査65
- 根拠: `src/main/log-service.ts:29`, `src/main/index.ts:42`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #66 ログ書込失敗が、画面の一度限りの警告にならない

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査66
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査66
- 根拠: `src/main/log-service.ts:51`, `src/main/log-service.ts:68`, `src/shared/ipc-types.ts:186`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #67 診断もtecsgen版記録もない状態で、区切り行だけのログを作り得る

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査67
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査67
- 根拠: `src/renderer/app/diagnostics-logger.ts:25`, `src/renderer/app/diagnostics-logger.ts:33`, `src/main/log-service.ts:61`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #68 複数行メッセージがログの「1行1件」規則を破る

ソースコードの修正は必要です。 現行コードが確定契約に未対応です。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査68
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査68
- 根拠: `src/renderer/tecsgen/failure-summary.ts:45`, `src/renderer/diagnostics/format.ts:8`, `src/main/log-service.ts:40`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。

## #69 このワークスペースにユーザーズ／リファレンスマニュアル成果物が揃っていない

ソースコードの修正は不要です。 文書成果物の整備が必要ですが、アプリ実行コードの変更は要りません。

- 外部仕様: `TECSCDE-DT外部仕様 - 監査対応 59-69 環境と文書.md` 監査69
- 内部仕様: `TECSCDE-DT-EL内部仕様 - 監査対応 59-69 環境と文書.md` 監査69
- 根拠: `README.md:7`, `README.md:100`, `README.md:128`
- 文書の参照・節・サイズを検証済み。これは新契約の実装試験ではない。


## 全件検証

- 入力・結果とも61件、番号9〜69の順序・原文一致、重複なし。
- 要実装60件、不要-実装1件（69）。
- 外部・内部の補足12ノート、各項目の相互参照・索引からの参照・25KB未満を検証。
- アプリソース、package、command.txt、construct.txtのハッシュは作業開始時と一致。
- #62のコピー先シェル等、正式な未決事項はTBCを維持。マニュアル本文の執筆・公開は未実施。

## コードの既存チェック

Nodeからチェック構成のCLIを直接実行し、renderer/mainのTypeScript、renderer bundle、dependency-cruiserは成功。Vitestは57ファイル成功・1ファイルskip、565テスト成功・5テストskip。これは既存コードのチェックであり、未実装の新契約の受入試験完了を意味しない。実機・OS関連付け・印刷・外部tecsgenは未検証。

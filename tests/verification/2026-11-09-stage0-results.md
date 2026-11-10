# V0.2.0 段0 実装・検証（2026-11-09）

対象は実装計画「TECSCDE-DT-EL実装 — V0.2.0 実装計画 — 2026-11-09」の段0（V02-12、監査 #3〜#8・#14・#15）です。

## 実装した範囲

| 項目 | 実装と検証 |
|---|---|
| #3 | ソース別の保存対象状態・baseline、一意な履歴ノード、固定保存チケットを導入。保存中の編集、Undo分岐、同じ内容への復帰、部分失敗、応答逆転、保存先変更を検証。mainの共通キューで正規化済み保存先ごとに書込を直列化し、読込は先行書込を待ちます。SaveAsは同じ主ソースの操作を直列化し、選択後に世代を再照合してreceipt付き保存を行います。 |
| #4 | closeを同期中断し、送信元・queryId付き照会でrendererの保存checkpoint反映とmainの受理済書込を待機。状態不明は保守的に確認し、取消で停止解除。実Electronで保存待機・追加編集保護・取消・編集再開・clean終了を確認しました。 |
| #5 | primarySourceKeyとsourceOrderを分離し、loader・store・起動・opts・手動追加・sessionへ接続。A,B,Aの主A／順A,B、readonly主、明示null、不正主・順序の拒否、読込完了順と解析順の独立を検証しました。 |
| #6 | 最初のawaitより前に要求世代・文書世代・revisionを固定。後続要求の取消や失敗、編集・Undo/Redo・SaveAsでも旧結果を失効。旧例外の通知も抑止し、close中の結果は取消後の再照合まで保留します。bootstrapのguardはUI開始前に作成します。 |
| #7 | 有効な空／主なし・参照のみsessionを成功batchとして復元。samplesへの置換や参照の主への昇格をせず、実Electron再起動で確認しました。 |
| #8 | optsを一度再解析し、同じ結果のimportPathsとsystemDirsを空列も含め採用。失敗時は保存済探索列へ回復し、optsなし相対列は除外。解決時だけopts親から絶対化し、保存列の順序・重複を維持します。実Electronで変更後optsとシステム定義表示を確認しました。 |
| #14 | 設定のread・normalize・merge・mkdir・write全体を共通キューへ載せ、並行更新と先行失敗後の継続、未知項目の保持を検証しました。 |
| #15 | JSONをunknownから検査。旧session、null主、UNC、絶対パス、配列要素、主・参照と明示順序を正規化／検証し、不正sessionだけを無効化します。読込時の正規化だけでは書き直しません。 |

主なし導入に必要なserializerの対象選別と、opts探索列採用に必要な絶対-I処理だけを関連箇所へ追加しました。監査 #12・#29 全体の完了を意味しません。#16・#17ほか後続段の項目も未実装のままです。

## 検証

- テスト先行で障害を再現してから修正しました。段0専用のrenderer試験に、保存・読み込み競合・close保留・参照追加時のcheckpoint維持を含めています。
- `npm run check` は標準のcmd子プロセスでnpm探索に失敗しました。プロセス限りの `npm_config_script_shell` に現在のPowerShell実行ファイルを指定すると、同じ `npm run check` が終了コード0で成功しました。利用者設定・package scriptは変更していません。
- 最終ソースではrenderer TypeScript → renderer bundle → main TypeScript → Vitest全体 → dependency-cruiserをNode CLIから再実行し、全て成功しました。Vitest **648成功・5 skip**、依存境界違反0です。
- 実Electronの自動操作 **18項目成功**。実preload・IPC・ファイルI/OとDOM操作を使用し、設定・userData・作業ディレクトリは一時領域へ隔離しました。保存遅延とダイアログ回答だけを検証用に差し替えています。人手によるOSダイアログ操作の確認ではありません。
- 外部tecsgenは意図的に未検出状態で確認しています。外部tecsgen本体の正常実行、OS関連付け・印刷は今回の検証対象外です。
- `git diff --check` 成功。コミット・push・マージ・タグ作成は行っていません。

証跡: [実機検証スクリプト](stage0-electron-smoke.mjs)、[18項目の結果](stage0-electron-smoke.json)、[画面](stage0-electron-smoke.png)。コマンド全文ログは同じディレクトリの `2026-11-09-stage0-check.log`・`2026-11-09-stage0-final-check.log` と `stage0-electron-smoke.log` に保存しています（既存gitignore対象）。

## 仕様参照

Vaultの `work/active/TECSCDE-DT-EL内部仕様/` にある「07J 保存チェックポイントと未保存判定」「07I 複数ファイルの一括読み込み契約」「07H セッション保存と復元」「監査対応 09-18 読み込みと設定」を正契約として確認しました。計画と「三者監査 69件の実装要否一覧」の対象行を更新します。

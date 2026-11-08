# tecsgen 出力の基準データ(MrubyBridgePlugin 系)

内部 tecsgen(外部仕様 8.5、内部仕様 9D.6)の生成物を照合するための基準データです。外部の tecsgen が実際に出力した CDL を、加工せずに保存しています。

## 採取条件(2026-11-08)

- tecsgen: **1.9.1**(`TECSGEN_COMMAND` の `tecsgen-rb/tecsgen.rb`、Ruby 4.0.6、Windows)。`MrubyBridgePlugin` は version 2.0.0
- 入力: `tests/hr-tecs/workspace/sample1/tEV3Sample.tecsgen-opts` と `tEV3Sample.cdl`(`-g` で出力先を別ディレクトリに指定)
- 保存したもの: 出力ディレクトリの `*.cdl` の全55ファイル(うち0バイトが23ファイル)
- リポジトリ同梱の tecsgen 1.5.A.5 は、Ruby 4.0.6 では動かない(`G1014`)。プラグインのソースも 1.9.1 とは異なる(例: `MrubyBridgeSignaturePlugin.rb` は 42,510 バイトと 37,032 バイト)。**この基準データは 1.9.1 のものとして扱うこと**

## 確認済みの性質

- 決定性: 2回実行して、55ファイルすべてが完全一致した。
- `tmp_MrubyBridgeSignaturePlugin_N.cdl`(N=0〜14): 13個は署名名だけから決まる定型文と完全一致する。`sCyclic`(N=13)と `sTask`(N=14)は、構造体のセルタイプ(`t_rcyc`、`t_rtsk`・`t_rtex`・`t_rovr`)が末尾に付く。
- `tmp_MrubyBridgeSignaturePlugin_post_code.cdl` の `cell ..._Initializer` の並びは、署名の CDL の N の順と一致する。
- `tmp_HRP2*Plugin_*.cdl` は、すべて0バイト(HRP2 系は、この入力では CDL を生成しない)。

## 使い方の注意

- **改行**: 非空の32ファイルはすべて CRLF(Windows 上の tecsgen の出力)。内部処理の出力と比較するときは、両者の改行を LF に正規化して比べること。ファイルは `.gitattributes`(`* -text`)で、改行の変換を受けないようにしている。
- 内部処理が未実装のため、現時点では比較するテストはない。内部実装が付表(外部仕様 8.5)の登録を求めるときは、これらとの一致を条件とする。

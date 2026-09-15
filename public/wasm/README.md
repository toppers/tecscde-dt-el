# public/wasm/ — CDL 解析系の WebAssembly バイナリ

TECSCDE外部仕様 2.2 が唯一の外部依存として認める CDL 解析系の実体。
TECSCDE内部仕様 第4章（CDLパーサ／シリアライザ設計）の規定に対応する。

Vite の `public/` 配下に置くのは、`vite.config.ts` の `assetsInlineLimit`
（全アセットをインライン化する設定）に wasm を乗せないため。base64 化で
約1.4倍に膨らむのを避け、`public/samples/*.cdl` と同じ「素の静的アセットを
fetch する」扱いに揃えている。

## ファイル

| ファイル | 出所 | サイズ | ABI |
|---|---|---|---|
| `tree-sitter-cdl.wasm` | `<tecsgen>/branches/ykominami_r3033/tools/tree-sitter-cdl/tree-sitter-cdl.wasm` | 107,328 B | LANGUAGE_VERSION 15 |
| `tree-sitter-tecs_cdecl.wasm` | `<tecsgen>/branches/ykominami_r3033/tools/tree-sitter-tecs-cdecl/tree-sitter-tecs_cdecl.wasm` | 105,722 B | LANGUAGE_VERSION 15 |
| `tree-sitter.wasm` | `node_modules/web-tree-sitter@0.25.10/tree-sitter.wasm` | 205,553 B | — （web-tree-sitter 自身のランタイム） |

`<tecsgen>` = `E:/Crepo/toppers-tecs-svn/toppers/tecsgen`（ローカルの SVN 作業コピー）

コピー日: 2026-09-13

## なぜ npm 依存にせず、バイナリをコピーしているのか

文法パッケージ（`tree-sitter-cdl` / `tree-sitter-tecs-cdecl`）を npm 依存として
取り込むには、次の5つの障害がある（2026-09-13 時点）。

1. `tools/` 配下は SVN 未コミット（作業コピーのみ）
2. `package.json` に `"install": "node-gyp rebuild"` があり、`file:` 依存でも
   ネイティブビルドが走って C++ ツールチェーンを要求する
3. `"files"` が `lib`/`dist`/`.wasm` を含まないため、公開しても届かない
4. `lib/index.ts` が `__dirname` 依存でブラウザでは動かない
5. `dist/` が未ビルド

ブラウザ版に必要なのは `.wasm` だけなので、それだけを取り込み、ローダーは
`src/cdl/grammar.ts` に自前で書いている。

## 更新するとき

文法（`bnf.y.rb` / `C_parser.y.rb` 由来）が変わったら、上記の出所から
`.wasm` を再コピーし、本 README のサイズと日付を更新すること。
`web-tree-sitter` のランタイム wasm は `npm update` 後に
`node_modules/web-tree-sitter/tree-sitter.wasm` から再コピーする
（**バージョンによってファイル名が変わる**: 0.25.x は `tree-sitter.wasm`、
0.27.x は `web-tree-sitter.wasm`）。

文法ソースへの追随を自動検知する CI は未整備（TECSCDE内部仕様 12.1 の既存課題）。

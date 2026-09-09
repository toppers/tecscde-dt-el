// [[TECSCDE-DT-EL内部仕様]] 第5章5.1節 — 描画クラスの階層。
//
// セル・結合の描画ロジックを要素種別ごとの下位クラスへ分離する。既存のJS版
// （[[TECSCDE-JS-TS実装]] `svgRenderer.ts`）はセルと結合の描画が1クラス内の条件分岐に
// 混在していたが、`ElementRenderer` のサブクラス分離により「セルの描画を変えても
// 結合の描画に影響しない」ことが型レベルでも明確になる。
//
// このモジュールはDOM/SVGへアクセスするため renderer プロセスでのみ動作する
// （第2章2.3節）。Electronの main/preload とは無関係。

const SVG_NS = "http://www.w3.org/2000/svg";

/** SVG要素を名前空間付きで生成する薄いヘルパー。 */
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

/** 属性をまとめて設定する（数値は文字列化）。 */
export function setAttrs(el: Element, attrs: Readonly<Record<string, string | number>>): void {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
}

/**
 * 要素種別ごとの描画担当の基底。
 *
 * - `createElement`: モデルから新しい `<g>` を生成する（対応表に未登録のとき）。
 * - `updateElement`: 既存の `<g>` の内容・属性を差し替える。要素そのものは再生成しない
 *   —— `SvgRenderer` が保持する `Map<Id, SVGGElement>` の対応を壊さないため（5.1節）。
 *
 * `TContext` は描画に必要な周辺情報（表示状態・結合の両端セルなど）。
 */
export abstract class ElementRenderer<TModel, TContext> {
  abstract createElement(model: TModel, ctx: TContext): SVGGElement;
  abstract updateElement(model: TModel, element: SVGGElement, ctx: TContext): void;
}

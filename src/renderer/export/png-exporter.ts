// DT-EL内部仕様7F.10.5: 単独 SVG を白背景の PNG にラスタライズする。
import type { ExportedSvg } from "./svg-exporter";
import { MM_TO_PX } from "../render/view";

export type PngScale = 1 | 2 | 4;

/** 大きな図でキャンバス確保が過大にならないための安全上限。 */
export const MAX_PNG_DIMENSION = 16_384;
export const MAX_PNG_PIXELS = 64_000_000;

export class PngExportTooLargeError extends Error {
  constructor() {
    super("PNGの出力サイズが大きすぎます。倍率を下げて再試行してください。");
    this.name = "PngExportTooLargeError";
  }
}

export class PngExporter {
  static pixelSize(svg: ExportedSvg, scale: PngScale): { width: number; height: number } {
    const width = Math.ceil(svg.widthMm * MM_TO_PX * scale);
    const height = Math.ceil(svg.heightMm * MM_TO_PX * scale);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
        width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || width * height > MAX_PNG_PIXELS) {
      throw new PngExportTooLargeError();
    }
    return { width, height };
  }

  static async rasterize(svg: ExportedSvg, scale: PngScale): Promise<Uint8Array> {
    const { width, height } = this.pixelSize(svg, scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG用キャンバスを初期化できませんでした。");

    const source = new Blob([svg.svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(source);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG画像を生成できませんでした。")), "image/png");
      });
      return new Uint8Array(await png.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

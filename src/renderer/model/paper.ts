// TECSCDE-TS内部仕様 3.2 — 用紙サイズ・向き（外部仕様3.2.1）。

export type PaperSize = "A4" | "A3" | "A2";
export type PaperOrientation = "LANDSCAPE" | "PORTRAIT";

/** 用紙の内容領域サイズ（余白10mmを除いた値、外部仕様3.2.1）。 */
const CONTENT_SIZE_LANDSCAPE: Readonly<Record<PaperSize, { width: number; height: number }>> = {
  A4: { width: 277, height: 190 },
  A3: { width: 400, height: 277 },
  A2: { width: 574, height: 400 },
};

export class PaperSpec {
  private constructor(
    readonly size: PaperSize,
    readonly orientation: PaperOrientation,
  ) {}

  static create(size: PaperSize, orientation: PaperOrientation = "LANDSCAPE"): PaperSpec {
    return new PaperSpec(size, orientation);
  }

  static default(): PaperSpec {
    return new PaperSpec("A4", "LANDSCAPE"); // 5.4.2: JS版の既定はA4横
  }

  contentSize(): { width: number; height: number } {
    const base = CONTENT_SIZE_LANDSCAPE[this.size];
    return this.orientation === "PORTRAIT"
      ? { width: base.height, height: base.width }
      : { width: base.width, height: base.height };
  }
}

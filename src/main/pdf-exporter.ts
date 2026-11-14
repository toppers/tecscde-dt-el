// DT-EL内部仕様7F.10.6: SVGを非表示のElectronウィンドウで1ページPDFへ変換する。
import { BrowserWindow } from "electron";
import type { PrintToPDFOptions } from "electron";
import type { PdfPage } from "../shared/ipc-types.js";

const PAPER_MM = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
} as const;

function pageDimensions(page: PdfPage): { widthMm: number; heightMm: number } {
  if (page.kind === "custom") return page;
  const base = PAPER_MM[page.size];
  return page.orientation === "LANDSCAPE"
    ? { widthMm: base.height, heightMm: base.width }
    : { widthMm: base.width, heightMm: base.height };
}

export class PdfExporter {
  static async render(svg: string, page: PdfPage): Promise<Buffer> {
    const { widthMm, heightMm } = pageDimensions(page);
    if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) ||
        widthMm < 10 || heightMm < 10 || widthMm > 5080 || heightMm > 5080) {
      throw new Error("PDFの用紙サイズが範囲外です。");
    }

    const options: PrintToPDFOptions = {
      pageSize: page.kind === "paper" ? page.size : { width: widthMm / 25.4, height: heightMm / 25.4 },
      landscape: page.kind === "paper" && page.orientation === "LANDSCAPE",
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
      html, body { width: ${widthMm}mm; height: ${heightMm}mm; margin: 0; padding: 0; overflow: hidden; }
      svg { display: block; }
    </style></head><body>${svg}</body></html>`;
    const window = new BrowserWindow({
      show: false,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
      await window.loadURL(`data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`);
      return await window.webContents.printToPDF(options);
    } finally {
      window.destroy();
    }
  }
}

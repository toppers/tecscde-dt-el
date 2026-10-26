// DT-EL内部仕様7F.10.6: 非表示ウィンドウ・ページ設定・確実な後片付け。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfExporter } from "../../src/main/pdf-exporter.js";

const { BrowserWindowMock, loadURL, printToPDF, destroy } = vi.hoisted(() => {
  const loadURL = vi.fn().mockResolvedValue(undefined);
  const printToPDF = vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7\n"));
  const destroy = vi.fn();
  const BrowserWindowMock = vi.fn().mockImplementation(function MockBrowserWindow() {
    return { loadURL, webContents: { printToPDF }, destroy };
  });
  return { BrowserWindowMock, loadURL, printToPDF, destroy };
});

vi.mock("electron", () => ({ BrowserWindow: BrowserWindowMock }));

beforeEach(() => {
  BrowserWindowMock.mockClear();
  loadURL.mockClear();
  printToPDF.mockReset().mockResolvedValue(Buffer.from("%PDF-1.7\n"));
  destroy.mockClear();
});

describe("PdfExporter", () => {
  it("prints an A4 landscape page in a hidden, script-disabled window", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm"/>';
    const result = await PdfExporter.render(svg, { kind: "paper", size: "A4", orientation: "LANDSCAPE" });

    expect(result.subarray(0, 4).toString()).toBe("%PDF");
    expect(BrowserWindowMock).toHaveBeenCalledWith({
      show: false,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const url = loadURL.mock.calls[0]![0] as string;
    expect(url.startsWith("data:text/html;base64,")).toBe(true);
    const html = Buffer.from(url.split(",")[1]!, "base64").toString("utf-8");
    expect(html).toContain("@page { size: 297mm 210mm; margin: 0; }");
    expect(html).toContain(svg);
    expect(printToPDF).toHaveBeenCalledWith({
      pageSize: "A4", landscape: true, printBackground: true, preferCSSPageSize: true,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("sets a custom content page size in inches without changing its direction", async () => {
    await PdfExporter.render("<svg/>", { kind: "custom", widthMm: 125, heightMm: 80 });
    const options = printToPDF.mock.calls[0]![0] as { pageSize: { width: number; height: number }; landscape: boolean };
    expect(options.pageSize.width).toBeCloseTo(125 / 25.4);
    expect(options.pageSize.height).toBeCloseTo(80 / 25.4);
    expect(options.landscape).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the hidden window when printing fails", async () => {
    printToPDF.mockRejectedValue(new Error("print failed"));
    await expect(PdfExporter.render("<svg/>", { kind: "paper", size: "A3", orientation: "PORTRAIT" }))
      .rejects.toThrow("print failed");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("rejects invalid custom dimensions before creating a window", async () => {
    await expect(PdfExporter.render("<svg/>", { kind: "custom", widthMm: Number.NaN, heightMm: 80 }))
      .rejects.toThrow("PDFの用紙サイズ");
    expect(BrowserWindowMock).not.toHaveBeenCalled();
  });
});

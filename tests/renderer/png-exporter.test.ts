/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { PngExporter, PngExportTooLargeError } from "../../src/renderer/export/png-exporter";
import type { ExportedSvg } from "../../src/renderer/export/svg-exporter";

const source: ExportedSvg = { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', widthMm: 20, heightMm: 10 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PngExporter", () => {
  it("scales physical SVG dimensions and rejects oversized output before allocating a canvas", () => {
    const one = PngExporter.pixelSize(source, 1);
    const four = PngExporter.pixelSize(source, 4);
    expect(four.width).toBeGreaterThan(one.width * 3);
    expect(four.height).toBeGreaterThan(one.height * 3);

    const canvas = vi.spyOn(document, "createElement");
    expect(() => PngExporter.pixelSize({ ...source, widthMm: 10_000 }, 4)).toThrow(PngExportTooLargeError);
    expect(canvas).not.toHaveBeenCalled();
  });

  it("fills white, draws the SVG, returns PNG bytes, and releases the image URL", async () => {
    const encoded = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const context = { fillStyle: "", fillRect, drawImage };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new NodeBlob([encoded], { type: "image/png" }) as Blob);
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:test-svg");
    const revokeObjectURL = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    });
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("Image", class {
      src = "";
      decode = vi.fn().mockResolvedValue(undefined);
    });

    const png = await PngExporter.rasterize(source, 2);
    const size = PngExporter.pixelSize(source, 2);
    expect([...png]).toEqual([...encoded]);
    expect(context.fillStyle).toBe("#ffffff");
    expect(fillRect).toHaveBeenCalledWith(0, 0, size.width, size.height);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, size.width, size.height);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-svg");
  });

  it("releases the image URL when decoding fails", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const revokeObjectURL = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL {
      static override createObjectURL = () => "blob:test-svg";
      static override revokeObjectURL = revokeObjectURL;
    });
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("Image", class {
      src = "";
      decode = vi.fn().mockRejectedValue(new Error("decode failed"));
    });

    await expect(PngExporter.rasterize(source, 1)).rejects.toThrow("decode failed");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-svg");
  });
});

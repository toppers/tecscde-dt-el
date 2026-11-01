// アプリケーションの版の唯一の情報源は package.json の version（外部仕様2.5.5）。
// ビルド時に esbuild の define（と vitest の define）で埋め込んだ値が、これと一致することを確かめる。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_COMMIT, APP_VERSION } from "../../src/renderer/app-info";
import { CdlSerializer } from "../../src/renderer/cdl/serializer";
import { TECSCDE_TS_VERSION } from "../../src/renderer/model/tool-info-types";
import { TecscdeDocument } from "../../src/renderer/model/document";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8")) as { version: string };

describe("app version (single source: package.json)", () => {
  it("APP_VERSION is the version in package.json", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("the version written into a saved .cde (tecscde_version) is the same version", () => {
    expect(TECSCDE_TS_VERSION).toBe(pkg.version);
    const text = CdlSerializer.serialize(TecscdeDocument.empty(), new Date("2026-11-01T00:00:00Z"));
    expect(text).toContain(`"tecscde_version": "${pkg.version}"`);
  });

  it("APP_COMMIT is a non-empty string (a short hash, or 'unknown' when git is unavailable)", () => {
    expect(APP_COMMIT).toMatch(/^([0-9a-f]{7,}|unknown)$/);
  });
});

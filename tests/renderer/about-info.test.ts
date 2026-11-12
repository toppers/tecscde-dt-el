// 外部仕様3.8: バージョン情報ダイアログに出す項目と、「コピー」するテキスト。
import { describe, expect, it } from "vitest";
import { buildAboutRows, formatAboutText } from "../../src/renderer/app/about-info";

const runtime = { electron: "44.2.0", chrome: "140.0.1", node: "22.10.0", platform: "win32" };

describe("buildAboutRows", () => {
  const base = { appVersion: "0.1.0", commit: "abc1234", formatVersion: "0.1.0.0", runtime };

  it("lists the app version, build, format version, tecsgen and runtime in order", () => {
    const rows = buildAboutRows({ ...base, tecsgen: { version: [1, 9, 1], command: "tecsgen" } });
    expect(rows).toEqual([
      { label: "アプリケーションの版", value: "0.1.0" },
      { label: "ビルド", value: "abc1234" },
      { label: "形式の版", value: "0.1.0.0" },
      { label: "tecsgen", value: "1.9.1（tecsgen）" },
      { label: "実行環境", value: "Electron 44.2.0 / Chromium 140.0.1 / Node 22.10.0 / win32" },
    ]);
  });

  it("shows tecsgen as unconfirmed, with the command, when the version could not be read", () => {
    const rows = buildAboutRows({ ...base, tecsgen: { command: "ruby tecsgen.rb" } });
    expect(rows.find((r) => r.label === "tecsgen")!.value).toBe("未確認（ruby tecsgen.rb）");
  });

  it("shows tecsgen as unconfirmed when the check has not finished (no information yet)", () => {
    const rows = buildAboutRows(base);
    expect(rows.find((r) => r.label === "tecsgen")!.value).toBe("未確認");
  });

  it("shows the runtime as unknown when it is not available", () => {
    const rows = buildAboutRows({ appVersion: "0.1.0", commit: "unknown", formatVersion: "0.1.0.0" });
    expect(rows.find((r) => r.label === "実行環境")!.value).toBe("不明");
    expect(rows.find((r) => r.label === "ビルド")!.value).toBe("unknown");
  });
});

describe("formatAboutText", () => {
  it("writes one 'label: value' line per row, so it can be pasted anywhere", () => {
    const text = formatAboutText([
      { label: "アプリケーションの版", value: "0.1.0" },
      { label: "ビルド", value: "abc1234" },
    ]);
    expect(text).toBe("アプリケーションの版: 0.1.0\nビルド: abc1234");
  });
});

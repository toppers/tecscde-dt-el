// [[TECSCDE-DT-EL内部仕様]] 第3章3.2節 — `isUnderAny`（システム定義CDLの判定に使うパス比較）。

import { describe, expect, it } from "vitest";
import { isUnderAny, normalizePathForCompare } from "../../src/shared/path-under";

describe("normalizePathForCompare", () => {
  it("unifies separators and resolves . and .. and repeated separators", () => {
    expect(normalizePathForCompare("C:\\proj\\sys\\..\\lib\\.\\a.cdl")).toBe("C:/proj/lib/a.cdl");
    expect(normalizePathForCompare("/a//b/./c/")).toBe("/a/b/c");
    expect(normalizePathForCompare("a/../../b")).toBe("../b");
  });
});

describe("isUnderAny", () => {
  it("is true for files and nested files under a directory", () => {
    expect(isUnderAny("/sys/a.cdl", ["/sys"])).toBe(true);
    expect(isUnderAny("/sys/lib/deep/a.cdl", ["/sys"])).toBe(true);
  });

  it("compares at the directory boundary (/sys is not a prefix of /sysx)", () => {
    expect(isUnderAny("/sysx/a.cdl", ["/sys"])).toBe(false);
    expect(isUnderAny("/other/sys/a.cdl", ["/sys"])).toBe(false);
  });

  it("does not count the directory itself", () => {
    expect(isUnderAny("/sys", ["/sys"])).toBe(false);
    expect(isUnderAny("/sys/", ["/sys"])).toBe(false);
  });

  it("matches any of several directories, and none for an empty list", () => {
    expect(isUnderAny("/b/x.cdl", ["/a", "/b"])).toBe(true);
    expect(isUnderAny("/b/x.cdl", [])).toBe(false);
  });

  it("normalizes . and .. on both sides", () => {
    expect(isUnderAny("/proj/lib/../sys/a.cdl", ["/proj/./sys/"])).toBe(true);
    expect(isUnderAny("/proj/sys/../other/a.cdl", ["/proj/sys"])).toBe(false);
  });

  it("is case-insensitive and separator-agnostic for Windows paths only", () => {
    expect(isUnderAny("C:\\Proj\\Sys\\a.cdl", ["c:/proj/sys"])).toBe(true);
    expect(isUnderAny("/Proj/Sys/a.cdl", ["/proj/sys"])).toBe(false);
  });
});

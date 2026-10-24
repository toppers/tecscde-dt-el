// [[TECSCDE-DT-EL内部仕様 - 06B 表示フィルタUI設計]] 6B.4 — リージョンの色の割り当て。

import { describe, expect, it } from "vitest";
import { asRegionId } from "../../src/renderer/model/ids";
import { Region, RegionTree } from "../../src/renderer/model/region";
import { REGION_PALETTE, fnv1a32, regionColor, regionColorMap } from "../../src/renderer/view-state/region-colors";

describe("regionColor — 6B.4", () => {
  it("is deterministic and comes from the palette", () => {
    const id = asRegionId("::A");
    expect(regionColor(id)).toBe(regionColor(asRegionId("::A")));
    expect(REGION_PALETTE).toContain(regionColor(id));
  });

  it("gives the root no color", () => {
    expect(regionColor(asRegionId("::"))).toBeUndefined();
  });

  it("matches known FNV-1a 32-bit vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });
});

describe("regionColorMap — 6B.4", () => {
  const build = (order: "AB" | "BA"): RegionTree => {
    const A = Region.create(asRegionId("::A"), "::A");
    const B = Region.create(asRegionId("::B"), "::B");
    return RegionTree.of(Region.create(asRegionId("::"), "::", order === "AB" ? [A, B] : [B, A]));
  };

  it("covers every non-root region and omits the root", () => {
    const map = regionColorMap(build("AB"));
    expect([...map.keys()].sort()).toEqual(["::A", "::B"]);
  });

  it("does not depend on registration order", () => {
    const x = regionColorMap(build("AB"));
    const y = regionColorMap(build("BA"));
    expect(y.get(asRegionId("::A"))).toBe(x.get(asRegionId("::A")));
    expect(y.get(asRegionId("::B"))).toBe(x.get(asRegionId("::B")));
  });
});

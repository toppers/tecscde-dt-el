import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WriteQueue } from "../../src/main/write-queue.js";

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((r) => { finish = r; });
  return { promise, finish };
}

describe("WriteQueue", () => {
  it("orders normalized aliases while another destination can finish independently", async () => {
    const queue = new WriteQueue();
    const gate = deferred();
    const writes: string[] = [];
    const first = queue.write(resolve("out.cdl"), async () => {
      writes.push("first-start");
      await gate.promise;
      writes.push("first-end");
    });
    const second = queue.write(resolve("sub", "..", "out.cdl"), async () => { writes.push("second"); });
    const other = queue.write(resolve("other.cdl"), async () => { writes.push("other"); });
    await other;
    expect(writes).toEqual(["first-start", "other"]);
    gate.finish();
    const receipts = await Promise.all([first, second]);
    expect(writes).toEqual(["first-start", "other", "first-end", "second"]);
    expect(receipts.map((r) => r.writeSequence)).toEqual([1, 2]);
  });

  it("lets reads wait for accepted writes and recovers after an earlier rejection", async () => {
    const queue = new WriteQueue();
    const gate = deferred();
    const path = resolve("out.cdl");
    const failed = queue.write(path, async () => { await gate.promise; throw new Error("disk full"); });
    const failure = expect(failed).rejects.toThrow("disk full");
    let readReady = false;
    const read = queue.waitForPath(path).then(() => { readReady = true; });
    await Promise.resolve();
    expect(readReady).toBe(false);
    gate.finish();
    await failure;
    await read;
    const next = await queue.write(path, async () => {});
    expect(next.writeSequence).toBe(2);
  });
});

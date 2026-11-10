// 07J.7: all windows share one queue per normalized destination. A failed write
// rejects its own request, while the settled tail always admits the next one.
import { resolve } from "node:path";

export interface WriteReceipt {
  readonly path: string;
  readonly writeSequence: number;
}

export function destinationKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export class WriteQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly sequences = new Map<string, number>();

  write(path: string, operation: (absolutePath: string) => Promise<void>): Promise<WriteReceipt> {
    const absolutePath = resolve(path);
    const key = destinationKey(absolutePath);
    const writeSequence = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, writeSequence);
    const result = (this.tails.get(key) ?? Promise.resolve()).then(async () => {
      await operation(absolutePath);
      return { path: absolutePath, writeSequence };
    });
    const tail = result.then(() => {}, () => {});
    this.tails.set(key, tail);
    void tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }

  async waitForPath(path: string): Promise<void> {
    await this.tails.get(destinationKey(path));
  }
}

export const fileWrites = new WriteQueue();

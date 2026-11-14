// [[TECSCDE-DT-EL内部仕様 - 09D V0.2.0tecsgen設定と内部処理]] 9D.6 — 内部処理の入出力に使う、メモリ上の仮想ファイル。
// ディスクへは書かない。実行ごとに新しく作り、失敗した実行の内容は取り込まない（9D.6 の5）。

export interface VirtualFileSystem {
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  list(): readonly string[];
}

/** 9D.6 の6: ファイル数と合計サイズの上限（外部仕様8.1と同じ）。 */
export const VFS_MAX_FILES = 10_000;
export const VFS_MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export class VirtualFileLimitError extends Error {}

/** 仮想パスは `plugin:/<プラグイン名>/<ファイル名>.cdl` 形に正規化する（9D.6 の4）。 */
export function virtualPluginPath(pluginName: string, fileName: string): string {
  return `plugin:/${pluginName}/${fileName}`;
}

export class MemoryFileSystem implements VirtualFileSystem {
  private readonly files = new Map<string, string>();
  private totalBytes = 0;

  read(path: string): string | undefined {
    return this.files.get(path);
  }

  write(path: string, text: string): void {
    const previous = this.files.get(path);
    const nextTotal = this.totalBytes - byteLength(previous ?? "") + byteLength(text);
    if (previous === undefined && this.files.size >= VFS_MAX_FILES) {
      throw new VirtualFileLimitError(`仮想ファイルの数が上限（${VFS_MAX_FILES}）を超えました`);
    }
    if (nextTotal > VFS_MAX_TOTAL_BYTES) {
      throw new VirtualFileLimitError(`仮想ファイルの合計サイズが上限（${VFS_MAX_TOTAL_BYTES} バイト）を超えました`);
    }
    this.files.set(path, text);
    this.totalBytes = nextTotal;
  }

  list(): readonly string[] {
    return [...this.files.keys()];
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

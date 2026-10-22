// [[TECSCDE-DT-EL内部仕様]] 第3章3.2節: システム定義CDLの判定に使う、パスが指定ディレクトリの配下かどうかの比較。
// Nodeの`path`をrendererから使えないため、依存の無い純粋関数にして、main・rendererの両方で使う。
//
// 規則（外部仕様5.3節）: 正規化（`.`／`..`の解消、区切り文字の統一）したうえで、ディレクトリの
// 境界で比べる（`/sys`は`/sysx`の配下ではない）。Windows形式のパス（ドライブ文字、UNC）では
// 大文字小文字を区別しない。シンボリックリンクの解決はしない（規定しない）。

function isWindowsStyle(path: string): boolean {
  return /^[A-Za-z]:/.test(path) || path.startsWith("\\\\") || path.startsWith("//");
}

/** 区切りを`/`に統一し、`.`・`..`・連続する区切り・末尾の区切りを解消する。 */
export function normalizePathForCompare(path: string): string {
  const unified = path.split(String.fromCharCode(92)).join("/"); // バックスラッシュを`/`に統一
  const drive = /^[A-Za-z]:/.exec(unified)?.[0] ?? "";
  const rest = unified.slice(drive.length);
  const absolute = rest.startsWith("/");
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!absolute) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  return `${drive}${absolute ? "/" : ""}${parts.join("/")}`;
}

/** `path`が`dirs`のいずれかの配下（サブディレクトリを含む）にあるか。`dir`自身は配下に含めない。 */
export function isUnderAny(path: string, dirs: readonly string[]): boolean {
  const caseInsensitive = isWindowsStyle(path);
  const fold = (s: string): string => (caseInsensitive ? s.toLowerCase() : s);
  const target = fold(normalizePathForCompare(path));
  return dirs.some((dir) => {
    const base = fold(normalizePathForCompare(dir));
    if (base === "") return false;
    const prefix = base.endsWith("/") ? base : `${base}/`;
    return target.startsWith(prefix) && target.length > prefix.length;
  });
}

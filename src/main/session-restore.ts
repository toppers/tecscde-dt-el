// [[TECSCDE-DT-EL内部仕様 - 07H セッション保存と復元]] 7H.3:
// Source roles/order come from the snapshot; a single opts parse supplies both context arrays.
import { isAbsolute, win32 } from "node:path";
import type { OpenResult, SessionSnapshot, TecsgenOptionsFile } from "../shared/ipc-types.js";

interface SessionFileService {
  openBatch(request: {
    readonly primaryPath: string | null;
    readonly referencePaths: readonly string[];
    readonly sourceOrder: readonly string[];
  }): Promise<OpenResult>;
  parseTecsgenOptionsFile(path: string): Promise<TecsgenOptionsFile>;
}

/** Failure of a stored source rejects the whole restoration; opts failure alone is recoverable. */
export async function restoreSession(fileService: SessionFileService, saved: SessionSnapshot): Promise<OpenResult> {
  const session = structuredClone(saved);
  const optionsFilePath = session.optionsFilePath;
  let extraImportPaths = [...session.extraImportPaths];
  let systemDirs: readonly string[] = [];
  if (optionsFilePath !== undefined) {
    try {
      const parsed = await fileService.parseTecsgenOptionsFile(optionsFilePath);
      extraImportPaths = [...parsed.importPaths];
      systemDirs = [...parsed.systemDirs];
    } catch {
      // Keep the saved options path as the base for relative saved import paths.
    }
  } else {
    extraImportPaths = extraImportPaths.filter((path) => isAbsolute(path) || win32.isAbsolute(path));
  }
  const sourceOrder = session.sourceOrder ?? [
    ...session.referencePaths,
    ...(session.editablePath === null ? [] : [session.editablePath]),
  ];
  const opened = await fileService.openBatch({
    primaryPath: session.editablePath,
    referencePaths: session.referencePaths,
    sourceOrder,
  });
  return {
    ...opened,
    extraImportPaths,
    systemDirs,
    ...(optionsFilePath !== undefined ? { optionsFilePath } : {}),
  };
}

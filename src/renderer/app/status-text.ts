import type { InputMode } from "./store";

const modeLabels = {
  select: "選択",
  newCell: "セル新規作成",
} as const satisfies Record<InputMode, string>;

export function inputModeLabel(mode: InputMode): "選択" | "セル新規作成" {
  return modeLabels[mode];
}

function documentName(filePath: string | null): string {
  return filePath?.split(/[\\/]/).at(-1) || "(未保存)";
}

/** Plain text for document.title; the caller must not interpret file names as HTML. */
export function documentTitle(filePath: string | null, dirty: boolean): string {
  return `${dirty ? "* " : ""}${documentName(filePath)} — TECSCDE`;
}

/** The same dirty value is shared by the title, status and close-state protection. */
export function documentStatusText(filePath: string | null, dirty: boolean): string {
  return `${documentName(filePath)}${dirty ? " ● 未保存の変更" : ""}`;
}

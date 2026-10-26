// 外部仕様3.2.1: 用紙サイズ・向きを1回のUndo単位で変更する。
import { Command } from "./command";
import type { TecscdeDocument } from "../model/document";
import { PaperSpec, type PaperOrientation, type PaperSize } from "../model/paper";

export class ChangePaperCommand extends Command {
  readonly kind = "ChangePaper";
  override readonly summary = "change paper";

  constructor(
    private readonly size: PaperSize,
    private readonly orientation: PaperOrientation,
  ) {
    super();
  }

  apply(doc: TecscdeDocument): TecscdeDocument {
    return doc.withPaper(PaperSpec.create(this.size, this.orientation));
  }
}

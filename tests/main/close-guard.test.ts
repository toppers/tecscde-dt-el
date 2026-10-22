// [[TECSCDE-DT-EL内部仕様]] 第7章7.9節 — ウィンドウを閉じるときの未保存確認（CloseGuard）。
// BrowserWindowは差し替え、`close`イベントの扱いとダイアログの呼び出しだけを検証する。

import { describe, expect, it, vi } from "vitest";
import { CloseGuard, type CloseGuardWindow } from "../../src/main/close-guard.js";

function setup(confirmDiscard: () => Promise<boolean>) {
  let closeListener: ((event: { preventDefault(): void }) => void) | undefined;
  const win: CloseGuardWindow = {
    on: (_event, listener) => {
      closeListener = listener;
    },
    close: vi.fn(),
  };
  const guard = new CloseGuard(win, confirmDiscard);
  const fireClose = () => {
    const event = { preventDefault: vi.fn() };
    closeListener!(event);
    return event;
  };
  return { win, guard, fireClose };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CloseGuard", () => {
  it("lets the window close without asking when nothing is unsaved", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { fireClose } = setup(confirm);
    const event = fireClose();
    await flush();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stops the close and asks when unsaved changes exist", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const { guard, fireClose } = setup(confirm);
    guard.setDirty(true);
    const event = fireClose();
    await flush();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("closes the window once the user chooses to discard, without asking again", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { win, guard, fireClose } = setup(confirm);
    guard.setDirty(true);
    fireClose();
    await flush();
    expect(win.close).toHaveBeenCalledTimes(1);
    // win.close() がもう一度 close イベントを起こしても、確認せずに通す。
    const second = fireClose();
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("keeps the window open when the user cancels, and asks again on the next close", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const { win, guard, fireClose } = setup(confirm);
    guard.setDirty(true);
    fireClose();
    await flush();
    expect(win.close).not.toHaveBeenCalled();
    fireClose();
    await flush();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("does not show a second dialog while one is already open", async () => {
    let resolve!: (value: boolean) => void;
    const confirm = vi.fn().mockReturnValue(new Promise<boolean>((r) => { resolve = r; }));
    const { guard, fireClose } = setup(confirm);
    guard.setDirty(true);
    fireClose();
    fireClose();
    expect(confirm).toHaveBeenCalledTimes(1);
    resolve(false);
    await flush();
  });

  it("closes without asking after the changes are saved (dirty becomes false)", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const { guard, fireClose } = setup(confirm);
    guard.setDirty(true);
    guard.setDirty(false);
    const event = fireClose();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});

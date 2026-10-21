import React, { useEffect, useRef } from "react";
export function ReloadDialog({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const root = dialog.current?.getRootNode() as
      Document | ShadowRoot | undefined;
    const prior = root?.activeElement;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {
      dialog.current?.close();
      if (prior instanceof HTMLElement) prior.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="reload-dialog"
      aria-labelledby="reload-title"
      aria-describedby="reload-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id="reload-title">重新載入這首歌？</h3>
      <p id="reload-description">
        將清除三路搜尋結果、請求修改、AI
        回覆、選用歌詞及校時進度，並依目前設定重新搜尋。此操作無法復原。
      </p>
      <div className="row">
        <button ref={cancel} disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button className="danger" disabled={busy} onClick={onConfirm}>
          {busy ? "正在清除…" : "清除並重新搜尋"}
        </button>
      </div>
    </dialog>
  );
}

import { useEffect, useRef } from "react";
export default function Confirm({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    cancel.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Tab") {
            const nodes = box.current?.querySelectorAll("button");
            if (
              nodes &&
              ((e.shiftKey && document.activeElement === nodes[0]) ||
                (!e.shiftKey &&
                  document.activeElement === nodes[nodes.length - 1]))
            ) {
              e.preventDefault();
              (e.shiftKey ? nodes[nodes.length - 1] : nodes[0])?.focus();
            }
          }
        }}
      >
        <h2 id="confirmation-title">操作の確認</h2>
        <p>{message}</p>
        <button ref={cancel} onClick={onCancel}>
          キャンセル
        </button>
        <button className="primary" onClick={onConfirm}>
          確認して実行
        </button>
      </div>
    </div>
  );
}

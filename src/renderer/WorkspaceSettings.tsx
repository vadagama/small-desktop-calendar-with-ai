import { useEffect, useRef } from "react";
import { ArrowLeftRight, Check, Columns2, Rows2, X } from "lucide-react";
import type { Placement } from "./DockWorkspace";

export function WorkspaceSettings({
  placement,
  move,
  resize,
  close,
}: {
  placement: Placement;
  move: (next: Placement) => void;
  resize: (delta: number) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => before?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal workspace-settings"
      aria-label="Рабочее пространство"
      onCancel={close}
    >
      <div className="modal-header">
        <h2>Рабочее пространство</h2>
        <button
          className="icon-button"
          aria-label="Закрыть настройки пространства"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <p className="modal-description">
        Расположите календарь и ассистента так, как удобно вам.
      </p>
      <h3 className="settings-heading">Положение ассистента</h3>
      <div
        className="layout-options"
        role="group"
        aria-label="Положение ассистента"
      >
        {(
          [
            ["right", "Справа"],
            ["left", "Слева"],
            ["below", "Снизу"],
            ["above", "Сверху"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={placement === id ? "selected" : ""}
            aria-pressed={placement === id}
            onClick={() => move(id)}
          >
            {id === "right" || id === "left" ? (
              <Columns2 size={24} />
            ) : (
              <Rows2 size={24} />
            )}
            <span>{label}</span>
            {placement === id && <Check className="layout-check" size={13} />}
          </button>
        ))}
      </div>
      <p className="form-note">
        <ArrowLeftRight size={14} />
        Перетащите заголовок к краю другой панели или потяните границу, чтобы
        изменить размер.
      </p>
      <div className="workspace-size-actions">
        <span>Размер ассистента</span>
        <button
          className="secondary"
          aria-label="Уменьшить панель ассистента"
          onClick={() => resize(-48)}
        >
          −
        </button>
        <button
          className="secondary"
          aria-label="Увеличить панель ассистента"
          onClick={() => resize(48)}
        >
          +
        </button>
      </div>
      <p className="form-note">
        Расположение действует до закрытия приложения.
      </p>
    </dialog>
  );
}

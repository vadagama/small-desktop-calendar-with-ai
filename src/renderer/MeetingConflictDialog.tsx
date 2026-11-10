import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function MeetingConflictDialog({
  editing,
  names,
  confirm,
  cancel,
}: {
  editing: boolean;
  names: string[];
  confirm: () => void;
  cancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal meeting-conflict"
      aria-labelledby="meeting-conflict-title"
      aria-describedby="meeting-conflict-description"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
    >
      <div className="modal-header">
        <h2 id="meeting-conflict-title">Есть пересечения</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Вернуться к встрече"
          onClick={cancel}
        >
          <X size={20} />
        </button>
      </div>
      <p id="meeting-conflict-description">
        У участников есть пересечения с выбранным временем.{" "}
        {editing
          ? "Вы действительно хотите сохранить изменения встречи?"
          : "Вы действительно хотите создать встречу?"}
      </p>
      {names.length > 0 && (
        <ul>
          {names.map((name, index) => (
            <li key={`${index}:${name}`}>{name}</li>
          ))}
        </ul>
      )}
      <div className="meeting-conflict-actions">
        <button autoFocus type="button" className="secondary" onClick={cancel}>
          Вернуться
        </button>
        <button type="button" className="primary" onClick={confirm}>
          {editing ? "Сохранить изменения" : "Создать встречу"}
        </button>
      </div>
    </dialog>
  );
}

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function DiscardMeetingDialog({
  keepEditing,
  discard,
}: {
  keepEditing: () => void;
  discard: () => void;
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
      className="modal discard-meeting"
      aria-labelledby="discard-meeting-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        keepEditing();
      }}
    >
      <div className="modal-header">
        <h2 id="discard-meeting-title">Отменить несохранённые изменения?</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Вернуться к событию"
          onClick={keepEditing}
        >
          <X size={18} />
        </button>
      </div>
      <div className="discard-meeting-actions">
        <button
          autoFocus
          type="button"
          className="secondary"
          onClick={keepEditing}
        >
          Отмена
        </button>
        <button type="button" className="primary" onClick={discard}>
          Не сохранять
        </button>
      </div>
    </dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { TopicRulesReply } from "../shared/analytics.js";

interface Row {
  id: number;
  topic: string;
  keywords: string;
}
let nextId = 0;
const split = (value: string) =>
  value
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);

export function AnalyticsRules({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const accept = (reply: TopicRulesReply) => {
    if (!mounted.current) return false;
    if (!reply.ok) {
      setError(reply.error);
      return false;
    }
    setRows(
      reply.rules.map((rule) => ({
        id: nextId++,
        topic: rule.topic,
        keywords: rule.keywords.join(", "),
      })),
    );
    return true;
  };
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    void window.smallDesktop.topicRules
      .read()
      .then((reply) => {
        // A corrupted file is shown as an empty list that a save can repair.
        if (!accept(reply) && mounted.current) setRows([]);
      })
      .catch(() => {
        if (mounted.current) {
          setError("Не удалось загрузить правила тем.");
          setRows([]);
        }
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const update = (id: number, patch: Partial<Row>) =>
    setRows(
      (current) =>
        current?.map((row) => (row.id === id ? { ...row, ...patch } : row)) ??
        null,
    );
  const save = async () => {
    if (busy || !rows) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await window.smallDesktop.topicRules.save(
        rows.map((row) => ({
          topic: row.topic.trim(),
          keywords: split(row.keywords),
        })),
      );
      if (accept(reply) && mounted.current) setNotice("Правила сохранены.");
    } catch {
      if (mounted.current) setError("Не удалось сохранить правила.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="modal analytics-rules-dialog"
      aria-labelledby="analytics-rules-title"
      onCancel={close}
      onClose={close}
    >
      <div className="modal-header">
        <h2 id="analytics-rules-title">Правила тем аналитики</h2>
        <button
          className="icon-button"
          aria-label="Закрыть правила тем"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <p className="reminder-help">
        Встреча относится к первой теме из списка, у которой любое ключевое
        слово встречается в названии (регистр не важен). Остальные попадают в
        «Без категории». Правила хранятся только на этом компьютере.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!rows ? (
        <p role="status">Загружаю правила…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {rows.map((row, index) => (
            <fieldset className="analytics-rule" key={row.id}>
              <label>
                Тема {index + 1}
                <input
                  value={row.topic}
                  maxLength={60}
                  required
                  disabled={busy}
                  onChange={(event) =>
                    update(row.id, { topic: event.target.value })
                  }
                />
              </label>
              <label>
                Ключевые слова {index + 1} (через запятую)
                <input
                  value={row.keywords}
                  required
                  disabled={busy}
                  onChange={(event) =>
                    update(row.id, { keywords: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Удалить тему ${index + 1}`}
                disabled={busy}
                onClick={() =>
                  setRows((current) =>
                    current ? current.filter((r) => r.id !== row.id) : null,
                  )
                }
              >
                <Trash2 size={18} />
              </button>
            </fieldset>
          ))}
          {!rows.length && <p>Правил нет: все встречи «Без категории».</p>}
          <div className="analytics-rules-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || rows.length >= 20}
              onClick={() =>
                setRows((current) => [
                  ...(current ?? []),
                  { id: nextId++, topic: "", keywords: "" },
                ])
              }
            >
              <Plus size={16} /> Добавить тему
            </button>
            <button className="primary" disabled={busy}>
              Сохранить правила тем
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

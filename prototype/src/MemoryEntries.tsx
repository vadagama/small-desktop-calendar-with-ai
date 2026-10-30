import { useState } from "react";
import { Brain, PencilLine, Plus, Trash2 } from "lucide-react";

export interface MemoryEntry {
  id: string;
  text: string;
  source: string;
}

function EntryEditor({
  text,
  save,
  cancel,
}: {
  text: string;
  save: (text: string) => void | Promise<void>;
  cancel: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState("");
  return (
    <form
      className="memory-entry-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!draft.trim()) {
          setError("Введите текст сохранённого контекста.");
          return;
        }
        await save(draft.trim());
      }}
    >
      <label>
        Текст записи
        <textarea
          autoFocus
          rows={3}
          maxLength={2000}
          value={draft}
          placeholder="Что ассистенту стоит запомнить?"
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-actions">
        <button className="primary" type="submit">
          Сохранить запись
        </button>
        <button className="secondary" type="button" onClick={cancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function MemoryEntries({
  entries,
  change,
  announce,
  saveEntry,
  deleteEntry,
}: {
  entries: MemoryEntry[];
  change: (entries: MemoryEntry[]) => void;
  announce: (text: string) => void;
  saveEntry?: (id: string | undefined, text: string) => Promise<boolean>;
  deleteEntry?: (id: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="memory-section" aria-labelledby="memory-entries-title">
      <div className="memory-section-heading">
        <h3 id="memory-entries-title">
          <Brain size={16} />
          Сохранённый контекст{" "}
          <span className="memory-count">{entries.length}</span>
        </h3>
        <button
          className="text-button memory-add"
          onClick={() => setEditing("new")}
        >
          <Plus size={14} />
          Добавить запись
        </button>
      </div>
      <p className="memory-hint">
        То, что вы попросили запомнить: люди, проекты, привычки и другие
        полезные детали.
      </p>
      {editing === "new" && (
        <EntryEditor
          key="new"
          text=""
          cancel={() => setEditing(null)}
          save={async (text) => {
            if (saveEntry) {
              if (await saveEntry(undefined, text)) setEditing(null);
              return;
            }
            change([
              ...entries,
              {
                id: crypto.randomUUID(),
                text,
                source: "Добавлено в настройках · 30 октября 2026",
              },
            ]);
            setEditing(null);
            announce("Запись добавлена в демо-память.");
          }}
        />
      )}
      {!entries.length && editing !== "new" && (
        <div className="memory-empty">
          <Brain size={20} />
          <strong>Пока нет сохранённых записей</strong>
          <p>Добавьте запись здесь или попросите ассистента: «Запомни…».</p>
        </div>
      )}
      <ul className="memory-entries">
        {entries.map((entry, index) => (
          <li key={entry.id}>
            {editing === entry.id ? (
              <EntryEditor
                key={entry.id}
                text={entry.text}
                cancel={() => setEditing(null)}
                save={async (text) => {
                  if (saveEntry) {
                    if (await saveEntry(entry.id, text)) setEditing(null);
                    return;
                  }
                  change(
                    entries.map((item) =>
                      item.id === entry.id
                        ? {
                            ...item,
                            text,
                            source: "Изменено в настройках · 30 октября 2026",
                          }
                        : item,
                    ),
                  );
                  setEditing(null);
                  announce("Запись обновлена.");
                }}
              />
            ) : (
              <>
                <div className="memory-entry-content">
                  <p>{entry.text}</p>
                  <small>{entry.source}</small>
                </div>
                <div className="memory-entry-actions">
                  <button
                    className="icon-button"
                    aria-label={`Изменить запись ${index + 1}`}
                    title="Изменить запись"
                    onClick={() => setEditing(entry.id)}
                  >
                    <PencilLine size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Удалить запись ${index + 1}`}
                    title="Удалить запись"
                    onClick={async () => {
                      if (deleteEntry) {
                        await deleteEntry(entry.id);
                        return;
                      }
                      change(entries.filter((item) => item.id !== entry.id));
                      announce("Запись удалена.");
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

import { useState } from "react";
import { RotateCcw } from "lucide-react";

export const preferenceFields = [
  {
    key: "duration",
    label: "Длительность, минут",
    type: "number",
    min: 1,
    max: 480,
  },
  { key: "from", label: "Предлагать время с", type: "time" },
  { key: "to", label: "Предлагать время до", type: "time" },
  { key: "buffer", label: "Перерыв, минут", type: "number", min: 0, max: 120 },
] as const;
export type PreferenceKey = (typeof preferenceFields)[number]["key"];
export type Preferences = Record<PreferenceKey, string>;
export const emptyPreferences: Preferences = {
  duration: "",
  from: "",
  to: "",
  buffer: "",
};

export function MemoryPreferences({
  values,
  save,
  cancel,
}: {
  values: Preferences;
  save: (values: Preferences) => void;
  cancel: () => void;
}) {
  const [draft, setDraft] = useState(values);
  const [error, setError] = useState("");
  return (
    <form
      className="memory-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.from && draft.to && draft.from >= draft.to) {
          setError("Начало диапазона должно быть раньше окончания.");
          return;
        }
        save(draft);
      }}
    >
      <div className="memory-fields">
        {preferenceFields.map((field, index) => (
          <label key={field.key}>
            {field.label}
            <span className="memory-input-row">
              <input
                autoFocus={index === 0}
                type={field.type}
                {...("min" in field
                  ? { min: field.min, max: field.max, step: 1 }
                  : {})}
                value={draft[field.key]}
                placeholder="Не задано"
                onChange={(event) => {
                  setDraft({ ...draft, [field.key]: event.target.value });
                  setError("");
                }}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={`Сбросить ${field.key === "duration" ? "длительность" : field.key === "buffer" ? "перерыв" : field.key === "from" ? "начало диапазона" : "конец диапазона"}`}
                title="Сбросить значение"
                disabled={!draft[field.key]}
                onClick={() => {
                  setDraft({ ...draft, [field.key]: "" });
                  setError("");
                }}
              >
                <RotateCcw size={14} />
              </button>
            </span>
          </label>
        ))}
      </div>
      <p className="memory-hint">
        Пустое поле — без предпочтения. Перерыв учитывается до и после ваших
        встреч.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-actions">
        <button className="primary" type="submit">
          Сохранить предпочтения
        </button>
        <button className="secondary" type="button" onClick={cancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

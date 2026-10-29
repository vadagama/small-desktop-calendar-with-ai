import "./prompt-templates.css";

export function PromptTemplatesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <section className="prompt-templates-editor" aria-label="Шаблоны запросов">
      <h3>Шаблоны запросов · {value.length}/5</h3>
      <p className="form-note">
        Быстрые запросы на стартовом экране. Нажатие отправляет текст
        ассистенту.
      </p>
      {value.map((text, index) => (
        <div className="prompt-template-row" key={index}>
          <label>
            Шаблон {index + 1}
            <textarea
              aria-label={`Шаблон ${index + 1}`}
              rows={2}
              required
              maxLength={2000}
              value={text}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index ? event.target.value : item,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="text-button"
            aria-label={`Удалить шаблон ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Удалить
          </button>
        </div>
      ))}
      {!value.length && (
        <p className="form-note">
          Нет шаблонов. Добавьте запрос, которым часто пользуетесь.
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={value.length >= 5}
        onClick={() => onChange([...value, ""])}
      >
        Добавить шаблон
      </button>
    </section>
  );
}

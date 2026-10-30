import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "./Dialogs";
import "./assistant-settings.css";

interface AssistantSettings {
  mood: string;
  instructions: string;
}
export const defaultAssistantSettings: AssistantSettings = {
  mood: "neutral",
  instructions: "",
};

export function AssistantSettingsDialog({
  values,
  save,
  close,
}: {
  values: AssistantSettings;
  save: (values: AssistantSettings) => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(values);
  return (
    <Modal label="Настройки AI-помощника" close={close}>
      <form
        className="assistant-settings-prototype"
        onSubmit={(event) => {
          event.preventDefault();
          save({ ...draft, instructions: draft.instructions.trim() });
        }}
      >
        <p className="ai-settings-description">
          <Sparkles size={16} />
          Настройте стиль ответов и инструкции для помощника.
        </p>
        <label>
          Стиль общения
          <select
            value={draft.mood}
            onChange={(event) =>
              setDraft({ ...draft, mood: event.target.value })
            }
          >
            <option value="neutral">Нейтральный</option>
            <option value="strict">Строгий</option>
            <option value="youthful">Молодёжный</option>
            <option value="alpha">Альфа</option>
            <option value="technical">Технарь</option>
          </select>
        </label>
        <label>
          Инструкции помощнику
          <textarea
            rows={5}
            value={draft.instructions}
            maxLength={8000}
            placeholder="Например, отвечай кратко и указывай даты полностью."
            onChange={(event) =>
              setDraft({ ...draft, instructions: event.target.value })
            }
          />
        </label>
        <p className="ai-settings-note">
          Предпочтения встреч и сохранённый контекст находятся в разделе
          «Память» с иконкой мозга.
        </p>
        <div className="ai-settings-actions">
          <button className="primary" type="submit">
            Сохранить
          </button>
          <button className="secondary" type="button" onClick={close}>
            Отмена
          </button>
        </div>
        <p className="ai-settings-note">
          Демо-настройки · сохраняются до перезагрузки страницы и пока не влияют
          на ответы ассистента.
        </p>
      </form>
    </Modal>
  );
}

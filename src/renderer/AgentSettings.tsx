import { PromptTemplatesEditor } from "./PromptTemplatesEditor";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  skillLabels,
  moodIds,
  moodLabels,
  type Mood,
  type AgentSettingsReply,
  type AgentSettingsState,
} from "../shared/agent-settings.js";

export function AgentSettings({
  close,
  update,
}: {
  close: () => void;
  update: (state: AgentSettingsState) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<AgentSettingsState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let mounted = true;
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    void window.smallDesktop.agentSettings
      .read()
      .then((reply) => {
        if (!mounted) return;
        if (reply.ok) setState(reply.state);
        else setError(reply.error);
      })
      .catch(() => {
        if (mounted) setError("Не удалось загрузить настройки");
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
      before?.focus();
    };
  }, []);
  async function perform(
    action: () => Promise<AgentSettingsReply>,
    message: string,
    closeOnSuccess = false,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await action();
      if (reply.ok) {
        setState(reply.state);
        update(reply.state);
        setNotice(message);
        if (closeOnSuccess) close();
      } else setError(reply.error);
    } catch {
      setError("Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal agent-settings"
      aria-label="Настройки AI-помощника"
      onCancel={close}
    >
      <div className="modal-header">
        <h2>Настройки AI-помощника</h2>
        <button
          className="icon-button"
          aria-label="Закрыть настройки AI-помощника"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <p className="modal-description">
        Задайте предпочтения и настройте календарные навыки. Сохранённые
        изменения действуют со следующего запроса к календарному помощнику.
      </p>
      {busy && <p role="status">Загрузка или сохранение…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-note" role="status">
          {notice}
        </p>
      )}
      <form
        className="meeting-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (state)
            void perform(
              () => window.smallDesktop.agentSettings.save(state.settings),
              "Настройки сохранены",
              true,
            );
        }}
      >
        {state && (
          <fieldset disabled={busy} className="agent-settings-fields">
            <PromptTemplatesEditor
              value={state.settings.promptTemplates ?? []}
              onChange={(promptTemplates) => {
                setNotice("");
                setState({
                  ...state,
                  settings: { ...state.settings, promptTemplates },
                });
              }}
            />
            <label>
              Mood · стиль общения
              <select
                value={state.settings.mood}
                onChange={(event) => {
                  setNotice("");
                  setState({
                    ...state,
                    settings: {
                      ...state.settings,
                      mood: event.target.value as Mood,
                    },
                  });
                }}
              >
                {moodIds.map((id) => (
                  <option value={id} key={id}>
                    {moodLabels[id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ваши инструкции
              <textarea
                rows={4}
                maxLength={8000}
                value={state.settings.instructions}
                placeholder="Например: отвечай кратко и предлагай утренние встречи."
                onChange={(event) => {
                  setNotice("");
                  setState({
                    ...state,
                    settings: {
                      ...state.settings,
                      instructions: event.target.value,
                    },
                  });
                }}
              />
            </label>
            <p className="form-note">
              Предпочтения помогают выбирать варианты в рамках возможностей
              календаря. Текущий подбор времени работает в Asia/Almaty. Не
              добавляйте ключи доступа: инструкции передаются выбранной модели.
            </p>
            <h3>Календарные навыки</h3>
            {state.settings.skills.map((skill, index) => (
              <details key={skill.id}>
                <summary>
                  {skillLabels[skill.id]} ·{" "}
                  {skill.enabled ? "Включён" : "Отключён"}
                </summary>
                <label className="agent-skill-toggle">
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={(event) => {
                      setNotice("");
                      setState({
                        ...state,
                        settings: {
                          ...state.settings,
                          skills: state.settings.skills.map((item, i) =>
                            i === index
                              ? { ...item, enabled: event.target.checked }
                              : item,
                          ),
                        },
                      });
                    }}
                  />
                  Включить: {skillLabels[skill.id]}
                </label>
                <label>
                  Инструкции: {skillLabels[skill.id]}
                  <textarea
                    aria-label={`Инструкции: ${skillLabels[skill.id]}`}
                    rows={9}
                    required
                    maxLength={16000}
                    value={skill.content}
                    spellCheck={false}
                    onChange={(event) => {
                      setNotice("");
                      setState({
                        ...state,
                        settings: {
                          ...state.settings,
                          skills: state.settings.skills.map((item, i) =>
                            i === index
                              ? { ...item, content: event.target.value }
                              : item,
                          ),
                        },
                      });
                    }}
                  />
                </label>
              </details>
            ))}
            <details>
              <summary>Технический промпт · только чтение</summary>
              <pre className="agent-system-preview">{state.system}</pre>
            </details>
          </fieldset>
        )}
        <div className="model-actions">
          <button className="primary" type="submit" disabled={busy || !state}>
            Сохранить настройки
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(
                () => window.smallDesktop.agentSettings.reset(),
                "Стандартные настройки восстановлены",
              )
            }
          >
            Восстановить стандартные
          </button>
        </div>
      </form>
    </dialog>
  );
}

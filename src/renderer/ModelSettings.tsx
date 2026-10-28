import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type {
  ProfileId,
  ProfileReply,
  ProfileState,
} from "../shared/profiles.js";

function fields(id: ProfileId, state: ProfileState) {
  return (
    state.profiles.find((profile) => profile.id === id) ?? {
      id,
      baseURL: id === "small" ? "https://ai.skiftrade.kz/v1" : "",
      modelId: id === "small" ? "vllm/glm-5.3-flash" : "",
    }
  );
}
function origin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function ModelSettings({
  initial,
  close,
  update,
}: {
  initial: ProfileState;
  close: () => void;
  update: (state: ProfileState) => void;
}) {
  const [state, setState] = useState(initial);
  const [id, setId] = useState<ProfileId>(
    initial.active === "personal" ? "personal" : "small",
  );
  const [baseURL, setBaseURL] = useState(fields(id, initial).baseURL);
  const [modelId, setModelId] = useState(fields(id, initial).modelId);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const saved = state.profiles.find((profile) => profile.id === id);
  const keepKey = saved && origin(saved.baseURL) === origin(baseURL);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => before?.focus();
  }, []);
  async function perform(action: () => Promise<ProfileReply>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const pending = action();
      setApiKey("");
      const reply = await pending;
      if (!reply.ok) {
        setError(reply.error);
        return;
      }
      setState(reply.state);
      update(reply.state);
      setNotice(reply.state.warning || message);
    } catch {
      setError("Не удалось обратиться к настройкам модели");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal model-settings"
      aria-label="Настройки модели"
      onCancel={close}
    >
      <div className="modal-header">
        <h2>Настройки модели</h2>
        <button
          className="icon-button"
          aria-label="Закрыть настройки модели"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      <p className="modal-description">
        Выберите сервис и сохраните ключ в Keychain этого Mac. Автоматического
        переключения между моделями нет.
      </p>
      <form
        className="meeting-form"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(
            () =>
              window.smallDesktop.profiles.save({
                id,
                baseURL,
                modelId,
                ...(apiKey ? { apiKey } : {}),
              }),
            "Профиль сохранён и выбран",
          );
        }}
      >
        <label>
          Профиль
          <select
            aria-label="Профиль"
            value={id}
            disabled={busy}
            onChange={(event) => {
              const nextId = event.target.value as ProfileId;
              const next = fields(nextId, state);
              setId(nextId);
              setBaseURL(next.baseURL);
              setModelId(next.modelId);
              setApiKey("");
              setError("");
              setNotice("");
            }}
          >
            <option value="small">Small vLLM</option>
            <option value="personal">Персональный OpenAI-compatible</option>
          </select>
        </label>
        <label>
          Base URL
          <input
            type="url"
            required
            value={baseURL}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setBaseURL(event.target.value);
              setApiKey("");
            }}
          />
        </label>
        <label>
          Model ID
          <input
            required
            value={modelId}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            onChange={(event) => setModelId(event.target.value)}
          />
        </label>
        <label>
          API-ключ
          <input
            type="password"
            value={apiKey}
            required={!keepKey}
            disabled={busy}
            autoComplete="new-password"
            spellCheck={false}
            maxLength={8192}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <p className="form-note">
          {keepKey
            ? "Ключ уже был сохранён. Оставьте поле пустым, чтобы использовать его."
            : "Для нового адреса сервиса нужен новый ключ."}{" "}
          Поле очищается после отправки; сохранённый ключ в интерфейс не
          возвращается.
        </p>
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
        <div className="model-actions">
          <button className="primary" type="submit" disabled={busy}>
            Сохранить и использовать
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(
                () => window.smallDesktop.profiles.activate("synthetic"),
                "Выбрана локальная проверка",
              )
            }
          >
            Локальная проверка
          </button>
          {saved && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() =>
                void perform(
                  () => window.smallDesktop.profiles.remove(id),
                  "Ключ и профиль удалены",
                )
              }
            >
              Удалить ключ и профиль
            </button>
          )}
          <button className="text-button" type="button" onClick={close}>
            Готово
          </button>
        </div>
      </form>
    </dialog>
  );
}

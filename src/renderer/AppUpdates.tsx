import { useEffect, useState } from "react";
import type { UpdateState } from "../shared/updates.js";
import "./app-updates.css";

function useUpdates() {
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      received = false;
    const unsubscribe = window.smallDesktop.updates.subscribe((value) => {
      received = true;
      if (active) {
        setState(value);
        setError("");
      }
    });
    void window.smallDesktop.updates
      .read()
      .then((value) => {
        if (active && !received) setState(value);
      })
      .catch(() => {
        if (active) setError("Не удалось получить состояние обновлений.");
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function run(action: "check" | "install") {
    setError("");
    try {
      await window.smallDesktop.updates[action]();
    } catch {
      setError("Не удалось обратиться к обновлениям. Повторите попытку.");
    }
  }
  return { state, error, run };
}

const messages: Record<UpdateState["status"], string> = {
  idle: "Обновления проверяются автоматически.",
  checking: "Проверяем обновления…",
  current: "Установлена актуальная версия.",
  downloading: "Скачиваем обновление…",
  ready: "Обновление готово к установке.",
  installing: "Подготавливаем перезапуск…",
  error: "Не удалось обновить календарь.",
  unsupported: "Автообновление недоступно.",
};

function UpdateDetails({ state }: { state: UpdateState }) {
  return (
    <>
      <p role="status">
        {state.version ? `Версия ${state.version}. ` : ""}
        {messages[state.status]}
      </p>
      {state.message && (
        <p className={state.status === "error" ? "form-error" : "form-note"}>
          {state.message}
        </p>
      )}
      {state.status === "downloading" && (
        <label className="update-progress">
          Скачано {Math.floor(state.percent ?? 0)}%
          <progress
            aria-label="Скачивание обновления"
            value={state.percent ?? 0}
            max={100}
          />
        </label>
      )}
      {state.notes && (
        <details className="update-notes">
          <summary>Что нового</summary>
          <p>{state.notes}</p>
        </details>
      )}
    </>
  );
}

export function UpdateSettings() {
  const { state, error, run } = useUpdates();
  return (
    <section className="app-updates" aria-label="Обновления календаря">
      <h3>Обновления календаря</h3>
      {state ? (
        <>
          <p>Текущая версия: {state.currentVersion}</p>
          <UpdateDetails state={state} />
          {state.checkedAt && (
            <p className="form-note">
              Последняя проверка:{" "}
              {new Date(state.checkedAt).toLocaleString("ru-RU")}
            </p>
          )}
          {state.status === "ready" ? (
            <button
              type="button"
              className="primary"
              onClick={() => void run("install")}
            >
              Перезапустить и установить
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={[
                "checking",
                "downloading",
                "installing",
                "unsupported",
              ].includes(state.status)}
              onClick={() => void run("check")}
            >
              {state.status === "error"
                ? "Повторить попытку"
                : "Проверить обновления"}
            </button>
          )}
          <p className="form-note">
            Стабильные выпуски из GitHub Releases. Проверка при запуске и каждые
            4 часа. Настройки и сохранённый контекст сохраняются.
          </p>
        </>
      ) : (
        <p role="status">Получаем состояние обновлений…</p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </section>
  );
}

export function UpdateNotice() {
  const { state, error, run } = useUpdates();
  const [dismissed, setDismissed] = useState("");
  if (
    !state?.version ||
    dismissed === state.version ||
    !["downloading", "ready", "installing", "error"].includes(state.status)
  )
    return null;
  return (
    <aside className="update-notice" aria-label="Обновление календаря">
      <UpdateDetails state={state} />
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="update-actions">
        {state.status === "ready" && (
          <button className="primary" onClick={() => void run("install")}>
            Перезапустить и установить
          </button>
        )}
        {state.status === "error" && (
          <button onClick={() => void run("check")}>Повторить попытку</button>
        )}
        {state.status !== "installing" && (
          <button onClick={() => setDismissed(state.version!)}>Позже</button>
        )}
      </div>
    </aside>
  );
}

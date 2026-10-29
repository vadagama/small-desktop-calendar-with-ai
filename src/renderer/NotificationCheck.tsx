import { useEffect, useState } from "react";
import type { NativeNotificationState } from "../shared/reminders.js";
export function NotificationCheck() {
  const [state, setState] = useState<NativeNotificationState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const read = () => {
      void window.smallDesktop.notifications
        .read()
        .then((value) => {
          if (active) setState(value);
        })
        .catch(() => {});
    };
    read();
    const timer = window.setInterval(read, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const run = async (action: "test" | "settings") => {
    setBusy(true);
    try {
      setState(await window.smallDesktop.notifications[action]());
    } catch {
      setState({
        status: "failed",
        message: "Не удалось проверить системные уведомления.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Проверка системных уведомлений"
      className="notification-check"
    >
      <h3>Уведомления macOS</h3>
      <p>
        Разрешите уведомления для Small Calendar в настройках macOS. Проверьте
        показ в Центре уведомлений и режим фокусирования.
      </p>
      <div className="model-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run("test")}
        >
          Отправить тестовое уведомление
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run("settings")}
        >
          Настройки macOS
        </button>
      </div>
      {state && (
        <p role="status" data-delivery={state.status}>
          {state.message}
        </p>
      )}
    </section>
  );
}

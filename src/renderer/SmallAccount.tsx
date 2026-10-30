import { useEffect, useRef, useState } from "react";
import { UserRound, X } from "lucide-react";
import type { SmallAuthReply, SmallAuthState } from "../shared/small-auth.js";

export function SmallAccount({
  onChange,
  revision = 0,
}: {
  onChange?: (state: SmallAuthState | null) => void;
  revision?: number;
}) {
  const [state, setState] = useState<SmallAuthState>({ status: "signed-out" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let mounted = true;
    setBusy(true);
    onChange?.(null);
    void window.smallDesktop.smallAuth
      .read()
      .then((reply) => {
        if (!mounted) return;
        if (reply.ok) {
          setState(reply.state);
          onChange?.(reply.state);
        } else {
          setError(reply.error);
          onChange?.(null);
        }
      })
      .catch(() => {
        if (mounted) setError("Не удалось проверить вход в Small");
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, [onChange, revision]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  async function perform(action: () => Promise<SmallAuthReply>) {
    setBusy(true);
    onChange?.(null);
    setError("");
    setPassword("");
    try {
      const reply = await action();
      if (reply.ok) {
        setState(reply.state);
        onChange?.(reply.state);
      } else {
        setState({ status: "signed-out" });
        setError(reply.error);
      }
    } catch {
      setState({ status: "signed-out" });
      setError("Не удалось связаться с Small");
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setPassword("");
    setOpen(false);
  }
  const profile = state.status === "signed-in" ? state.profile : null;
  return (
    <>
      <button
        className="rail-avatar"
        aria-label="Профиль Small"
        title={profile?.name ?? "Войти в Small"}
        onClick={() => setOpen(true)}
      >
        {profile ? profile.name.slice(0, 1) : <UserRound size={20} />}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="modal small-account"
          aria-labelledby="small-account-title"
          onCancel={close}
          onClose={close}
        >
          <div className="modal-header">
            <h2 id="small-account-title">
              {profile ? "Профиль Small" : "Вход в Small"}
            </h2>
            <button
              className="icon-button"
              aria-label="Закрыть профиль Small"
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          <p className="modal-description">
            Учётная запись Team Small. Сессия сохраняется в зашифрованном
            хранилище этого Mac. После входа доступны ваши календари.
          </p>
          {busy && (
            <p className="form-note" role="status">
              Проверяю доступ к Small…
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {state.status === "signed-out" && state.warning && (
            <p className="form-note" role="status">
              {state.warning}
            </p>
          )}
          {profile ? (
            <div className="meeting-form">
              <strong>{profile.name}</strong>
              <p>{profile.username}</p>
              <div className="model-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(() => window.smallDesktop.smallAuth.read())
                  }
                >
                  Проверить сессию
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void perform(() => window.smallDesktop.smallAuth.logout())
                  }
                >
                  Выйти из Small
                </button>
              </div>
            </div>
          ) : (
            <form
              className="meeting-form"
              aria-busy={busy}
              onSubmit={(event) => {
                event.preventDefault();
                const input = { username, password };
                void perform(() => window.smallDesktop.smallAuth.login(input));
              }}
            >
              <label>
                Логин
                <input
                  name="username"
                  autoComplete="username"
                  required
                  maxLength={200}
                  value={username}
                  disabled={busy}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label>
                Пароль
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className="form-note">
                Пароль очищается после отправки. Ассистент не получает пароль и
                сессию.
              </p>
              <div className="model-actions">
                <button className="primary" type="submit" disabled={busy}>
                  Войти в Small
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void perform(() => window.smallDesktop.smallAuth.read())
                  }
                >
                  Повторить проверку
                </button>
              </div>
            </form>
          )}
        </dialog>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  ShieldCheck,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import type { SmallAuthState, SmallAuthStatus } from "../shared/small-auth.js";
import { useSmallAccount } from "./useSmallAccount";
import { SmallLoginForm } from "./SmallLoginForm";

export const smallAuthLabels: Record<SmallAuthStatus, string> = {
  checking: "Проверяем вход…",
  verified: "Вход подтверждён",
  "signed-out": "Войти в Small",
  required: "Требуется вход",
  unknown: "Сессия не проверена",
};

export function SmallAccount({
  onChange,
  onStatusChange,
}: {
  onChange?: (state: SmallAuthState) => void;
  onStatusChange?: (status: SmallAuthStatus) => void;
}) {
  const { state, status, busy, error, checkedAt, needsLogin, perform, check } =
    useSmallAccount(onChange, onStatusChange);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const profile = state.status === "signed-in" ? state.profile : null;
  const showProfile = profile && !needsLogin;
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("small:open-account", show);
    return () => window.removeEventListener("small:open-account", show);
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  function close() {
    setOpen(false);
  }
  const StatusIcon =
    status === "verified"
      ? CircleCheck
      : status === "checking"
        ? LoaderCircle
        : status === "unknown"
          ? WifiOff
          : CircleAlert;
  return (
    <>
      <button
        className="rail-avatar small-account-trigger"
        aria-label="Профиль Small"
        title={`${smallAuthLabels[status]}${profile ? ` · ${profile.name}` : ""}`}
        onClick={() => setOpen(true)}
      >
        {profile ? profile.name.slice(0, 1) : <UserRound size={20} />}
        <span className={`small-auth-dot ${status}`} aria-hidden="true" />
        <span className="sr-only">{smallAuthLabels[status]}</span>
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
              {showProfile ? "Профиль Small" : "Вход в Small"}
            </h2>
            <button
              className="icon-button"
              aria-label="Закрыть профиль Small"
              onClick={close}
            >
              <X size={20} />
            </button>
          </div>
          {status !== "signed-out" &&
            (profile || status === "checking" || status === "unknown") && (
              <div className={`small-account-status ${status}`} role="status">
                <StatusIcon size={18} aria-hidden="true" />
                <div>
                  <strong>
                    {status === "required"
                      ? "Сессия Small завершена"
                      : status === "unknown"
                        ? "Не удалось проверить сессию"
                        : smallAuthLabels[status]}
                  </strong>
                  <p>
                    {status === "verified"
                      ? "Сессия проверена сервером Small."
                      : status === "required"
                        ? "Войдите повторно, чтобы обновлять календарь и изменять встречи."
                        : status === "unknown"
                          ? "Проверьте подключение и повторите проверку."
                          : "Проверяем доступ к Small…"}
                  </p>
                </div>
              </div>
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
          {showProfile ? (
            <>
              <div className="small-account-identity">
                <span className="small-account-avatar">
                  {profile.name.slice(0, 1)}
                </span>
                <div>
                  <strong className="small-account-name">{profile.name}</strong>
                  <p>{profile.username}</p>
                </div>
              </div>
              <div className="small-account-checked">
                <span>Последняя успешная проверка</span>
                <time>
                  {checkedAt
                    ? new Date(checkedAt).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Asia/Almaty",
                      })
                    : "—"}
                </time>
              </div>
              <div className="model-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  {status === "unknown"
                    ? "Повторить проверку"
                    : "Проверить доступ"}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    void perform(
                      () => window.smallDesktop.smallAuth.logout(),
                      "logout",
                    );
                  }}
                >
                  Выйти из Small
                </button>
              </div>
            </>
          ) : (
            <>
              {status !== "required" && (
                <p className="modal-description">
                  Войдите с рабочей учётной записью Team Small, чтобы работать с
                  календарём.
                </p>
              )}
              <SmallLoginForm
                initialUsername={profile?.username ?? ""}
                status={status}
                busy={busy}
                check={check}
                login={(input) => {
                  void perform(
                    () => window.smallDesktop.smallAuth.login(input),
                    "login",
                  );
                }}
              />
            </>
          )}
          <footer className="small-account-security">
            <ShieldCheck size={16} aria-hidden="true" />
            <p>
              Сессия хранится в зашифрованном хранилище этого{" "}
              {window.smallDesktop.platform === "darwin" ? "Mac" : "устройства"}
              .<br />
              Ассистент не получает пароль и сессию.
            </p>
          </footer>
        </dialog>
      )}
    </>
  );
}

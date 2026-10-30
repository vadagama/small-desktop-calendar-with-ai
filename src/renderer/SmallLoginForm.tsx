import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { SmallAuthStatus } from "../shared/small-auth.js";

export function SmallLoginForm({
  initialUsername,
  status,
  busy,
  login,
  check,
}: {
  initialUsername: string;
  status: SmallAuthStatus;
  busy: boolean;
  login: (input: { username: string; password: string }) => void;
  check: () => Promise<void>;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form
      className="meeting-form"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        // Native autofill can update the fields without a React change event.
        const data = new FormData(event.currentTarget);
        const input = {
          username: String(data.get("username") ?? ""),
          password: String(data.get("password") ?? ""),
        };
        setUsername(input.username);
        setPassword("");
        setShowPassword(false);
        login(input);
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
          placeholder="Ваш рабочий логин"
          disabled={busy}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label htmlFor="small-account-password">Пароль</label>
      <div className="small-account-password">
        <input
          id="small-account-password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          placeholder="Введите пароль"
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
          onClick={() => setShowPassword(!showPassword)}
        >
          {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      <button
        className="primary small-account-submit"
        type="submit"
        disabled={busy}
      >
        {busy
          ? "Проверяем вход…"
          : status === "required"
            ? "Войти повторно"
            : "Войти в Small"}
      </button>
      {status === "unknown" && (
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={() => void check()}
        >
          Повторить проверку
        </button>
      )}
    </form>
  );
}

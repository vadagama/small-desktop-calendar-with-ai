import { CircleAlert } from "lucide-react";
import { openSmallAccount } from "./useSmallAccount";

export function SmallAuthNotice({ expired = false }: { expired?: boolean }) {
  return (
    <div className="small-auth-notice" role="status">
      <CircleAlert size={16} aria-hidden="true" />
      <div>
        <strong>
          {expired ? "Сессия Small завершена" : "Требуется вход в Small"}
        </strong>
        <p>
          {expired
            ? "Войдите повторно, чтобы продолжить работу с календарём."
            : "Войдите в Small с рабочей учётной записью, чтобы продолжить."}
        </p>
      </div>
      <button
        className="secondary"
        type="button"
        aria-label="Войти в Small — открыть форму"
        onClick={openSmallAccount}
      >
        Войти в Small
      </button>
    </div>
  );
}

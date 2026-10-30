/** Local marker on an explicit write rejection; keeps retry journals and UI auth state consistent. */
export function sessionRecoveryMessage(response: Response): string | undefined {
  const state = response.headers.get("X-Small-Session-Recovered");
  return state === "true"
    ? "Сессия Small восстановлена. Повторите действие."
    : state === "pending"
      ? "Не удалось восстановить сессию Small. Повторите действие позже."
      : undefined;
}

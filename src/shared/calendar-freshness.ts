const clock = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Almaty",
});

export interface CalendarFreshnessInput {
  fetchedAt: number | null;
  offline: boolean;
  refreshError: string;
}

/**
 * What the freshness panel says. While everything works there is nothing to say and the
 * panel stays out of the way; it appears only when the data on screen may be out of date.
 */
export function describeFreshness(
  input: CalendarFreshnessInput,
): string | null {
  if (input.fetchedAt === null) return null;
  const at = clock.format(input.fetchedAt);
  if (input.offline) return `Нет связи с Small. Данные на ${at}`;
  if (input.refreshError) return `Не удалось обновить. Данные на ${at}`;
  return null;
}

const clock = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Almaty",
});

export interface CalendarFreshnessInput {
  fetchedAt: number | null;
  now: number;
  offline: boolean;
  refreshError: string;
  refreshing: boolean;
}
export interface CalendarFreshnessLabel {
  text: string;
  tone: "fresh" | "warning";
}

function minutesWord(count: number) {
  const tens = count % 100;
  const units = count % 10;
  if (units === 1 && tens !== 11) return "минуту";
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return "минуты";
  return "минут";
}

/** What the freshness chip says; `null` when there is nothing confirmed to describe. */
export function describeFreshness(
  input: CalendarFreshnessInput,
): CalendarFreshnessLabel | null {
  if (input.fetchedAt === null) return null;
  const at = clock.format(input.fetchedAt);
  if (input.refreshing) return { text: "Обновляю…", tone: "fresh" };
  if (input.offline)
    return { text: `Нет связи с Small. Данные на ${at}`, tone: "warning" };
  if (input.refreshError)
    return { text: `Не удалось обновить. Данные на ${at}`, tone: "warning" };
  // A clock slightly behind gives a negative age, which counts as "just now".
  const minutes = Math.floor((input.now - input.fetchedAt) / 60_000);
  if (minutes < 1) return { text: "Обновлено только что", tone: "fresh" };
  if (minutes < 60)
    return {
      text: `Обновлено ${minutes} ${minutesWord(minutes)} назад`,
      tone: "fresh",
    };
  return { text: `Обновлено в ${at}`, tone: "fresh" };
}

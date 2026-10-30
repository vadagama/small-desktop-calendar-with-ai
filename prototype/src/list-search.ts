import { addDays, dateLabel, shiftMonth, weekStart } from "./calendar";
import { monthRange, type ListFilter } from "./event-list";
import type { Meeting } from "./types";
export interface PendingListSearch {
  organizer?: string;
  period?: Pick<ListFilter, "from" | "to">;
}
interface Reply {
  text: string;
  pending: PendingListSearch | null;
  filter?: ListFilter;
}
const validDate = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date;
};
export function resolveListSearch(
  text: string,
  pending: PendingListSearch | null,
  events: Meeting[],
  today: string,
): Reply | null {
  const lower = text.toLocaleLowerCase("ru");
  if (!pending && !/спис[ок]|организатор|событи.*жанн|встреч.*жанн/.test(lower))
    return null;
  if (/^отмен[аи]?$/i.test(text.trim()))
    return { text: "Поиск отменён. Представление не изменено.", pending: null };
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g);
  let period = pending?.period;
  if (dates?.length) {
    const [from, to = from] = dates;
    if (!validDate(from) || !validDate(to) || from > to)
      return {
        text: "Проверьте даты: начало должно быть не позже конца. Формат: 2026-10-01 — 2026-10-31.",
        pending: pending ?? {},
      };
    period = { from, to };
  } else if (/недел/.test(lower)) {
    const from = addDays(
      weekStart(today),
      /прошл/.test(lower) ? -7 : /следующ/.test(lower) ? 7 : 0,
    );
    period = { from, to: addDays(from, 6) };
  } else if (/месяц/.test(lower))
    period = monthRange(
      shiftMonth(
        today,
        /прошл/.test(lower) ? -1 : /следующ/.test(lower) ? 1 : 0,
      ),
    );
  else {
    const months = [
      "январ",
      "феврал",
      "март",
      "апрел",
      "ма[йя]",
      "июн",
      "июл",
      "август",
      "сентябр",
      "октябр",
      "ноябр",
      "декабр",
    ];
    const index = months.findIndex((m) => new RegExp(m).test(lower));
    if (index >= 0)
      period = monthRange(
        `${text.match(/\b20\d{2}\b/)?.[0] ?? today.slice(0, 4)}-${String(index + 1).padStart(2, "0")}-01`,
      );
  }
  const words = lower.match(/[а-яёa-z]+/gu) ?? [];
  const phrase = (name: string) =>
    ` ${words.join(" ")} `.includes(` ${name.toLocaleLowerCase("ru")} `);
  const organizers = [...new Set(events.map((e) => e.organizer))];
  const exact = organizers.filter((name) => phrase(name));
  const candidates = exact.length
    ? exact
    : organizers.filter((name) =>
        words.some(
          (word) =>
            word.replace(/[аыуюея]$/, "") ===
            name.split(" ")[0].toLocaleLowerCase("ru").replace(/[ая]$/, ""),
        ),
      );
  const organizer =
    candidates.length === 1 ? candidates[0] : pending?.organizer;
  if (candidates.length > 1)
    return {
      text: `Уточните организатора: ${candidates.join("; ")}. Напишите полное имя.`,
      pending: { period },
    };
  if (!organizer)
    return {
      text: `Кто организатор? В демо доступны: ${organizers.join(", ")}. Можно написать имя и период.`,
      pending: { period },
    };
  if (!period)
    return {
      text: `Ищу события, где организатор — ${organizer}. За какой период? Например, «за этот месяц» или «2026-10-01 — 2026-10-31».`,
      pending: { organizer },
    };
  return {
    text: `Открыт список: организатор — ${organizer}, ${dateLabel(period.from)} — ${dateLabel(period.to)}. Asia/Almaty. Учитываются выбранные календари. Это демонстрационные данные.`,
    pending: null,
    filter: { ...period, organizer },
  };
}

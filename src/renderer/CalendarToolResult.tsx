import { z } from "zod";
const resultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), error: z.string() }),
  z.object({
    ok: z.literal(true),
    data: z.union([
      z.object({
        people: z.array(
          z.object({
            participantId: z.string(),
            name: z.string(),
            position: z.string(),
          }),
        ),
        page: z.number(),
        nextPage: z.number().nullable(),
      }),
      z.object({
        slots: z.array(
          z.object({
            start: z.iso.datetime({ offset: true }),
            end: z.iso.datetime({ offset: true }),
          }),
        ),
        participantIds: z.array(z.string()),
        date: z.string(),
        durationMinutes: z.number(),
        timezone: z.literal("Asia/Almaty"),
      }),
    ]),
  }),
]);
const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export function CalendarToolResult({ output }: { output: unknown }) {
  const parsed = resultSchema.safeParse(output);
  if (!parsed.success) return <p>Результат недоступен.</p>;
  if (!parsed.data.ok) return <p>{parsed.data.error}</p>;
  const data = parsed.data.data;
  if ("people" in data)
    return (
      <>
        <p>
          Страница {data.page}.{" "}
          {data.nextPage
            ? `Следующая: ${data.nextPage}.`
            : "Последняя страница поиска."}
        </p>
        {!data.people.length && <p>Сотрудники не найдены.</p>}
        <ul>
          {data.people.map((person) => (
            <li key={person.participantId}>
              {person.name} · {person.position || "Должность не указана"} · ID:{" "}
              <code>{person.participantId}</code>
            </li>
          ))}
        </ul>
        <p>
          Для подбора отправьте ID выбранных людей, дату YYYY-MM-DD и
          длительность отдельным сообщением. Поиск не подтверждает полный состав
          команды.
        </p>
      </>
    );
  return (
    <>
      <p>
        {data.date} · {data.durationMinutes} мин · {data.timezone}
      </p>
      <p>Участники: {data.participantIds.join(", ")}</p>
      {data.slots.length ? (
        <ul>
          {data.slots.map((slot) => (
            <li key={slot.start}>
              {time(slot.start)}–{time(slot.end)}
            </li>
          ))}
        </ul>
      ) : (
        <p>Общих вариантов на выбранный день нет.</p>
      )}
      <p>Время не зарезервировано.</p>
    </>
  );
}

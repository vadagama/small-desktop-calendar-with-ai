import {
  TemplateMarkdown,
  useAssistantPresentation,
} from "./AssistantPresentation";
import { MeetingDeletionCard } from "./MeetingDeletionCard";
import { meetingDeletionSchema } from "../shared/calendar-tools.js";
import { meetingDraftSchema } from "../shared/meeting-draft.js";
import { MeetingDraftCard } from "./MeetingDraftCard";
import { z } from "zod";
const resultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), error: z.string() }),
  z.object({
    ok: z.literal(true),
    data: z.union([
      meetingDraftSchema,
      meetingDeletionSchema,
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
        people: z
          .array(
            z.object({
              participantId: z.string(),
              name: z.string(),
              position: z.string(),
            }),
          )
          .optional(),
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
  const { choose, disabled } = useAssistantPresentation();
  const parsed = resultSchema.safeParse(output);
  if (!parsed.success) return <p>Результат недоступен.</p>;
  if (!parsed.data.ok) return <p>{parsed.data.error}</p>;
  const data = parsed.data.data;
  if ("kind" in data)
    return data.kind === "meeting-delete" ? (
      <MeetingDeletionCard deletion={data} />
    ) : (
      <MeetingDraftCard draft={data} />
    );
  if ("page" in data)
    return (
      <>
        <p>
          Страница {data.page}.{" "}
          {data.nextPage
            ? `Следующая: ${data.nextPage}.`
            : "Последняя страница поиска."}
        </p>
        {!data.people.length && <p>Сотрудники не найдены.</p>}
        <div className="assistant-choices">
          {data.people.map((person) => (
            <button
              type="button"
              key={person.participantId}
              disabled={disabled}
              onClick={() =>
                choose(
                  `Выбираю участника: ${person.name}${person.position ? ` (${person.position})` : ""}.`,
                )
              }
            >
              <TemplateMarkdown
                name="people"
                values={{
                  name: person.name,
                  position: person.position || "Должность не указана",
                }}
              />
            </button>
          ))}
        </div>
        <p>Выберите человека или уточните имя сообщением.</p>
      </>
    );
  return (
    <>
      <TemplateMarkdown
        name="slots"
        values={{
          date: new Intl.DateTimeFormat("ru-RU", {
            dateStyle: "long",
            timeZone: "Asia/Almaty",
          }).format(new Date(`${data.date}T12:00:00+05:00`)),
          duration: String(data.durationMinutes),
          participants:
            data.people?.map((p) => p.name).join(", ") ?? "Выбранный состав",
        }}
      />
      {data.slots.length ? (
        <div className="assistant-choices">
          {data.slots.slice(0, 5).map((slot) => (
            <button
              type="button"
              key={slot.start}
              disabled={disabled}
              onClick={() =>
                choose(
                  `Выбираю ${data.date}, ${time(slot.start)}–${time(slot.end)}, Asia/Almaty. Подготовь черновик.`,
                )
              }
            >
              <strong>
                {new Intl.DateTimeFormat("ru-RU", {
                  day: "numeric",
                  month: "long",
                  timeZone: "Asia/Almaty",
                }).format(new Date(slot.start))}
              </strong>
              <span>
                {time(slot.start)}–{time(slot.end)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p>Общих вариантов в выбранном диапазоне нет.</p>
      )}
    </>
  );
}

import { BarChart3 } from "lucide-react";
import { z } from "zod";

const bucket = z.object({
  name: z.string(),
  count: z.number(),
  minutes: z.number(),
});
const group = z.object({ count: z.number(), minutes: z.number() });
const report = z.object({
  kind: z.literal("analytics"),
  from: z.string(),
  to: z.string(),
  timezone: z.literal("Asia/Almaty"),
  complete: z.boolean(),
  duplicates: z.number(),
  totals: z.object({
    count: z.number(),
    sumMinutes: z.number(),
    busyMinutes: z.number(),
    overlapMinutes: z.number(),
    regularCount: z.number(),
    regularMinutes: z.number(),
  }),
  groups: z.object({
    confirmed: group,
    unconfirmed: group,
    declined: group,
    "possible-all-day": group,
    invalid: group,
  }),
  byTopic: z.array(bucket),
  byOrganizer: z.array(bucket),
  topParticipants: z.array(bucket),
  unavailable: z.array(z.enum(["cancellations", "teams", "tags"])),
  rules: z.array(z.string()),
  events: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      group: z.enum([
        "confirmed",
        "unconfirmed",
        "declined",
        "possible-all-day",
        "invalid",
      ]),
      minutes: z.number(),
      topic: z.string(),
      rule: z.string().nullable(),
    }),
  ),
  issues: z.array(z.object({ message: z.string() })),
});
const schema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(false), error: z.string() }),
  z.object({ ok: z.literal(true), data: report }),
]);
const groupLabels = {
  confirmed: "Подтверждены",
  unconfirmed: "Нет подтверждённого ответа",
  declined: "Отклонены",
  "possible-all-day": "Возможно, весь день",
  invalid: "Некорректные данные",
} as const;
const unavailableLabels = {
  cancellations: "отмены",
  teams: "команды",
  tags: "теги и категории",
} as const;

/** Whole minutes as "2 ч 30 мин"; tenths of a minute are never shown. */
export const duration = (minutes: number) => {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
};
const day = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00+05:00`));
const when = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

function Buckets({
  title,
  rows,
}: {
  title: string;
  rows: z.infer<typeof bucket>[];
}) {
  if (!rows.length) return null;
  return (
    <details className="analytics-details">
      <summary>{title}</summary>
      <ul className="analytics-rows">
        {rows.map((row) => (
          <li key={row.name}>
            <span>{row.name}</span>
            <span>
              {row.count} · {duration(row.minutes)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AnalyticsCard({ output }: { output: unknown }) {
  const parsed = schema.safeParse(output);
  if (!parsed.success) return <p>Результат недоступен.</p>;
  if (!parsed.data.ok) return <p>{parsed.data.error}</p>;
  const r = parsed.data.data;
  const period =
    r.from === r.to ? day(r.from) : `${day(r.from)} — ${day(r.to)}`;
  const others = (
    ["unconfirmed", "declined", "possible-all-day", "invalid"] as const
  ).filter((name) => r.groups[name].count);
  return (
    <section className="analytics-card" aria-label="Аналитика встреч">
      <header>
        <BarChart3 size={16} aria-hidden="true" />
        <span>Аналитика встреч · {period} · Asia/Almaty</span>
      </header>
      {!r.complete && (
        <p className="analytics-partial" role="status">
          Данные частичные: итоги предварительные.
          {r.issues.map((issue) => ` ${issue.message}`)}
        </p>
      )}
      <dl className="analytics-metrics">
        <div>
          <dt>Встречи</dt>
          <dd>{r.totals.count}</dd>
        </div>
        <div>
          <dt>Сумма длительностей</dt>
          <dd>{duration(r.totals.sumMinutes)}</dd>
        </div>
        <div>
          <dt>Занятое время</dt>
          <dd>{duration(r.totals.busyMinutes)}</dd>
        </div>
        <div>
          <dt>Пересечения</dt>
          <dd>{duration(r.totals.overlapMinutes)}</dd>
        </div>
        <div>
          <dt>Регулярные</dt>
          <dd>
            {r.totals.regularCount} · {duration(r.totals.regularMinutes)}
          </dd>
        </div>
      </dl>
      {r.totals.count === 0 && r.complete && (
        <p>Подтверждённых встреч за период нет.</p>
      )}
      {others.length > 0 && (
        <ul className="analytics-groups">
          {others.map((name) => (
            <li key={name}>
              {groupLabels[name]}: {r.groups[name].count}
              {name === "possible-all-day" || name === "invalid"
                ? ""
                : ` · ${duration(r.groups[name].minutes)}`}
            </li>
          ))}
        </ul>
      )}
      <Buckets title="По темам" rows={r.byTopic} />
      <Buckets title="По организаторам" rows={r.byOrganizer} />
      <Buckets title="Частые участники" rows={r.topParticipants} />
      <details className="analytics-details">
        <summary>Состав отчёта ({r.events.length})</summary>
        <ul className="analytics-events">
          {r.events.map((event) => (
            <li key={event.key}>
              <strong>{event.title}</strong>
              <span>
                {when(event.startsAt)} · {groupLabels[event.group]}
                {event.group === "confirmed" &&
                  ` · ${duration(event.minutes)} · ${event.rule ?? event.topic}`}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <details className="analytics-details">
        <summary>Правила подсчёта</summary>
        <ul>
          {r.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </details>
      {r.unavailable.length > 0 && (
        <p className="analytics-unavailable">
          Недоступно по данным календаря:{" "}
          {r.unavailable.map((name) => unavailableLabels[name]).join(", ")}.
        </p>
      )}
    </section>
  );
}

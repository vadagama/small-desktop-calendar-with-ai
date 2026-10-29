/**
 * Contract probe for Team Small recurring events; see
 * docs/research/series-contract-probe.md. Without --execute it only prints the plan.
 * With --execute it writes synthetic "T13-PROBE-" events to an explicitly named test
 * calendar, touches nothing it did not create, and deletes everything afterwards.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

export const probePrefix = "T13-PROBE-";
export const writeLimit = 30;
const api = "/gate/team/api";

export interface ProbeArgs {
  execute: boolean;
  baseUrl?: string;
  allowHost?: string;
  calendarId?: string;
  confirm?: string;
  out?: string;
  only?: string[];
}
export interface ProbeEnv {
  SMALL_PROBE_COOKIE?: string | undefined;
  SMALL_PROBE_COOKIE_OTHER?: string | undefined;
}
type Json = Record<string, unknown>;
export type ProbeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export function parseArgs(argv: string[]): ProbeArgs {
  const args: ProbeArgs = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`Не указано значение для ${flag}`);
      return next;
    };
    if (flag === "--execute") args.execute = true;
    else if (flag === "--base-url") args.baseUrl = value();
    else if (flag === "--allow-host") args.allowHost = value();
    else if (flag === "--calendar-id") args.calendarId = value();
    else if (flag === "--confirm") args.confirm = value();
    else if (flag === "--out") args.out = value();
    else if (flag === "--only") args.only = value().split(",");
    else throw new Error(`Неизвестный параметр ${flag}`);
  }
  return args;
}

/** Every precondition for sending a single request; throws with the missing one. */
export function assertExecutable(args: ProbeArgs, env: ProbeEnv) {
  if (!args.execute) throw new Error("Запись выключена: нет --execute");
  if (!args.baseUrl || !args.allowHost || !args.calendarId || !args.confirm)
    throw new Error(
      "Нужны --base-url, --allow-host, --calendar-id и --confirm <хост>:<id календаря>",
    );
  const url = new URL(args.baseUrl);
  if (url.protocol !== "https:") throw new Error("Нужен https");
  if (url.host !== args.allowHost)
    throw new Error("--allow-host не совпадает с хостом --base-url");
  if (!/^[1-9]\d{0,9}$/.test(args.calendarId))
    throw new Error("--calendar-id должен быть числом");
  if (args.confirm !== `${args.allowHost}:${args.calendarId}`)
    throw new Error("--confirm должен быть равен <хост>:<id календаря>");
  if (!env.SMALL_PROBE_COOKIE)
    throw new Error("Нет SMALL_PROBE_COOKIE в окружении");
  return { origin: url.origin, calendarId: Number(args.calendarId) };
}

const idPattern = "[A-Za-z0-9_-]{1,128}";
const writeRoutes: [string, RegExp][] = [
  ["POST", new RegExp(`^${api}/calendar/events$`)],
  ["POST", new RegExp(`^${api}/calendar/events/from-template$`)],
  ["PUT", new RegExp(`^${api}/calendar/events/(${idPattern})\\?force=false$`)],
  ["POST", new RegExp(`^${api}/calendar/events/(${idPattern})/cancel$`)],
  ["DELETE", new RegExp(`^${api}/calendar/events/(${idPattern})$`)],
];

/** Rejects every write that is not about an event this run created itself. */
export class ProbeGuard {
  readonly owned = new Set<string>();
  readonly masters = new Set<string>();
  writes = 0;
  check(method: string, path: string, body?: Json) {
    if (method === "GET") return;
    const route = writeRoutes.find(
      ([m, pattern]) => m === method && pattern.test(path),
    );
    if (!route) throw new Error(`Запись запрещена: ${method} ${path}`);
    if (this.writes >= writeLimit)
      throw new Error("Превышен лимит записей за запуск");
    const target = route[1].exec(path)?.[1];
    if (path === `${api}/calendar/events`) {
      if (
        typeof body?.title !== "string" ||
        !body.title.startsWith(probePrefix) ||
        !Array.isArray(body.participant_ids) ||
        body.participant_ids.length
      )
        throw new Error("Создавать можно только T13-PROBE без участников");
    } else if (path.endsWith("/from-template")) {
      if (!this.masters.has(String(body?.original_event_id)))
        throw new Error("from-template только для серий этого запуска");
    } else if (!target || !this.owned.has(target))
      throw new Error("Запись только для событий этого запуска");
    this.writes++;
  }
}

export interface Experiment {
  id: string;
  title: string;
  assumptions: string[];
  steps: string[];
}
export const experiments: Experiment[] = [
  {
    id: "E1",
    title: "Создание серии и чтение",
    assumptions: ["A6", "A8"],
    steps: [
      "POST /calendar/events: WEEKLY, UNTIL = дата третьего вхождения",
      "GET /calendars/my/events за период серии",
    ],
  },
  {
    id: "E2",
    title: "Виртуальное вхождение",
    assumptions: ["A1"],
    steps: [
      "GET /calendar/events/generated?original_event_id&date",
      "GET /calendars/my/events: событие не создано",
    ],
  },
  {
    id: "E3",
    title: "Материализация",
    assumptions: ["A2"],
    steps: [
      "POST /calendar/events/from-template дважды для второго вхождения",
      "GET /calendars/my/events: число вхождений",
    ],
  },
  {
    id: "E4",
    title: "single и перенос",
    assumptions: ["A3", "A4", "A8"],
    steps: [
      "PUT /calendar/events/{id}?force=false, recurring_edit_type=single, сдвиг на час",
      "GET /calendars/my/events: остальные вхождения и исходная дата",
    ],
  },
  {
    id: "E5",
    title: "all-next",
    assumptions: ["A5"],
    steps: [
      "PUT с recurring_edit_type=all-next на третьем вхождении, сдвиг на час",
      "GET /calendars/my/events: первое и второе вхождения",
    ],
  },
  {
    id: "E6",
    title: "Отмена и удаление",
    assumptions: ["A7"],
    steps: [
      "POST /calendar/events/{id}/cancel для одного вхождения",
      "DELETE /calendar/events/{id} для другого",
      "GET /calendars/my/events: что осталось",
    ],
  },
  {
    id: "E7",
    title: "Заголовки конкурентной правки",
    assumptions: ["A10"],
    steps: ["GET /calendar/events/{id}: ETag, Last-Modified"],
  },
  {
    id: "E8",
    title: "Права (нужен SMALL_PROBE_COOKIE_OTHER)",
    assumptions: ["A9"],
    steps: ["PUT, cancel и DELETE от второй сессии на событие первой"],
  },
];

export function dryRunPlan(only?: string[]) {
  const lines = [
    "Режим плана: запросы не отправляются. Подробности — docs/research/series-contract-probe.md.",
  ];
  for (const e of experiments.filter((x) => !only || only.includes(x.id))) {
    lines.push(`${e.id}. ${e.title} (${e.assumptions.join(", ")})`);
    for (const step of e.steps) lines.push(`   - ${step}`);
  }
  lines.push(
    `Лимит записей: ${writeLimit}. Меняются и удаляются только события «${probePrefix}…», созданные этим запуском.`,
  );
  return lines.join("\n");
}

export interface ProbeResult {
  startedAt: string;
  hostHash: string;
  experiments: {
    id: string;
    requests: { method: string; path: string; status: number }[];
    observations: string[];
  }[];
  cleanup: { deleted: number; failed: number };
}

class Aliases {
  private map = new Map<string, string>();
  of(id: string) {
    if (!this.map.has(id)) this.map.set(id, `e${this.map.size + 1}`);
    return this.map.get(id)!;
  }
  redact(path: string) {
    return path
      .replace(
        /(original_event_id=|events\/(?!from-template|generated|busy|find))([A-Za-z0-9_-]+)/g,
        (_m, head: string, id: string) => `${head}{${this.of(id)}}`,
      )
      .replace(/date=\d{4}-\d{2}-\d{2}/, "date={d}");
  }
}

const events = (data: unknown): Json[] => {
  const list = (data as { data?: unknown })?.data;
  const items = Array.isArray(list)
    ? list
    : list && typeof list === "object"
      ? Object.values(list as Json)
      : [];
  return items.filter((e): e is Json => !!e && typeof e === "object");
};
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export async function runProbe(
  args: ProbeArgs,
  env: ProbeEnv,
  fetcher: ProbeFetch,
  now = new Date(),
): Promise<ProbeResult> {
  const { origin, calendarId } = assertExecutable(args, env);
  const guard = new ProbeGuard();
  const aliases = new Aliases();
  const result: ProbeResult = {
    startedAt: now.toISOString(),
    hostHash: createHash("sha256")
      .update(new URL(origin).host)
      .digest("hex")
      .slice(0, 12),
    experiments: [],
    cleanup: { deleted: 0, failed: 0 },
  };
  let current = {
    id: "",
    requests: [] as ProbeResult["experiments"][number]["requests"],
    observations: [] as string[],
  };
  const note = (line: string) => current.observations.push(line);
  const call = async (
    method: string,
    path: string,
    body?: Json,
    cookie = env.SMALL_PROBE_COOKIE!,
  ) => {
    guard.check(method, path, body);
    const response = await fetcher(origin + path, {
      method,
      headers: {
        Cookie: cookie,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    current.requests.push({
      method,
      path: aliases.redact(path),
      status: response.status,
    });
    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      note(`Ответ ${method} не JSON (код ${response.status})`);
    }
    return { status: response.status, data, headers: response.headers };
  };
  const body = (extra: Json, title: string): Json => ({
    title: probePrefix + title,
    description: "",
    location: "",
    timezone: "Asia/Almaty",
    is_public: false,
    calendar_ids: [calendarId],
    participant_ids: [],
    notification_recipient_ids: [],
    attachments: [],
    ...extra,
  });
  const day = (offset: number) => {
    const d = new Date(now.getTime() + offset * 86400000);
    return new Date(d.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  };
  const first = day(7);
  const stamp = (date: string, hour: number) =>
    `${date}T${String(hour).padStart(2, "0")}:00:00+05:00`;
  const dates = [0, 7, 14].map((n) =>
    new Date(Date.parse(first + "T12:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const weekday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][
    new Date(first + "T12:00:00Z").getUTCDay()
  ];
  const list = async () =>
    events(
      (
        await call(
          "GET",
          `${api}/calendars/my/events?start_date=${encodeURIComponent(stamp(first, 0))}&end_date=${encodeURIComponent(stamp(dates[2]!, 23))}`,
        )
      ).data,
    ).filter((e) => text(e.title).startsWith(probePrefix));
  const run = async (id: string, steps: () => Promise<void>) => {
    if (args.only && !args.only.includes(id)) return;
    current = { id, requests: [], observations: [] };
    try {
      await steps();
    } catch (error) {
      note(`Остановлено: ${(error as Error).message}`);
    }
    result.experiments.push(current);
  };
  let master = "";
  try {
    await run("E1", async () => {
      const created = await call(
        "POST",
        `${api}/calendar/events`,
        body(
          {
            starts_at: stamp(first, 10),
            ends_at: stamp(first, 11),
            is_recurring: true,
            recurrence_type: "custom",
            recurrence_rule: {
              FREQ: "WEEKLY",
              BYDAY: [weekday],
              UNTIL: dates[2],
            },
          },
          "series",
        ),
      );
      master = text((created.data as { data?: Json })?.data?.id);
      if (!master)
        throw new Error(`создание серии отклонено (код ${created.status})`);
      guard.owned.add(master);
      guard.masters.add(master);
      const found = await list();
      note(`Вхождений в чтении периода: ${found.length}`);
      note(
        `Вхождение в день UNTIL присутствует: ${found.some((e) => text(e.starts_at).startsWith(dates[2]!))}`,
      );
      for (const e of found)
        note(
          `Вхождение ${text(e.starts_at).slice(0, 10)}: id=${text(e.id) ? "есть" : "нет"}, original_event_id=${text(e.original_event_id) ? "есть" : "нет"}, is_recurring=${text(e.is_recurring)}, смещение=${text(e.starts_at).slice(-6)}`,
        );
    });
    await run("E2", async () => {
      if (!master) throw new Error("нет серии из E1");
      const before = (await list()).length;
      const virtual = await call(
        "GET",
        `${api}/calendar/events/generated?original_event_id=${master}&date=${dates[1]}`,
      );
      note(`generated: код ${virtual.status}`);
      note(`Событий до/после generated: ${before}/${(await list()).length}`);
    });
    let second = "";
    await run("E3", async () => {
      if (!master) throw new Error("нет серии из E1");
      const open = () =>
        call("POST", `${api}/calendar/events/from-template`, {
          original_event_id: master,
          date: dates[1],
        });
      const a = await open();
      const b = await open();
      const ids = [a, b].map((r) =>
        text((r.data as { data?: Json })?.data?.id),
      );
      note(`from-template: коды ${a.status}/${b.status}`);
      note(`Один и тот же id: ${!!ids[0] && ids[0] === ids[1]}`);
      for (const id of ids) if (id) guard.owned.add(id);
      second = ids[0] ?? "";
      note(`Вхождений после: ${(await list()).length}`);
    });
    await run("E4", async () => {
      if (!second) throw new Error("нет материализованного вхождения из E3");
      const moved = await call(
        "PUT",
        `${api}/calendar/events/${second}?force=false`,
        body(
          {
            starts_at: stamp(dates[1]!, 11),
            ends_at: stamp(dates[1]!, 12),
            is_recurring: true,
            recurrence_type: "custom",
            recurrence_rule: {
              FREQ: "WEEKLY",
              BYDAY: [weekday],
              UNTIL: dates[2],
            },
            recurring_edit_type: "single",
          },
          "series",
        ),
      );
      note(`PUT single: код ${moved.status}`);
      for (const e of await list())
        note(
          `После переноса: ${text(e.starts_at).slice(0, 16)}, id=${text(e.id) ? "есть" : "нет"}`,
        );
    });
    await run("E5", async () => {
      if (!master) throw new Error("нет серии из E1");
      const open = await call("POST", `${api}/calendar/events/from-template`, {
        original_event_id: master,
        date: dates[2],
      });
      const third = text((open.data as { data?: Json })?.data?.id);
      if (!third)
        throw new Error(`материализация отклонена (код ${open.status})`);
      guard.owned.add(third);
      const moved = await call(
        "PUT",
        `${api}/calendar/events/${third}?force=false`,
        body(
          {
            starts_at: stamp(dates[2]!, 11),
            ends_at: stamp(dates[2]!, 12),
            is_recurring: true,
            recurrence_type: "custom",
            recurrence_rule: {
              FREQ: "WEEKLY",
              BYDAY: [weekday],
              UNTIL: dates[2],
            },
            recurring_edit_type: "all-next",
          },
          "series",
        ),
      );
      note(`PUT all-next: код ${moved.status}`);
      for (const e of await list())
        note(`После all-next: ${text(e.starts_at).slice(0, 16)}`);
    });
    await run("E6", async () => {
      const own = [...guard.owned].filter((id) => id !== master);
      if (own.length < 1) throw new Error("нет материализованных вхождений");
      const cancelled = await call(
        "POST",
        `${api}/calendar/events/${own[0]}/cancel`,
        {
          reason: "T13 probe",
        },
      );
      note(`cancel: код ${cancelled.status}`);
      if (own[1]) {
        const removed = await call(
          "DELETE",
          `${api}/calendar/events/${own[1]}`,
        );
        note(`DELETE: код ${removed.status}`);
      }
      note(`Вхождений после: ${(await list()).length}`);
    });
    await run("E7", async () => {
      if (!second) throw new Error("нет события для чтения");
      const read = await call("GET", `${api}/calendar/events/${second}`);
      note(
        `ETag: ${read.headers.get("etag") ? "есть" : "нет"}, Last-Modified: ${read.headers.get("last-modified") ? "есть" : "нет"}`,
      );
    });
    await run("E8", async () => {
      if (!env.SMALL_PROBE_COOKIE_OTHER)
        throw new Error("нет SMALL_PROBE_COOKIE_OTHER");
      if (!second) throw new Error("нет события для проверки");
      const other = env.SMALL_PROBE_COOKIE_OTHER;
      const put = await call(
        "PUT",
        `${api}/calendar/events/${second}?force=false`,
        body(
          {
            starts_at: stamp(dates[1]!, 9),
            ends_at: stamp(dates[1]!, 10),
            is_recurring: false,
          },
          "other",
        ),
        other,
      );
      note(`PUT от другой сессии: код ${put.status}`);
    });
  } finally {
    current = { id: "cleanup", requests: [], observations: [] };
    for (const id of [...guard.owned].reverse()) {
      try {
        const removed = await call("DELETE", `${api}/calendar/events/${id}`);
        if (removed.status >= 200 && removed.status < 300)
          result.cleanup.deleted++;
        else if (removed.status === 404) result.cleanup.deleted++;
        else result.cleanup.failed++;
      } catch {
        result.cleanup.failed++;
      }
    }
  }
  result.experiments.push(current);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.execute) console.log(dryRunPlan(args.only));
  else {
    const result = await runProbe(args, process.env, (url, init) =>
      fetch(url, init),
    );
    const json = JSON.stringify(result, null, 2);
    if (args.out) await writeFile(args.out, json, { mode: 0o600 });
    console.log(json);
    if (result.cleanup.failed)
      console.error(
        `Очистка не завершена: удалите вручную события «${probePrefix}…» в тестовом календаре.`,
      );
  }
}

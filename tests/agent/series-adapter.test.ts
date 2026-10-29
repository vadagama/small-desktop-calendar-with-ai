import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SeriesMutationService,
  type BackendWrite,
  type SeriesBackend,
  type SeriesCard,
  type SeriesUpdateBody,
  type SeriesView,
} from "../../src/main/series-adapter.js";
import { EventMutationJournal } from "../../src/main/event-mutation-journal.js";
import { gateSeriesOperation } from "../../src/main/series-contract.js";
import type {
  ContractAssumption,
  OccurrenceInput,
  SeriesOperation,
  SeriesScope,
} from "../../src/shared/series-scope.js";

/**
 * ASSUMPTION MODEL, NOT VERIFIED SERVER BEHAVIOUR (docs/research/series-contract-probe.md):
 * materialization returns a stable event id (A2); `single` changes one occurrence (A3);
 * the occurrence key survives moves (A4); `all-next` changes the selected and later
 * occurrences and shifts times by the same delta, never touching earlier ones (A5);
 * cancel removes one occurrence (A7).
 */
const me = "me";
const all = Object.fromEntries(
  ["A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"].map((a) => [
    a as ContractAssumption,
    { verifiedOn: "2026-11-01" },
  ]),
);
const now = "2026-10-29T05:00:00Z";
const dates = ["2026-10-22", "2026-11-05", "2026-11-12", "2026-11-19"];
const at = (date: string, hour: number) => `${date}T0${hour}:00:00Z`;

type Plan =
  "reject:422" | "status:503" | "throw-before" | "throw-after" | "not-sent";
interface Item {
  date: string;
  eventId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  organizerId: string;
}
class FakeSeries implements SeriesBackend {
  items: Item[] = dates.map((date, i) => ({
    date,
    ...(i === 3 ? { eventId: "900" } : {}),
    title: "Планёрка",
    startsAt: at(date, 5),
    endsAt: at(date, 6),
    organizerId: me,
  }));
  calls: string[] = [];
  bodies: SeriesUpdateBody[] = [];
  plans = new Map<string, Plan>();
  incomplete = false;
  noCard = false;
  onMaterialize: () => Promise<void> = async () => {};
  private nextId = 1000;
  private by = (eventId: string) =>
    this.items.find((i) => i.eventId === eventId);
  private fire(method: string) {
    this.calls.push(method);
    const plan = this.plans.get(method);
    this.plans.delete(method);
    return plan;
  }
  async window(_a: string, _s: string, from: string, to: string) {
    const views: SeriesView[] = this.items
      .filter(
        (i) => i.startsAt.slice(0, 10) >= from && i.startsAt.slice(0, 10) <= to,
      )
      .map((i) => ({
        key: `series:43:${i.date}`,
        title: i.title,
        startsAt: i.startsAt,
        endsAt: i.endsAt,
        organizerId: i.organizerId,
        ...(i.eventId ? { eventId: i.eventId } : {}),
      }));
    return { views, complete: !this.incomplete };
  }
  async card(
    _a: string,
    ref: { originalDate: string },
  ): Promise<SeriesCard | null> {
    const item = this.items.find((i) => i.date === ref.originalDate);
    if (!item || this.noCard) return null;
    return {
      ...(item.eventId ? { eventId: item.eventId } : {}),
      organizerId: item.organizerId,
      title: item.title,
      description: "Повестка серии",
      location: "Переговорная",
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      timezone: "Asia/Almaty",
      isPublic: false,
      calendarIds: [7],
      participantIds: ["p1", "p2"],
      notificationRecipientIds: ["p3"],
      attachments: ["f1"],
      recurrenceRule: { FREQ: "WEEKLY", BYDAY: ["TH"], UNTIL: "2026-12-31" },
    };
  }
  private reply(plan: Plan | undefined): BackendWrite | "apply" {
    if (plan === "throw-before") throw new Error("network");
    if (plan === "not-sent") return { status: 0, notSent: true };
    if (plan === "reject:422") return { status: 422 };
    if (plan === "status:503") return { status: 503 };
    return "apply";
  }
  async materialize(_a: string, _s: string, date: string) {
    const plan = this.fire("materialize");
    await this.onMaterialize();
    const early = this.reply(plan);
    if (early !== "apply") return early;
    const item = this.items.find((i) => i.date === date)!;
    item.eventId ??= String(this.nextId++);
    if (plan === "throw-after") throw new Error("network");
    return { status: 200, eventId: item.eventId };
  }
  async update(_a: string, eventId: string, body: SeriesUpdateBody) {
    const plan = this.fire("update");
    this.bodies.push(body);
    const early = this.reply(plan);
    if (early !== "apply") return early;
    const item = this.by(eventId)!;
    const dStart = Date.parse(body.starts_at) - Date.parse(item.startsAt);
    const dEnd = Date.parse(body.ends_at) - Date.parse(item.endsAt);
    const targets =
      body.recurring_edit_type === "all-next"
        ? this.items.filter((i) => i.date >= item.date)
        : [item];
    for (const t of targets) {
      t.title = body.title;
      t.startsAt = new Date(Date.parse(t.startsAt) + dStart).toISOString();
      t.endsAt = new Date(Date.parse(t.endsAt) + dEnd).toISOString();
    }
    if (plan === "throw-after") throw new Error("network");
    return { status: 200 };
  }
  async cancel(_a: string, eventId: string) {
    const plan = this.fire("cancel");
    const early = this.reply(plan);
    if (early !== "apply") return early;
    this.items = this.items.filter((i) => i.eventId !== eventId);
    if (plan === "throw-after") throw new Error("network");
    return { status: 200 };
  }
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "series-adapter-"));
  const backend = new FakeSeries();
  const journal = new EventMutationJournal(dir);
  const service = () => new SeriesMutationService(backend, journal);
  const main = service();
  const approve = (
    operation: SeriesOperation,
    scope: SeriesScope,
    date: string,
    more: { newStartsAt?: string; newEndsAt?: string } = {},
  ) => {
    const item = backend.items.find((i) => i.date === date)!;
    const occurrence: OccurrenceInput = {
      seriesId: "43",
      originalDate: date,
      ...(item.eventId ? { eventId: item.eventId } : {}),
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    };
    const gate = gateSeriesOperation(
      { operation, scope, occurrence, now, ...more },
      all,
    );
    assert.ok(gate.open);
    return gate.approval;
  };
  const run = (
    approval: ReturnType<typeof approve>,
    change: unknown,
    svc = main,
  ) => svc.apply({ accountId: "acc", participantId: me, approval, change });
  const files = () => readdir(dir);
  const cleanup = () => rm(dir, { recursive: true, force: true });
  return { dir, backend, journal, service, approve, run, files, cleanup };
}
const rename = (title: string) => ({ kind: "rename", title });
const ms = (value: string) => Date.parse(value);
const titles = (b: FakeSeries) => b.items.map((i) => [i.date, i.title]);
const moveTo = {
  newStartsAt: at("2026-11-12", 7),
  newEndsAt: at("2026-11-12", 8),
};

test("renaming one occurrence with its own event sends `single` with the full card and changes only it", async () => {
  const t = await setup();
  try {
    const result = await t.run(
      t.approve("rename", "occurrence", "2026-11-19"),
      rename("Новая"),
    );
    assert.deepEqual(
      { status: result.status, materialized: result.materialized },
      { status: "applied", materialized: false },
    );
    assert.deepEqual(t.backend.calls, ["update"]);
    const body = t.backend.bodies[0]!;
    assert.equal(body.recurring_edit_type, "single");
    assert.equal(body.title, "Новая");
    assert.deepEqual(
      [body.description, body.location, body.timezone, body.is_public],
      ["Повестка серии", "Переговорная", "Asia/Almaty", false],
    );
    assert.deepEqual(body.participant_ids, ["p1", "p2"]);
    assert.deepEqual(body.notification_recipient_ids, ["p3"]);
    assert.deepEqual(body.attachments, ["f1"]);
    assert.deepEqual(body.calendar_ids, [7]);
    assert.deepEqual(titles(t.backend), [
      ["2026-10-22", "Планёрка"],
      ["2026-11-05", "Планёрка"],
      ["2026-11-12", "Планёрка"],
      ["2026-11-19", "Новая"],
    ]);
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("a virtual occurrence is materialized after the journal claim and then written once", async () => {
  const t = await setup();
  try {
    let claimedBeforeMaterialization = false;
    t.backend.onMaterialize = async () => {
      claimedBeforeMaterialization = (await t.files()).length === 1;
    };
    const result = await t.run(
      t.approve("rename", "occurrence", "2026-11-12"),
      rename("Новая"),
    );
    assert.equal(result.materialized, true);
    assert.equal(claimedBeforeMaterialization, true);
    assert.deepEqual(t.backend.calls, ["materialize", "update"]);
    assert.equal(t.backend.items[2]!.title, "Новая");
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("moving one occurrence uses the approved interval and leaves the others", async () => {
  const t = await setup();
  try {
    await t.run(t.approve("move", "occurrence", "2026-11-12", moveTo), {
      kind: "move",
    });
    assert.equal(ms(t.backend.bodies[0]!.starts_at), ms(moveTo.newStartsAt));
    assert.equal(ms(t.backend.items[2]!.startsAt), ms(moveTo.newStartsAt));
    assert.equal(ms(t.backend.items[1]!.startsAt), ms(at("2026-11-05", 5)));
    assert.equal(ms(t.backend.items[3]!.startsAt), ms(at("2026-11-19", 5)));
  } finally {
    await t.cleanup();
  }
});

test("`following` sends all-next, reaches later occurrences and verifies earlier ones are untouched", async () => {
  const t = await setup();
  try {
    await t.run(
      t.approve("rename", "following", "2026-11-12"),
      rename("С этой даты"),
    );
    assert.equal(t.backend.bodies[0]!.recurring_edit_type, "all-next");
    assert.deepEqual(titles(t.backend), [
      ["2026-10-22", "Планёрка"],
      ["2026-11-05", "Планёрка"],
      ["2026-11-12", "С этой даты"],
      ["2026-11-19", "С этой даты"],
    ]);
    const shifted = await setup();
    try {
      await shifted.run(
        shifted.approve("move", "following", "2026-11-12", moveTo),
        { kind: "move" },
      );
      assert.equal(
        ms(shifted.backend.items[2]!.startsAt),
        ms(at("2026-11-12", 7)),
      );
      assert.equal(
        ms(shifted.backend.items[3]!.startsAt),
        ms(at("2026-11-19", 7)),
      );
      assert.equal(
        ms(shifted.backend.items[1]!.startsAt),
        ms(at("2026-11-05", 5)),
      );
    } finally {
      await shifted.cleanup();
    }
  } finally {
    await t.cleanup();
  }
});

test("a following change that also alters a past occurrence is not accepted as success", async () => {
  const t = await setup();
  try {
    const original = t.backend.update.bind(t.backend);
    t.backend.update = async (a, id, body) => {
      const result = await original(a, id, body);
      t.backend.items[1]!.title = "Испорчено";
      return result;
    };
    await assert.rejects(
      t.run(t.approve("rename", "following", "2026-11-12"), rename("Новая")),
      /Результат изменения серии неизвестен/,
    );
    assert.equal((await t.files()).length, 1);
  } finally {
    await t.cleanup();
  }
});

test("cancelling one occurrence removes only it and needs an acknowledged response", async () => {
  const t = await setup();
  try {
    const result = await t.run(
      t.approve("delete", "occurrence", "2026-11-19"),
      { kind: "delete" },
    );
    assert.equal(result.status, "applied");
    assert.deepEqual(
      t.backend.items.map((i) => i.date),
      ["2026-10-22", "2026-11-05", "2026-11-12"],
    );
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("a lost cancel response is not proof even when the occurrence is gone", async () => {
  const t = await setup();
  try {
    t.backend.plans.set("cancel", "throw-after");
    await assert.rejects(
      t.run(t.approve("delete", "occurrence", "2026-11-19"), {
        kind: "delete",
      }),
      /неизвестен/,
    );
    assert.equal((await t.files()).length, 1);
    const before = t.backend.calls.length;
    await assert.rejects(
      t.run(t.approve("delete", "occurrence", "2026-11-12"), {
        kind: "delete",
      }),
      /неизвестен/,
    );
    assert.equal(t.backend.calls.length, before);
  } finally {
    await t.cleanup();
  }
});

test("only approvals issued by the gate and matching the change are accepted", async () => {
  const t = await setup();
  try {
    const approval = t.approve("rename", "occurrence", "2026-11-19");
    for (const forged of [{ ...approval }, null, "yes", undefined]) {
      await assert.rejects(
        t.service().apply({
          accountId: "acc",
          participantId: me,
          approval: forged,
          change: rename("Новая"),
        }),
        /не одобрена/,
      );
    }
    await assert.rejects(t.run(approval, { kind: "delete" }), /не одобрена/);
    await assert.rejects(t.run(approval, { kind: "rename", title: " " }));
    await assert.rejects(
      t.run(approval, { kind: "rename", title: "x", extra: 1 }),
    );
    assert.deepEqual(t.backend.calls, []);
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("stale, foreign, incomplete or missing data stops before any write and journal entry", async () => {
  const stale = await setup();
  try {
    const approval = stale.approve("rename", "occurrence", "2026-11-19");
    stale.backend.items[3]!.startsAt = at("2026-11-19", 9);
    stale.backend.items[3]!.endsAt = at("2026-11-19", 10);
    await assert.rejects(stale.run(approval, rename("Н")), /изменилась/);
    assert.deepEqual(stale.backend.calls, []);
    assert.deepEqual(await stale.files(), []);
  } finally {
    await stale.cleanup();
  }
  const foreign = await setup();
  try {
    foreign.backend.items[3]!.organizerId = "someone-else";
    await assert.rejects(
      foreign.run(
        foreign.approve("rename", "occurrence", "2026-11-19"),
        rename("Н"),
      ),
      /только организатор/,
    );
    assert.deepEqual(foreign.backend.calls, []);
  } finally {
    await foreign.cleanup();
  }
  const incomplete = await setup();
  try {
    const approval = incomplete.approve("rename", "occurrence", "2026-11-19");
    incomplete.backend.incomplete = true;
    await assert.rejects(
      incomplete.run(approval, rename("Н")),
      /Неполные данные/,
    );
    incomplete.backend.incomplete = false;
    incomplete.backend.noCard = true;
    await assert.rejects(
      incomplete.run(approval, rename("Н")),
      /полную карточку/,
    );
    assert.deepEqual(incomplete.backend.calls, []);
    assert.deepEqual(await incomplete.files(), []);
  } finally {
    await incomplete.cleanup();
  }
});

test("an explicit rejection clears the journal, is reported and is not retried", async () => {
  const t = await setup();
  try {
    t.backend.plans.set("update", "reject:422");
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-19"), rename("Н")),
      /Small отклонил/,
    );
    assert.deepEqual(t.backend.calls, ["update"]);
    assert.deepEqual(await t.files(), []);
    assert.equal(t.backend.items[3]!.title, "Планёрка");
  } finally {
    await t.cleanup();
  }
});

test("a lost response whose write did happen is verified by reading and needs no resend", async () => {
  const t = await setup();
  try {
    t.backend.plans.set("update", "throw-after");
    const result = await t.run(
      t.approve("rename", "occurrence", "2026-11-19"),
      rename("Новая"),
    );
    assert.equal(result.status, "applied");
    assert.deepEqual(t.backend.calls, ["update"]);
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("an unknown outcome blocks the series; the next attempt only reads, and a late write is recognised after a restart", async () => {
  const t = await setup();
  try {
    t.backend.plans.set("update", "throw-before");
    const approval = t.approve("rename", "occurrence", "2026-11-19");
    await assert.rejects(t.run(approval, rename("Новая")), /неизвестен/);
    assert.equal((await t.files()).length, 1);
    // Same request again: still unproven, nothing is sent.
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-19"), rename("Новая")),
      /неизвестен/,
    );
    // A different action cannot bypass the block either.
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-05"), rename("Другая")),
      /неизвестен/,
    );
    assert.deepEqual(t.backend.calls, ["update"]);
    // The first write turns out to have landed; a new service (restart) reconciles it.
    t.backend.items[3]!.title = "Новая";
    const again = await t.run(
      t.approve("rename", "occurrence", "2026-11-19"),
      rename("Новая"),
      t.service(),
    );
    assert.equal(again.status, "already-applied");
    assert.deepEqual(t.backend.calls, ["update"]);
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("a confirmed earlier change asks for a refreshed, separate new action", async () => {
  const t = await setup();
  try {
    t.backend.plans.set("update", "throw-before");
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-19"), rename("Новая")),
      /неизвестен/,
    );
    t.backend.items[3]!.title = "Новая";
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-05"), rename("Другая")),
      /Предыдущее изменение серии подтверждено/,
    );
    assert.deepEqual(await t.files(), []);
    assert.equal(t.backend.items[1]!.title, "Планёрка");
  } finally {
    await t.cleanup();
  }
});

test("an unknown materialization outcome blocks the series and never sends the write", async () => {
  const t = await setup();
  try {
    t.backend.plans.set("materialize", "throw-after");
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-12"), rename("Н")),
      /неизвестен/,
    );
    assert.deepEqual(t.backend.calls, ["materialize"]);
    assert.equal((await t.files()).length, 1);
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-12"), rename("Н")),
      /неизвестен/,
    );
    assert.deepEqual(t.backend.calls, ["materialize"]);
  } finally {
    await t.cleanup();
  }
  const rejected = await setup();
  try {
    rejected.backend.plans.set("materialize", "reject:422");
    await assert.rejects(
      rejected.run(
        rejected.approve("rename", "occurrence", "2026-11-12"),
        rename("Н"),
      ),
      /Small отклонил/,
    );
    assert.deepEqual(rejected.backend.calls, ["materialize"]);
    assert.deepEqual(await rejected.files(), []);
  } finally {
    await rejected.cleanup();
  }
});

test("concurrent actions on one series are rejected while other series stay independent", async () => {
  const t = await setup();
  try {
    let release: () => void = () => {};
    t.backend.onMaterialize = () => new Promise<void>((r) => (release = r));
    const first = t.run(
      t.approve("rename", "occurrence", "2026-11-12"),
      rename("Н"),
    );
    await new Promise((r) => setTimeout(r, 20));
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-05"), rename("Д")),
      /уже сохраняется/,
    );
    release();
    await first;
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("the journal stores hashes, dates and state only, never meeting contents", async () => {
  const t = await setup();
  try {
    t.backend.plans.set("update", "throw-before");
    await assert.rejects(
      t.run(
        t.approve("rename", "occurrence", "2026-11-19"),
        rename("СекретноеИмя"),
      ),
    );
    const [file] = await t.files();
    const text = await readFile(join(t.dir, file!), "utf8");
    const record = JSON.parse(text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(record).sort(), [
      "acknowledged",
      "kind",
      "requestHash",
      "resultHash",
      "windowFrom",
      "windowTo",
    ]);
    assert.equal(record.kind, "series-update");
    for (const secret of ["СекретноеИмя", "Планёрка", "Повестка", "p1", "me"])
      assert.ok(!text.includes(secret), secret);
  } finally {
    await t.cleanup();
  }
});

test("a server error response is verified by reading: applied is accepted, not applied stays blocked", async () => {
  const applied = await setup();
  try {
    const original = applied.backend.update.bind(applied.backend);
    applied.backend.update = async (a, id, body) => {
      await original(a, id, body);
      return { status: 503 };
    };
    const result = await applied.run(
      applied.approve("rename", "occurrence", "2026-11-19"),
      rename("Новая"),
    );
    assert.equal(result.status, "applied");
    assert.deepEqual(await applied.files(), []);
  } finally {
    await applied.cleanup();
  }
  const lost = await setup();
  try {
    lost.backend.plans.set("update", "status:503");
    await assert.rejects(
      lost.run(lost.approve("rename", "occurrence", "2026-11-19"), rename("Н")),
      /неизвестен/,
    );
    assert.equal((await lost.files()).length, 1);
    await assert.rejects(
      lost.run(lost.approve("rename", "occurrence", "2026-11-19"), rename("Н")),
      /неизвестен/,
    );
    assert.deepEqual(lost.backend.calls, ["update"]);
  } finally {
    await lost.cleanup();
  }
});

test("an incomplete card never turns into empty fields: nothing is written", async () => {
  const t = await setup();
  try {
    const original = t.backend.card.bind(t.backend);
    t.backend.card = async (a, ref) => {
      const card = await original(a, ref);
      return card && { ...card, timezone: "" };
    };
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-19"), rename("Н")),
      /полную карточку/,
    );
    t.backend.card = async (a, ref) => {
      const card = await original(a, ref);
      return card && { ...card, recurrenceRule: undefined as never };
    };
    await assert.rejects(
      t.run(t.approve("rename", "occurrence", "2026-11-19"), rename("Н")),
      /полную карточку/,
    );
    assert.deepEqual(t.backend.calls, []);
    assert.deepEqual(await t.files(), []);
  } finally {
    await t.cleanup();
  }
});

test("a change of only the start or only the end since selection is also stale", async () => {
  for (const field of ["startsAt", "endsAt"] as const) {
    const t = await setup();
    try {
      const approval = t.approve("rename", "occurrence", "2026-11-19");
      t.backend.items[3]![field] =
        field === "startsAt" ? at("2026-11-19", 4) : at("2026-11-19", 7);
      await assert.rejects(t.run(approval, rename("Н")), /изменилась/);
      assert.deepEqual(t.backend.calls, []);
      assert.deepEqual(await t.files(), []);
    } finally {
      await t.cleanup();
    }
  }
});

test("a request that was never sent frees the series at once and allows a retry", async () => {
  for (const [method, date] of [
    ["update", "2026-11-19"],
    ["materialize", "2026-11-12"],
  ] as const) {
    const t = await setup();
    try {
      t.backend.plans.set(method, "not-sent");
      await assert.rejects(
        t.run(t.approve("rename", "occurrence", date), rename("Н")),
        /запрос не отправлен/,
      );
      assert.deepEqual(await t.files(), []);
      assert.equal(
        t.backend.items.find((i) => i.date === date)!.title,
        "Планёрка",
      );
      const before = t.backend.calls.length;
      const result = await t.run(
        t.approve("rename", "occurrence", date),
        rename("Н"),
      );
      assert.equal(result.status, "applied");
      assert.ok(t.backend.calls.length > before);
    } finally {
      await t.cleanup();
    }
  }
});

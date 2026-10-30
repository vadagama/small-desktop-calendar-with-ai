import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SeriesDeletionService } from "../../src/main/series-deletion.js";
import { EventMutationJournal } from "../../src/main/event-mutation-journal.js";
import type { SeriesRequest } from "../../src/shared/series-scope.js";
import type { SeriesView } from "../../src/main/series-adapter.js";

const request: SeriesRequest = {
  accountId: "acc",
  operation: "delete",
  scope: "following",
  seriesId: "s",
  originalDate: "2099-11-02",
  beforeStart: "2099-11-02T05:00:00Z",
  beforeEnd: "2099-11-02T06:00:00Z",
};
async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "series-delete-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let views: SeriesView[] = ["2099-10-26", "2099-11-02", "2099-11-09"].map(
    (day) => ({
      key: `series:s:${day}`,
      title: "Synthetic series",
      startsAt: `${day}T05:00:00Z`,
      endsAt: `${day}T06:00:00Z`,
      organizerId: "me",
    }),
  );
  const writes: string[] = [];
  let fail = false;
  let organizer = true;
  const backend = {
    window: async () => ({ views: structuredClone(views), complete: true }),
    materialize: async () => {
      writes.push("materialize");
      if (fail) throw new Error("offline");
      return { status: 201, eventId: "instance" };
    },
    cancel: async () => {
      writes.push("cancel");
      views = views.filter((v) => !v.key.endsWith("2099-11-02"));
      return { status: 200 };
    },
  };
  const service = new SeriesDeletionService(
    backend,
    {
      detail: async (input: unknown) => ({
        key: "series:s",
        lookup:
          "id" in (input as { lookup: object }).lookup
            ? (input as { lookup: { id: string } }).lookup
            : { originalEventId: "s", date: request.originalDate },
        originalEventId: "s",
        recurring: true,
        participation: organizer
          ? ("organizer" as const)
          : ("invited" as const),
        title: "Synthetic series",
        startsAt: request.beforeStart,
        endsAt: request.beforeEnd,
        calendarIds: [],
        organizer: "Synthetic",
        description: "",
        location: "",
      }),
    },
    async () => {
      writes.push("delete");
      views = views.filter((v) => v.key.endsWith("2099-10-26"));
      return new Response(null, { status: 204 });
    },
    new EventMutationJournal(dir),
  );
  return {
    service,
    dir,
    writes,
    backend,
    fail: () => {
      fail = true;
    },
    deny: () => {
      organizer = false;
    },
  };
}

test("series deletion previews without writes then removes selected and following, preserving prior occurrences", async (t) => {
  const f = await setup(t);
  assert.equal((await f.service.preview(request)).open, true);
  assert.deepEqual(f.writes, []);
  assert.equal((await f.service.apply(request)).status, "applied");
  assert.deepEqual(f.writes, ["materialize", "delete"]);
  assert.equal((await f.backend.window()).views.length, 1);
  assert.equal((await f.service.apply(request)).status, "already-applied");
  assert.deepEqual(f.writes, ["materialize", "delete"]);
});
test("occurrence deletion cancels only the selected instance", async (t) => {
  const f = await setup(t);
  await f.service.apply({ ...request, scope: "occurrence" });
  assert.deepEqual(f.writes, ["materialize", "cancel"]);
  assert.equal((await f.backend.window()).views.length, 2);
});
test("unknown materialization is never repeated, including a second click", async (t) => {
  const f = await setup(t);
  f.fail();
  await assert.rejects(f.service.apply(request), { unknownOutcome: true });
  await assert.rejects(f.service.apply(request), { unknownOutcome: true });
  assert.deepEqual(f.writes, ["materialize"]);
});
test("non-organizers cannot prepare or apply deletion", async (t) => {
  const f = await setup(t);
  f.deny();
  await assert.rejects(f.service.preview(request), { kind: "denied" });
  await assert.rejects(f.service.apply(request), { kind: "denied" });
  assert.deepEqual(f.writes, []);
});

test("series deletion transport only permits exact materialize/cancel shapes", async () => {
  const { isSeriesDeletionRequest } =
    await import("../../src/main/series-delete-request.js");
  assert.equal(
    isSeriesDeletionRequest("/gate/team/api/calendar/events/from-template", {
      original_event_id: "s",
      date: "2099-11-02",
    }),
    true,
  );
  assert.equal(
    isSeriesDeletionRequest("/gate/team/api/calendar/events/id/cancel", {
      reason: "User cancelled",
    }),
    true,
  );
  assert.equal(
    isSeriesDeletionRequest("/gate/team/api/calendar/events/from-template", {
      original_event_id: "s",
      date: "2099-02-30",
    }),
    false,
  );
  assert.equal(
    isSeriesDeletionRequest("/gate/team/api/calendar/events/id/cancel", {
      reason: "x",
      scope: "all",
    }),
    false,
  );
  assert.equal(
    isSeriesDeletionRequest(
      "/gate/team/api/calendar/events/id/cancel?force=true",
      { reason: "x" },
    ),
    false,
  );
});

test("unknown deletion remains blocked after a new service instance is created", async (t) => {
  const f = await setup(t);
  f.fail();
  await assert.rejects(f.service.apply(request), { unknownOutcome: true });
  const restarted = new SeriesDeletionService(
    f.backend,
    {
      detail: async () => {
        throw new Error("Should not prepare another write");
      },
    },
    async () => {
      throw new Error("Should not write");
    },
    new EventMutationJournal(f.dir),
  );
  await assert.rejects(restarted.apply(request), { unknownOutcome: true });
  await assert.rejects(restarted.apply({ ...request, scope: "occurrence" }), {
    unknownOutcome: true,
  });
  assert.deepEqual(f.writes, ["materialize"]);
});
test("incomplete calendar and a stale confirmation refuse deletion before any write", async (t) => {
  const f = await setup(t);
  await assert.rejects(
    f.service.apply({ ...request, beforeEnd: "2099-11-02T07:00:00Z" }),
    { kind: "invalid" },
  );
  f.backend.window = async () => ({ views: [], complete: false });
  await assert.rejects(f.service.apply(request), { kind: "invalid" });
  assert.deepEqual(f.writes, []);
});
test("a server refusal permits an explicit retry without duplicating a successful operation", async (t) => {
  const f = await setup(t);
  f.backend.materialize = async () => {
    f.writes.push("refused");
    return { status: 403, eventId: "" };
  };
  await assert.rejects(f.service.apply(request), { kind: "denied" });
  await assert.rejects(f.service.apply(request), { kind: "denied" });
  assert.deepEqual(f.writes, ["refused", "refused"]);
});

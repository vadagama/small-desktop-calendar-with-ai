import { describe, expect, it } from "vitest";
import { groupListEvents } from "./event-list";
import { resolveListSearch } from "./list-search";
import { DEMO_EVENTS } from "./data";
const base = DEMO_EVENTS[0];
describe("event list", () => {
  it("filters organizer rather than participants, includes bounds and sorts", () => {
    const events = [
      {
        ...base,
        id: "late",
        date: "2026-10-31",
        organizer: "Жанна",
        start: 700,
      },
      {
        ...base,
        id: "participant",
        date: "2026-10-01",
        organizer: "Анна",
        people: ["Жанна"],
      },
      {
        ...base,
        id: "early",
        date: "2026-10-01",
        organizer: "Жанна",
        start: 500,
      },
      { ...base, id: "outside", date: "2026-11-01", organizer: "Жанна" },
    ];
    expect(
      groupListEvents(events, {
        from: "2026-10-01",
        to: "2026-10-31",
        organizer: "Жанна",
      }).flatMap((g) => g.events.map((e) => e.id)),
    ).toEqual(["early", "late"]);
  });
  it("asks for period, keeps organizer across clarification and permits cancellation", () => {
    const events = [
      { ...base, organizer: "Жанна" },
      { ...base, organizer: "Анна" },
    ];
    const first = resolveListSearch(
      "Найди события где организатор Жанна",
      null,
      events,
      "2026-10-31",
    );
    expect(first?.pending?.organizer).toBe("Жанна");
    expect(first?.filter).toBeUndefined();
    const next = resolveListSearch(
      "за октябрь 2026",
      first!.pending!,
      events,
      "2026-10-31",
    );
    expect(next?.filter).toEqual({
      organizer: "Жанна",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(
      resolveListSearch("отмена", first!.pending!, events, "2026-10-31")
        ?.pending,
    ).toBeNull();
  });
  it("rejects invalid date ranges and asks about ambiguous names", () => {
    const events = [
      { ...base, organizer: "Жанна А" },
      { ...base, organizer: "Жанна Б" },
    ];
    expect(
      resolveListSearch("Найди события Жанны", null, events, "2026-10-31")
        ?.filter,
    ).toBeUndefined();
    expect(
      resolveListSearch(
        "2026-02-30 — 2026-03-02",
        { organizer: "Жанна" },
        events,
        "2026-10-31",
      )?.filter,
    ).toBeUndefined();
  });
});

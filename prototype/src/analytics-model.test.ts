import { describe, expect, it } from "vitest";
import { analyze, periodFor, refreshDue } from "./analytics-model";
import type { Meeting } from "./types";

const meeting = (
  id: string,
  start: number,
  duration: number,
  extra: Partial<Meeting> = {},
): Meeting => ({
  id,
  start,
  duration,
  date: "2026-10-28",
  organizer: "Анна",
  title: "Встреча",
  calendar: "team",
  color: "blue",
  people: ["Алексей", "Анна"],
  location: "Онлайн",
  agenda: "",
  participation: "invited",
  accepted: true,
  ...extra,
});
const query = {
  from: "2026-10-26",
  to: "2026-11-01",
  scope: "mine" as const,
  calendars: ["personal", "team", "room"] as Meeting["calendar"][],
  workStart: 540,
  workEnd: 1080,
};

describe("dashboard calculations", () => {
  it("deduplicates and merges overlapping intervals without counting unconfirmed invitations", () => {
    const first = meeting("one", 600, 60);
    const result = analyze(
      [
        first,
        first,
        meeting("two", 630, 60),
        meeting("three", 800, 30, { accepted: false }),
      ],
      query,
    );
    expect(result.count).toBe(2);
    expect(result.minutes).toBe(120);
    expect(result.busy).toBe(90);
    expect(result.overlap).toBe(30);
    expect(result.unconfirmed).toBe(1);
  });
  it("separates calendar overview from personal participation and applies calendar filters", () => {
    const events = [
      meeting("a", 600, 60, { accepted: false }),
      meeting("b", 700, 30, { calendar: "room" }),
    ];
    expect(
      analyze(events, { ...query, scope: "calendars", calendars: ["team"] })
        .count,
    ).toBe(1);
    expect(analyze(events, { ...query, calendars: [] }).count).toBe(0);
  });
  it("clips overnight meetings to the reporting period and working hours", () => {
    const result = analyze(
      [meeting("overnight", 1380, 120, { date: "2026-10-25" })],
      { ...query, to: "2026-10-26" },
    );
    expect(result.minutes).toBe(60);
    expect(result.busy).toBe(60);
    expect(result.workBusy).toBe(0);
    expect(result.days[0].minutes).toBe(60);
  });
  it("counts explicit recurring meetings and finds long windows within working days", () => {
    const result = analyze([meeting("one", 600, 60, { recurring: true })], {
      ...query,
      from: "2026-10-28",
      to: "2026-10-28",
    });
    expect(result.regularMinutes).toBe(60);
    expect(result.windows.map((w) => w.duration)).toEqual([60, 420]);
    expect(result.capacity).toBe(540);
  });
  it("keeps reserved focus and unconfirmed events out of free windows without inflating meeting metrics", () => {
    const result = analyze(
      [
        meeting("meeting", 600, 60),
        meeting("focus", 690, 90, {
          kind: "focus",
          participation: "organizer",
        }),
        meeting("invitation", 900, 60, { accepted: false }),
      ],
      { ...query, from: "2026-10-28", to: "2026-10-28" },
    );
    expect(result.count).toBe(1);
    expect(result.busy).toBe(60);
    expect(result.windows.map((w) => [w.start, w.duration])).toEqual([
      [540, 60],
      [780, 120],
      [960, 120],
    ]);
  });
  it("builds equal previous periods across month boundaries", () => {
    expect(periodFor("2026-11-01", "week")).toEqual({
      from: "2026-10-26",
      to: "2026-11-01",
      previousFrom: "2026-10-19",
      previousTo: "2026-10-25",
    });
    expect(periodFor("2026-11-15", "month").to).toBe("2026-11-30");
  });
});

describe("daily collection in Almaty", () => {
  it("catches up once after 07:00, including on wake, without a second same-day collection", () => {
    expect(refreshDue(null, new Date("2026-10-29T00:00:00Z"))).toBe(true);
    expect(
      refreshDue("2026-10-28T03:00:00Z", new Date("2026-10-29T01:00:00Z")),
    ).toBe(false);
    expect(
      refreshDue("2026-10-28T03:00:00Z", new Date("2026-10-29T02:00:00Z")),
    ).toBe(true);
    expect(
      refreshDue("2026-10-29T02:00:00Z", new Date("2026-10-29T07:00:00Z")),
    ).toBe(false);
  });
});

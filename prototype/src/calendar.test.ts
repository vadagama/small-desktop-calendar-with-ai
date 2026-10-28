import { describe, expect, it } from "vitest";
import {
  addDays,
  weekStart,
  monthDays,
  findSlots,
  conflicts,
} from "./calendar";
import type { Meeting } from "./types";
const event: Meeting = {
  organizer: "Алексей",
  id: "1",
  title: "Демо",
  date: "2026-10-29",
  start: 600,
  duration: 60,
  calendar: "team",
  color: "green",
  people: ["Анна"],
  location: "Онлайн",
  agenda: "",
};
describe("calendar dates", () => {
  it("navigates over month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });
  it("renders full Monday-first weeks including leap day", () => {
    const days = monthDays("2028-02-15");
    expect(days).toContain("2028-02-29");
    expect(days.length % 7).toBe(0);
    expect(days[0]).toBe("2028-01-31");
  });
});
describe("demonstration scheduling", () => {
  it("does not offer intervals overlapping any selected participant", () => {
    const slots = findSlots([event], ["Анна"], "2026-10-29", 60);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => !conflicts([event], ["Анна"], slot))).toBe(
      true,
    );
  });
  it("allows adjacent events but detects partial overlap", () => {
    expect(
      conflicts([event], ["Анна"], {
        date: event.date,
        start: 660,
        duration: 30,
      }),
    ).toBe(false);
    expect(
      conflicts([event], ["Анна"], {
        date: event.date,
        start: 630,
        duration: 60,
      }),
    ).toBe(true);
  });
  it("returns no slots for invalid duration and skips weekends", () => {
    expect(findSlots([], [], "2026-10-29", 0)).toEqual([]);
    expect(findSlots([], [], "2026-10-31", 30)[0].date).toBe("2026-11-02");
  });
});

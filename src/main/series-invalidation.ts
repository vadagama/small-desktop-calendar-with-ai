import type { CalendarSync } from "./calendar-sync.js";
import type { SeriesController } from "./series-controller.js";

type Series = Pick<SeriesController, "gate" | "apply">;

/**
 * A series operation may touch any occurrence in any range, so whatever its outcome
 * (applied, refused or unknown) every cached range is dropped. Reading the gate
 * changes nothing and leaves the cache alone.
 */
export function invalidatingSeries(
  series: Series,
  sync: Pick<CalendarSync, "invalidate">,
): Series {
  return {
    gate: (input) => series.gate(input),
    apply: async (input) => {
      try {
        return await series.apply(input);
      } finally {
        await sync.invalidate();
      }
    },
  };
}

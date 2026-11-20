---
version: 1
slug: "prototype-availability-html"
primary_target: "prototype/availability.html"
related_targets: ["prototype/src/availability-demo.css","prototype/src/availability-demo.js"]
---

# Availability analysis — Small workspace

Scope: prototype/availability.html and its two availability-demo source files. Mode: Operate. This is an extension of the approved Small interface. User confirmed “Использовать дизайн Small” on 9 November 2026. The rejected green standalone dashboard is not visual authority.

## Direction contract

THESIS: compare employee availability on a horizontal 00–24 timeline grouped by date in the same working environment as the assistant. The calendar grid owns the space; no promotional heading or metric-card dashboard.

OWN-WORLD: inherit DESIGN.md and current shared UI: white surfaces, neutral navigation, orange Small emblem, black actions, cyan calendar language, compact system type.

STORY: read the selected people and week, compare occupied intervals, identify a confirmed common window, choose it, and inspect the composition before sending it to a demo draft.

FIRST VIEWPORT: 64px left rail, 56px top header, 36px workspace tabs, left weekly grid, right 340px assistant. Dates run down the page, each containing participant rows. A shared 00–24 horizontal timeline scrolls for all dates; participant names stay pinned left and the hour axis stays at the top. Common windows have cyan contours. Selection footer stays below the scrolling grid.

FORM: existing Small workspace extended directly; the user's pinned design and precise weekday/employee axes make concept selection unnecessary. Code-led refinement; no generated comp or seed round.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

Constraints: demo data only; no production/calendar writes; shared 14/13/12/11px type tokens. On narrow windows the grid scrolls horizontally inside its region and chat stacks below. Backend availability contract remains unresolved in the specification; it does not block the design demo.

Participant selection follows the existing meeting creation field: removable selected-name chips, name/position search, avatar and position in results, no duplicates, keyboard selection, immediate recalculation. All participants are removable in analysis. The six-person directory is synthetic.

/** Lay out one day's half-open intervals in independent overlap groups. */
export function layoutEvents<
  T extends { id: string; start: number; duration: number },
>(events: T[]) {
  const sorted = [...events].sort(
    (a, b) =>
      a.start - b.start || b.duration - a.duration || a.id.localeCompare(b.id),
  );
  const result: { event: T; column: number; columns: number }[] = [];
  let group: typeof result = [];
  let ends: number[] = [];
  let groupEnd = -Infinity;
  const finish = () => {
    for (const item of group) item.columns = ends.length;
    result.push(...group);
    group = [];
    ends = [];
  };
  for (const event of sorted) {
    if (event.start >= groupEnd) finish();
    let column = ends.findIndex((end) => end <= event.start);
    if (column < 0) column = ends.length;
    ends[column] = event.start + event.duration;
    groupEnd = Math.max(group.length ? groupEnd : -Infinity, ends[column]!);
    group.push({ event, column, columns: 1 });
  }
  finish();
  return result;
}

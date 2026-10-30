/** Minutes in one calendar day; the existing create API supports at most eight hours. */
export function calendarSelection(
  anchorMinute: number,
  pointerMinute?: number,
) {
  const anchor = Math.max(
    0,
    Math.min(1410, Math.floor(anchorMinute / 30) * 30),
  );
  if (pointerMinute === undefined) return { start: anchor, duration: 30 };
  const endpoint = Math.max(
    0,
    Math.min(1440, Math.round(pointerMinute / 15) * 15),
  );
  if (endpoint < anchor) {
    const start = Math.max(endpoint, anchor + 30 - 480);
    return { start, duration: anchor + 30 - start };
  }
  const end = Math.min(1440, anchor + 480, Math.max(anchor + 30, endpoint));
  return { start: anchor, duration: end - anchor };
}

export function clockMinutes(clock: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return NaN;
  const [hours, minutes] = clock.split(":").map(Number);
  return hours! * 60 + minutes!;
}

export function endAfterDuration(
  start: string,
  duration: number,
): string | null {
  const minutes = clockMinutes(start);
  if (
    !Number.isFinite(minutes) ||
    !Number.isInteger(duration) ||
    duration <= 0 ||
    duration > 480
  )
    return null;
  const end = (minutes + duration) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

export function meetingDuration(start: string, end: string) {
  const difference = clockMinutes(end) - clockMinutes(start);
  return difference < 0 ? difference + 1440 : difference;
}

/** Recognize Small conference links even when the protocol was omitted. */
export function meetingLink(text: string): string | undefined {
  const candidate = text.match(
    /(?:^|[\s(])((?:https:\/\/|meet\.small\.kz\/)[^\s<>]+)/i,
  )?.[1];
  if (!candidate) return;
  const value = candidate.replace(/[.,;!?)]+$/, "");
  try {
    const url = new URL(
      /^https:\/\//i.test(value) ? value : `https://${value}`,
    );
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
  } catch {
    /* Ordinary text is not a meeting link. */
  }
}

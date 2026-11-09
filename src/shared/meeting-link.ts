import { conferenceRhymes, conferenceWords } from "./conference-words.js";

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

const recentConferenceLinks = new Set<string>();

function randomIndex(length: number): number {
  const range = 2 ** 32;
  const limit = range - (range % length);
  for (let attempt = 0; attempt < 32; attempt++) {
    const value = crypto.getRandomValues(new Uint32Array(1))[0]!;
    if (value < limit) return value % length;
  }
  throw new Error(
    "Не удалось получить случайное имя конференции. Повторите попытку.",
  );
}

/** A rhyming pair plus one simple word; shared by the form and assistant drafts. */
export function generateConferenceLink(): string {
  for (let attempt = 0; attempt < 32; attempt++) {
    const pair = conferenceRhymes[randomIndex(conferenceRhymes.length)]!;
    const words = [...pair];
    const available = conferenceWords.filter((word) => !words.includes(word));
    words.push(available[randomIndex(available.length)]!);
    const url = `https://meet.small.kz/${words.join("-")}`;
    if (recentConferenceLinks.has(url)) continue;
    recentConferenceLinks.add(url);
    // This is a bounded per-process history, not a server reservation.
    if (recentConferenceLinks.size > 4096)
      recentConferenceLinks.delete(
        recentConferenceLinks.values().next().value!,
      );
    return url;
  }
  throw new Error(
    "Не удалось получить новое имя конференции. Повторите попытку.",
  );
}

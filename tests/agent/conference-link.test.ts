import {
  conferenceRhymes,
  conferenceWords,
} from "../../src/shared/conference-words.js";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { generateConferenceLink } from "../../src/shared/meeting-link.js";
import { meetingPayload } from "../../src/main/meeting-request.js";
import type { MeetingDraft } from "../../src/shared/meeting-draft.js";

test("calendar API stores conference URL in location without putting it in the agenda", () => {
  const draft = {
    title: "Synthetic",
    agenda: "Agenda",
    location: "Room",
    conferenceUrl: "https://meet.small.kz/synthetic",
    startsAt: "2099-10-29T09:30:00+05:00",
    endsAt: "2099-10-29T10:00:00+05:00",
    timezone: "Asia/Almaty",
    participantIds: ["synthetic-a"],
  } as MeetingDraft;
  const payload = meetingPayload(draft);
  assert.equal(payload.location, draft.conferenceUrl);
  assert.equal(payload.description, "Agenda");
  const longUrl = `https://meet.example.test/${"a".repeat(900)}`;
  assert.equal(
    meetingPayload({ ...draft, conferenceUrl: longUrl }).location,
    longUrl,
  );
  const offline = meetingPayload({ ...draft, conferenceUrl: null });
  assert.equal(offline.location, "Room");
  assert.equal(offline.description, "Agenda");
});

test("dictionary is large, unique and contains only short lowercase words", () => {
  assert.ok(conferenceWords.length >= 800);
  assert.equal(new Set(conferenceWords).size, conferenceWords.length);
  assert.ok(conferenceRhymes.length >= 40);
  assert.equal(
    new Set(conferenceRhymes.map((pair) => pair.join("-"))).size,
    conferenceRhymes.length,
  );
  for (const word of [...conferenceWords, ...conferenceRhymes.flat()])
    assert.match(word, /^[a-z]{2,10}$/);
});

test("a repeated candidate is retried and a stuck random source fails instead of reusing a room", () => {
  let calls = 0;
  const source = mock.method(
    crypto,
    "getRandomValues",
    (array: Uint32Array) => {
      array.fill(calls++ < 4 ? 0 : 1);
      return array;
    },
  );
  try {
    const first = generateConferenceLink();
    const second = generateConferenceLink();
    assert.notEqual(first, second);
    assert.ok(calls > 4);
    assert.throws(() => generateConferenceLink(), /новое имя конференции/);
  } finally {
    source.mock.restore();
  }
});

test("out-of-range random samples are rejected without modulo bias", () => {
  let calls = 0;
  const source = mock.method(
    crypto,
    "getRandomValues",
    (array: Uint32Array) => {
      array.fill(calls++ === 0 ? 0xffffffff : 23);
      return array;
    },
  );
  try {
    const url = generateConferenceLink();
    assert.ok(calls > 2);
    assert.ok(
      url.startsWith(
        `https://meet.small.kz/${conferenceRhymes[23]!.join("-")}-`,
      ),
    );
  } finally {
    source.mock.restore();
  }
});

test("conference links contain exactly three English words without digits or opaque suffixes", () => {
  const links = Array.from({ length: 1000 }, () => generateConferenceLink());
  for (const url of links)
    assert.match(
      url,
      /^https:\/\/meet\.small\.kz\/[a-z]{2,10}(?:-[a-z]{2,10}){2}$/,
    );
  assert.equal(new Set(links).size, links.length);
  for (const url of links) {
    const words = new URL(url).pathname.slice(1).split("-");
    assert.ok(
      conferenceRhymes.some(
        (pair) => pair[0] === words[0] && pair[1] === words[1],
      ),
    );
    assert.ok(words.slice(2).every((word) => conferenceWords.includes(word)));
    assert.equal(new Set(words).size, words.length);
    assert.ok(url.length < 60);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { meetingLink } from "../../src/shared/meeting-link.js";

test("conference links without a scheme normalize to HTTPS", () => {
  assert.equal(
    meetingLink("meet.small.kz/synthetic"),
    "https://meet.small.kz/synthetic",
  );
  assert.equal(
    meetingLink("Подключение: meet.small.kz/synthetic."),
    "https://meet.small.kz/synthetic",
  );
  assert.equal(
    meetingLink("https://meet.small.kz/synthetic"),
    "https://meet.small.kz/synthetic",
  );
});
test("ordinary text and unsafe links are not conference links", () => {
  for (const text of [
    "Переговорная",
    "javascript:alert(1)",
    "https://name:password@example.com/",
    "notmeet.small.kz/synthetic",
    "http://meet.small.kz/synthetic",
  ])
    assert.equal(meetingLink(text), undefined);
});

import { defaultMeetingSchedule } from "../../src/shared/calendar-time.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { meetingDraftSchema } from "../../src/shared/meeting-draft.js";
import { meetingOccurrences } from "../../src/main/meeting-occurrences.js";
import {
  meetingPayload,
  meetingCreateBody,
} from "../../src/main/meeting-request.js";
import {
  isAttachmentUpload,
  maxAttachmentBytes,
} from "../../src/main/attachment-request.js";
const draft = () =>
  meetingDraftSchema.parse({
    kind: "meeting-draft",
    status: "preview",
    id: "12345678-1234-4234-8234-123456789012",
    title: "Test",
    agenda: "Agenda",
    participantIds: ["a"],
    organizer: { id: "a", name: "A" },
    startsAt: "2099-10-29T04:30:00Z",
    endsAt: "2099-10-29T05:00:00Z",
    durationMinutes: 30,
    timezone: "Asia/Almaty",
    location: "Room",
    conferenceUrl: null,
    recurrence: "weekly",
    visibility: "private",
    availabilityCheckedAt: "2026-10-29T00:00:00Z",
    options: {
      calendarIds: [7],
      notificationRecipientIds: ["b"],
      attachmentIds: ["file"],
      recurrence: { FREQ: "WEEKLY", BYDAY: ["TH"], UNTIL: "2099-11-05" },
    },
  });
test("weekly bounded occurrences retain local time and inclusive final date", () => {
  const d = draft();
  const occurrences = meetingOccurrences(d);
  assert.equal(occurrences.length, 2);
  assert.equal(occurrences[1]!.startsAt, "2099-11-05T04:30:00.000Z");
  const body = meetingPayload(d);
  assert.equal(body.is_recurring, true);
  assert.deepEqual(body.calendar_ids, [7]);
  assert.deepEqual(body.notification_recipient_ids, ["b"]);
  assert.deepEqual(body.attachments, ["file"]);
  assert.equal(
    meetingCreateBody.safeParse({ ...body, is_recurring: false }).success,
    false,
  );
});
test("recurrence rejects mismatched start day, inverted and excessive horizons", () => {
  for (const rule of [
    { BYDAY: ["MO"], UNTIL: "2099-11-05" },
    { BYDAY: ["TH"], UNTIL: "2099-10-28" },
    { BYDAY: ["TH"], UNTIL: "2100-03-01" },
    { BYDAY: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"], UNTIL: "2099-12-20" },
  ]) {
    const d = draft();
    d.options!.recurrence = {
      FREQ: "WEEKLY",
      ...rule,
    } as NonNullable<typeof d.options>["recurrence"];
    assert.throws(() => meetingOccurrences(d));
  }
});
test("upload guard accepts only bounded file multipart on the attachment endpoint", () => {
  const body = new FormData();
  body.set("file", new Blob(["synthetic"]), "test.txt");
  body.set("is_public", "true");
  assert.equal(isAttachmentUpload("/gate/team/api/attachments", body), true);
  assert.equal(isAttachmentUpload("/other", body), false);
  body.set("extra", "value");
  assert.equal(isAttachmentUpload("/gate/team/api/attachments", body), false);
  body.delete("extra");
  body.set(
    "file",
    new Blob([new Uint8Array(maxAttachmentBytes + 1)]),
    "too-big",
  );
  assert.equal(isAttachmentUpload("/gate/team/api/attachments", body), false);
});

test("manual default time follows Almaty time and rolls a late day forward", () => {
  assert.deepEqual(
    defaultMeetingSchedule("2026-10-29", new Date("2026-10-29T04:13:00Z")),
    { date: "2026-10-29", start: "09:15", end: "09:45" },
  );
  assert.deepEqual(
    defaultMeetingSchedule("2026-10-29", new Date("2026-10-29T18:50:00Z")),
    { date: "2026-10-30", start: "09:00", end: "09:30" },
  );
});

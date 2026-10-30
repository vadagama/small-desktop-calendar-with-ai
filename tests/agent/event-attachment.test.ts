import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachmentUrl,
  attachmentName,
  attachmentSize,
} from "../../src/shared/event-attachment.js";

test("attachment paths stay under Small storage and reject remote URLs and traversal", () => {
  for (const path of [
    "https://evil.test/file.pdf",
    "//evil.test/a",
    "../a",
    "%2e%2e/a",
    "file:///tmp/a",
    "a\\b",
    "a/%2f../b",
    "a/%00b",
    "",
    "a/%bad",
  ])
    assert.equal(attachmentUrl(path), undefined, path);
  assert.equal(
    attachmentUrl("calendar/test/План #1.pdf"),
    "https://minio.skiftrade.kz:9000/team/calendar/test/%D0%9F%D0%BB%D0%B0%D0%BD%20%231.pdf",
  );
  assert.equal(
    attachmentName("calendar/План%20встречи.pdf"),
    "План встречи.pdf",
  );
  assert.equal(attachmentSize(2048), "2 КБ");
  assert.equal(attachmentSize(1048576), "1 МБ");
  assert.equal(attachmentSize(undefined), "");
});

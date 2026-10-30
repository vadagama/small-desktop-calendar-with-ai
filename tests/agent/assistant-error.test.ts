import assert from "node:assert/strict";
import { test } from "node:test";
import { APICallError } from "ai";
import { assistantErrorMessage } from "../../src/agent/assistant-error.js";

test("provider failures explain the cause without exposing provider payloads", () => {
  for (const [status, text] of [
    [401, "API-ключ"],
    [403, "доступ"],
    [404, "Model ID"],
    [400, "HTTP 400"],
    [429, "лимит"],
    [503, "недоступен"],
  ] as const) {
    const error = new APICallError({
      message: "private-provider-message",
      url: "https://synthetic.invalid",
      requestBodyValues: { secret: "private-prompt" },
      responseBody: "private-response",
      statusCode: status,
    });
    const message = assistantErrorMessage(error);
    assert.ok(message.includes(text), message);
    assert.doesNotMatch(message, /private-|synthetic.invalid/);
  }
});
test("transport and unknown failures never echo raw exceptions", () => {
  assert.match(
    assistantErrorMessage(
      new Error("private", { cause: { code: "ENOTFOUND" } }),
    ),
    /серверу модели/,
  );
  assert.match(
    assistantErrorMessage(
      new Error("private", { cause: { code: "CERT_HAS_EXPIRED" } }),
    ),
    /сертификат/,
  );
  assert.match(assistantErrorMessage({ name: "TimeoutError" }), /время/);
  assert.doesNotMatch(assistantErrorMessage(new Error("private")), /private/);
});

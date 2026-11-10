import assert from "node:assert/strict";
import { test } from "node:test";
import { participantConflicts } from "../../src/main/calendar-conflict.js";

test("only verified participant conflict IDs permit offering confirmation", async () => {
  const response = Response.json(
    {
      status: "error",
      message: "Validation failed",
      errors: { participant_ids: ["person-a", "person-a"] },
    },
    { status: 422 },
  );
  assert.deepEqual(await participantConflicts(response, ["person-a"]), [
    "person-a",
  ]);
  assert.equal(response.bodyUsed, false);
  for (const errors of [
    { participant_ids: ["unknown"] },
    { participant_ids: ["person-a"], calendar_ids: [7] },
    { participant_ids: ["person-a"], title: ["Invalid"] },
    { participant_ids: ["Участник не найден"] },
    { participant_ids: [] },
    { calendar_ids: [7] },
  ])
    assert.equal(
      await participantConflicts(Response.json({ errors }, { status: 422 }), [
        "person-a",
      ]),
      undefined,
    );
  for (const status of [401, 403, 500, 503])
    assert.equal(
      await participantConflicts(
        Response.json(
          { errors: { participant_ids: ["person-a"] } },
          { status },
        ),
        ["person-a"],
      ),
      undefined,
    );
  assert.equal(
    await participantConflicts(new Response(null, { status: 409 }), [
      "person-a",
    ]),
    undefined,
  );
});

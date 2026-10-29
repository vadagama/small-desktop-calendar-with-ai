import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CalendarService,
  isCalendarReadPath,
} from "../../src/main/calendar.js";

const query = { accountId: "account-a", query: "Synthetic", page: 1 };
const person = {
  person_guid: "synthetic-person-a",
  person_full_fio: "Synthetic Person",
  position_name: "Synthetic role",
  private_field: "must not escape",
};
function setup(body: unknown, status = 200) {
  const calls: string[] = [];
  const service = new CalendarService({
    readCalendar: async (accountId, action) => {
      assert.equal(accountId, "account-a");
      return action(async (path) => {
        calls.push(path);
        return Response.json(body, { status });
      });
    },
  });
  return { service, calls };
}
function page(items: unknown[] = [person], current = 1, last = 1) {
  return {
    data: { items, pagination: { current_page: current, last_page: last } },
  };
}

test("directory uses verified search query and exposes only participant fields", async () => {
  const f = setup(page());
  assert.deepEqual(await f.service.searchPeople(query), {
    people: [
      {
        participantId: person.person_guid,
        name: person.person_full_fio,
        position: person.position_name,
      },
    ],
    page: 1,
    nextPage: null,
  });
  const url = new URL(f.calls[0]!, "https://team.small.kz");
  assert.equal(url.pathname, "/gate/employee/api/search/persons");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: "Synthetic",
    per_page: "10",
    page: "1",
  });
  assert.equal(isCalendarReadPath(f.calls[0]!), true);
});

test("same-name people remain distinct and further pages are explicit", async () => {
  const f = setup(
    page([person, { ...person, person_guid: "synthetic-person-b" }], 2, 3),
  );
  const result = await f.service.searchPeople({ ...query, page: 2 });
  assert.equal(result.people.length, 2);
  assert.notEqual(
    result.people[0]?.participantId,
    result.people[1]?.participantId,
  );
  assert.equal(result.nextPage, 3);
});

test("empty search results are valid only with a valid page envelope", async () => {
  assert.deepEqual(await setup(page([])).service.searchPeople(query), {
    people: [],
    page: 1,
    nextPage: null,
  });
  for (const body of [
    {},
    { data: [] },
    { data: { items: [] } },
    page([], 2, 2),
    page([], 1, 0),
    page([{ ...person, person_guid: null }]),
    page([person, person]),
    page([{ ...person, person_full_fio: " " }]),
    page(
      Array.from({ length: 11 }, (_, i) => ({
        ...person,
        person_guid: `synthetic-${i}`,
      })),
    ),
  ])
    await assert.rejects(
      setup(body).service.searchPeople(query),
      /формат|страниц/,
    );
});

test("permission and network failures cannot masquerade as no matching people", async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(setup({}, status).service.searchPeople(query));
  }
});

test("invalid directory inputs never reach the session transport", async () => {
  const f = setup(page());
  for (const input of [
    { ...query, query: " " },
    { ...query, query: "x".repeat(201) },
    { ...query, page: 0 },
    { ...query, page: 1.5 },
    { ...query, endpoint: "https://evil.invalid" },
  ])
    await assert.rejects(f.service.searchPeople(input));
  assert.deepEqual(f.calls, []);
});

test("directory route guard rejects unexpected parameters, origins and pagination", () => {
  const path =
    "/gate/employee/api/search/persons?q=Synthetic&per_page=10&page=1";
  assert.equal(isCalendarReadPath(path), true);
  for (const value of [
    path + "&force=true",
    path + "&q=second",
    path + "#fragment",
    path.replace("page=1", "page=0"),
    path.replace("page=1", "page=1.5"),
    path.replace("per_page=10", "per_page=100"),
    path.replace("q=Synthetic", "q=%20"),
    "https://evil.invalid" + path,
    "/gate/employee/api/persons",
  ])
    assert.equal(isCalendarReadPath(value), false, value);
});

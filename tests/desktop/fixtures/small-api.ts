import type { ElectronApplication } from "@playwright/test";

/** Synthetic boundary only; never forwards a request to production Small. */
export async function mockSmall(app: ElectronApplication, date: string) {
  await app.evaluate(({ session }, date) => {
    const isolated = session.fromPartition("small-auth", { cache: false });
    let employee = "employee-a";
    let renamedTitle: string | null = null,
      deleted = false;
    const inspection = globalThis as typeof globalThis & {
      syntheticMeetingWrites: number;
      syntheticEventOwner?: string;
      syntheticLostDelete?: boolean;
      syntheticEventMutations: number;
      syntheticCreatedPayload?: Record<string, unknown>;
    };
    inspection.syntheticMeetingWrites = 0;
    inspection.syntheticEventMutations = 0;
    const created: Array<{
      id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      [key: string]: unknown;
    }> = [];
    isolated.protocol.handle("https", async (request) => {
      const url = new URL(request.url);
      if (url.origin !== "https://team.small.kz")
        return new Response(null, { status: 403 });
      const path = url.pathname;
      if (
        path.includes("/calendar/events") &&
        request.method !== "GET" &&
        !path.endsWith("/find-slots") &&
        !path.endsWith("/busy-intervals")
      )
        inspection.syntheticEventMutations++;
      if (path.endsWith("/login")) {
        const input = await request.json();
        if (input.password !== "synthetic-password")
          return new Response(null, { status: 401 });
        employee = input.username;
        await isolated.cookies.set({
          url: "https://team.small.kz",
          name: "synthetic-refresh",
          value: employee,
          secure: true,
          httpOnly: true,
          path: "/",
          sameSite: "lax",
        });
      }
      if (path.endsWith("/login") || path.endsWith("/refresh")) {
        const cookies = await isolated.cookies.get({
          url: "https://team.small.kz",
        });
        const cookie = cookies.find(
          (entry) => entry.name === "synthetic-refresh",
        );
        if (!cookie) return new Response(null, { status: 401 });
        employee = cookie.value;
        const claims = Buffer.from(
          JSON.stringify({
            uid: employee,
            guidfl: "synthetic-organizer",
            name: employee,
            preferred_username: employee,
          }),
        ).toString("base64url");
        return Response.json({
          data: { access_token: `header.${claims}.signature` },
        });
      }
      if (path.endsWith("/logout")) return Response.json({});
      if (!request.headers.get("authorization")?.startsWith("Bearer header."))
        return new Response(null, { status: 401 });
      if (path === "/gate/team/api/attachments" && request.method === "POST") {
        const form = await request.formData();
        if (
          !(form.get("file") instanceof Blob) ||
          form.get("is_public") !== "true"
        )
          return new Response(null, { status: 400 });
        return Response.json({
          data: { id: "synthetic-file", path: "synthetic.txt" },
        });
      }
      if (
        path === "/gate/team/api/calendar/events" &&
        request.method === "POST"
      ) {
        if (url.searchParams.get("force") !== "false")
          return new Response(null, { status: 400 });
        const body = await request.json();
        inspection.syntheticMeetingWrites++;
        inspection.syntheticCreatedPayload = body;
        const event = {
          ...body,
          description: body.description || null,
          location: body.location || null,
          calendar_ids: [...(body.calendar_ids ?? []), 99],
          id: `synthetic-created-${inspection.syntheticMeetingWrites}`,
          attachments: body.attachments.map((id: string) => ({ id })),
          notification_recipients: body.notification_recipient_ids.map(
            (id: string) => ({ id }),
          ),
          participants: body.participant_ids.map((id: string) => ({ id })),
          creator_name: employee,
        };
        created.push(event);
        // Server applied the write but its response cannot establish the outcome.
        if (body.title === "Неизвестный результат")
          return new Response(null, { status: 503 });
        return Response.json({ data: { id: event.id } });
      }
      const savedEvent = created.find(
        (event) => path === `/gate/team/api/calendar/events/${event.id}`,
      );
      if (savedEvent && request.method === "GET")
        return Response.json({ data: savedEvent });
      if (path.endsWith("/find-slots") || path.endsWith("/busy-intervals")) {
        if (request.method !== "POST")
          return new Response(null, { status: 405 });
        const input = await request.json();
        if (input.participant_ids.includes("denied"))
          return new Response(null, { status: 403 });
        const day = input.start_date ?? input.date;
        if (path.endsWith("/find-slots"))
          return Response.json({
            status: "success",
            data: {
              has_more: false,
              available_slots:
                input.duration_minutes === 60
                  ? []
                  : [
                      {
                        start: `${day}T09:00:00+05:00`,
                        end: `${day}T09:30:00+05:00`,
                      },
                      {
                        start: `${day}T09:30:00+05:00`,
                        end: `${day}T10:00:00+05:00`,
                      },
                    ],
            },
          });
        return Response.json({
          status: "success",
          data: input.participant_ids
            .filter((id: string) => id !== "unknown")
            .map((participant_id: string) => ({
              type: "participant",
              id: participant_id,
              busy_slots:
                participant_id === "synthetic-b"
                  ? [
                      {
                        start: `${day}T09:00:00+05:00`,
                        end: `${day}T09:30:00+05:00`,
                      },
                    ]
                  : [],
            })),
        });
      }
      if (
        request.method !== "GET" &&
        !(
          path.endsWith("/calendar/events/42") &&
          ["PUT", "DELETE"].includes(request.method)
        )
      )
        return new Response(null, { status: 405 });
      if (path === "/gate/employee/api/search/persons") {
        const q = url.searchParams.get("q");
        const current = Number(url.searchParams.get("page"));
        const people =
          q === "пусто"
            ? []
            : q === "неизвестно"
              ? [
                  {
                    person_guid: "unknown",
                    person_full_fio: "Неизвестная занятость",
                    position_name: "Тест",
                  },
                ]
              : q === "нет прав"
                ? [
                    {
                      person_guid: "denied",
                      person_full_fio: "Закрытый календарь",
                      position_name: "Тест",
                    },
                  ]
                : current === 2
                  ? [
                      {
                        person_guid: "synthetic-c",
                        person_full_fio: "Другой сотрудник",
                        position_name: "Тест",
                      },
                    ]
                  : [
                      {
                        person_guid: "synthetic-a",
                        person_full_fio: "Тестовый сотрудник",
                        position_name: "Отдел A",
                      },
                      {
                        person_guid: "synthetic-b",
                        person_full_fio: "Тестовый сотрудник",
                        position_name: "Отдел B",
                      },
                    ];
        return Response.json({
          data: {
            items: people,
            pagination: {
              current_page: current,
              last_page: q === "Тест" ? 2 : 1,
            },
          },
        });
      }

      if (path.endsWith("/info"))
        return Response.json({ data: { avatar: null } });
      if (path.endsWith("/calendars/public"))
        return Response.json({
          data: [
            { id: 7, name: "Тестовая переговорная" },
            { id: 8, name: "Нет прав" },
            { id: 9, name: "Сбой сервера" },
            { id: 10, name: "Неполный ответ" },
            { id: 11, name: "Пустой календарь" },
          ],
        });
      const suffix = employee === "employee-a" ? "A" : "B";
      const event = {
        id: 42,
        title: renamedTitle ?? `Синтетическая встреча ${suffix}`,
        starts_at: `${date}T09:00:00+05:00`,
        ends_at: `${date}T10:00:00+05:00`,
        calendar_ids: [7],
        creator_name: "Синтетический организатор",
        creator_id: inspection.syntheticEventOwner ?? "synthetic-organizer",
        timezone: "Asia/Almaty",
        is_public: false,
        notification_recipients: [],
        attachments: [],
        is_recurring: false,
        participants: [{ id: employee }, { id: "synthetic-b" }],
        description: "Синтетическая повестка",
        location: "Тестовая переговорная",
      };
      const recurring = {
        ...event,
        id: null,
        original_event_id: 43,
        is_recurring: true,
        title: `Синтетическая серия ${suffix}`,
        starts_at: `${date}T11:00:00+05:00`,
        ends_at: `${date}T11:30:00+05:00`,
      };
      if (path.endsWith("/calendar/events/42")) {
        if (request.method === "PUT") {
          if (url.searchParams.get("force") !== "false")
            return new Response(null, { status: 400 });
          const body = await request.json();
          if (
            body.description !== event.description ||
            body.location !== event.location ||
            body.timezone !== event.timezone
          )
            return new Response(null, { status: 422 });
          renamedTitle = body.title;
          return Response.json({
            status: "success",
            data: { ...event, title: renamedTitle },
          });
        }
        if (request.method === "DELETE") {
          deleted = true;
          return new Response(null, {
            status: inspection.syntheticLostDelete ? 503 : 204,
          });
        }
        return deleted
          ? new Response(null, { status: 404 })
          : Response.json({ data: event });
      }
      if (path.endsWith("/calendar/events/generated"))
        return Response.json({ data: recurring });
      if (path.endsWith("/events")) {
        if (path.includes("/8/")) return new Response(null, { status: 403 });
        if (path.includes("/9/")) return new Response(null, { status: 503 });
        if (path.includes("/10/"))
          return Response.json({
            data: [event, { title: "Malformed synthetic event" }],
          });
        if (path.includes("/11/")) return Response.json({ data: [] });
        const start = url.searchParams.get("start_date"),
          end = url.searchParams.get("end_date");
        if (!start || !end) return new Response(null, { status: 400 });
        return Response.json({
          data: [...(deleted ? [] : [event]), recurring, ...created].filter(
            (entry) =>
              Date.parse(entry.starts_at) < Date.parse(end) &&
              Date.parse(entry.ends_at) > Date.parse(start),
          ),
        });
      }
      return new Response(null, { status: 404 });
    });
  }, date);
}

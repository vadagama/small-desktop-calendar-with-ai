import type { ElectronApplication } from "@playwright/test";

/** Synthetic boundary only; never forwards a request to production Small. */
export async function mockSmall(app: ElectronApplication, date: string) {
  await app.evaluate(({ session }, date) => {
    const isolated = session.fromPartition("small-auth", { cache: false });
    let employee = "employee-a";
    isolated.protocol.handle("https", async (request) => {
      const url = new URL(request.url);
      if (url.origin !== "https://team.small.kz")
        return new Response(null, { status: 403 });
      const path = url.pathname;
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
      if (request.method !== "GET") return new Response(null, { status: 405 });
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
        title: `Синтетическая встреча ${suffix}`,
        starts_at: `${date}T09:00:00+05:00`,
        ends_at: `${date}T10:00:00+05:00`,
        calendar_ids: [7],
        creator_name: "Синтетический организатор",
        description: "Синтетическая повестка",
        location: "Тестовая переговорная",
      };
      const recurring = {
        ...event,
        id: null,
        original_event_id: 43,
        title: `Синтетическая серия ${suffix}`,
        starts_at: `${date}T11:00:00+05:00`,
        ends_at: `${date}T11:30:00+05:00`,
      };
      if (path.endsWith("/calendar/events/42"))
        return Response.json({ data: event });
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
          data: [event, recurring].filter(
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

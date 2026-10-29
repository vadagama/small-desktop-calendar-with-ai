import {
  ipcMain,
  Notification,
  powerMonitor,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import { reminderChannels, type ReminderReply } from "../shared/reminders.js";
import { calendarTimeZone } from "../shared/calendar-time.js";
import type { CalendarService } from "./calendar.js";
import type { SmallAuth } from "./small-auth.js";
import { ReminderStore } from "./reminder-store.js";
import { Reminders } from "./reminders.js";

export function registerReminders(
  directory: string,
  auth: SmallAuth,
  calendar: CalendarService,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  showWindow: () => void,
) {
  const format = (date: string) =>
    new Intl.DateTimeFormat("ru", {
      timeZone: calendarTimeZone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(date));
  const reminders = new Reminders(new ReminderStore(directory), {
    auth,
    calendar,
    open: (url) => shell.openExternal(url),
    notify: (item, join) => {
      if (!Notification.isSupported()) {
        reminders.nativeFailed();
        return () => {};
      }
      const notification = new Notification({
        title: item.event.title,
        subtitle: `${format(item.event.startsAt)} — ${format(item.event.endsAt)} · ${calendarTimeZone}`,
        body: `Организатор: ${item.event.organizer || "не указан"}${item.canJoin ? "" : "\nСсылка на встречу отсутствует"}`,
        actions: item.canJoin ? [{ type: "button", text: "Подключиться" }] : [],
      });
      notification.on("failed", () => reminders.nativeFailed());
      notification.on("click", showWindow);
      notification.on("action", () => join());
      notification.show();
      return () => notification.close();
    },
  });
  const handle = (
    channel: string,
    action: (input: unknown) => Promise<void>,
  ) => {
    ipcMain.handle(
      channel,
      async (event, input: unknown): Promise<ReminderReply> => {
        if (!trusted(event))
          return { ok: false, error: "Доступ к напоминаниям отклонён." };
        try {
          await action(input);
          return { ok: true, state: await reminders.state() };
        } catch {
          return {
            ok: false,
            error:
              "Не удалось выполнить действие. Проверьте настройки, вход в Small и актуальность встречи.",
          };
        }
      },
    );
  };
  handle(reminderChannels.read, async () => {
    await reminders.tick();
  });
  handle(reminderChannels.save, async (input) => {
    await reminders.save(input);
  });
  handle(reminderChannels.join, async (input) => {
    await reminders.join(
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(input),
    );
  });
  const refresh = () => {
    void reminders.tick();
  };
  const timer = setInterval(refresh, 30000);
  const resume = () => {
    reminders.invalidate();
    void reminders.tick().then(() => reminders.tick());
  };
  powerMonitor.on("resume", resume);
  refresh();
  return {
    invalidate: () => reminders.invalidate(),
    stop: () => {
      clearInterval(timer);
      powerMonitor.removeListener("resume", resume);
      reminders.invalidate();
    },
  };
}

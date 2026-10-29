import {
  app,
  ipcMain,
  Notification,
  shell,
  type IpcMainInvokeEvent,
  type NotificationConstructorOptions,
} from "electron";
import { randomUUID } from "node:crypto";
import {
  nativeNotificationChannels,
  type NativeNotificationState,
} from "../shared/reminders.js";

/** Holds notification objects until close; delivery is verified separately from show(). */
export class NativeNotifications {
  private notifications = new Map<string, Notification>();
  private last: NativeNotificationState = {
    status: "untested",
    message: "Проверка доставки ещё не выполнялась.",
  };
  private testPending = false;
  private testId: string | null = null;
  constructor(
    private showWindow: () => void | Promise<void>,
    private failed: () => void,
  ) {}
  show(options: NotificationConstructorOptions, action: () => void) {
    if (!Notification.isSupported())
      throw new Error("Notifications unsupported");
    const id = options.id ?? randomUUID();
    const notification = new Notification({ ...options, id });
    this.notifications.set(id, notification);
    notification.on("failed", () => {
      if (id === this.testId)
        this.last = {
          status: "failed",
          message:
            "macOS отклонила уведомление. Проверьте разрешения уведомлений и запустите установленную локальную сборку Small Calendar.",
        };
      this.failed();
    });
    notification.on("click", this.showWindow);
    notification.on("action", action);
    notification.on("close", () => this.notifications.delete(id));
    notification.show();
    return () => {
      notification.close();
      this.notifications.delete(id);
    };
  }
  async state(): Promise<NativeNotificationState> {
    if (
      this.testId &&
      this.last.status === "waiting" &&
      process.platform === "darwin"
    ) {
      try {
        const delivered = await Notification.getHistory();
        if (delivered.some((n) => n.id === this.testId))
          this.last = {
            status: "delivered",
            message:
              "macOS подтвердила уведомление в Центре уведомлений. Баннер может быть скрыт режимом фокусирования.",
          };
      } catch {
        this.last = {
          status: "failed",
          message: "Не удалось проверить историю уведомлений macOS.",
        };
      }
    }
    return this.last;
  }
  async test() {
    if (this.testPending) return this.state();
    this.testPending = true;
    try {
      if (this.testId) {
        this.notifications.get(this.testId)?.close();
        this.notifications.delete(this.testId);
      }
      this.testId = randomUUID();
      this.last = {
        status: "waiting",
        message:
          "Ожидаем подтверждения macOS. Если уведомления нет, разрешите уведомления для Small Calendar в настройках системы.",
      };
      this.show(
        {
          id: this.testId,
          title: "Small Calendar — проверка",
          body: "Тест доставки. Кнопка откроет локальное приложение Small Calendar.",
          actions: [{ type: "button", text: "Открыть календарь" }],
        },
        () => {
          void Promise.resolve()
            .then(() => this.showWindow())
            .then(() => {
              this.last = {
                status: "opened",
                message:
                  "Действие уведомления выполнено: открыт локальный календарь Small.",
              };
            })
            .catch(() => {
              this.last = {
                status: "failed",
                message: "Не удалось открыть локальный календарь.",
              };
            });
        },
      );
      return await this.state();
    } catch {
      this.last = {
        status: "failed",
        message:
          "Системные уведомления недоступны. Запустите локальную сборку Small Calendar и проверьте разрешения macOS.",
      };
      return this.last;
    } finally {
      this.testPending = false;
    }
  }
  register(trusted: (event: IpcMainInvokeEvent) => boolean) {
    const handle = (
      channel: string,
      run: () => Promise<NativeNotificationState>,
    ) =>
      ipcMain.handle(channel, (event) => {
        if (!trusted(event))
          return { status: "failed", message: "Доступ отклонён." };
        return run();
      });
    handle(nativeNotificationChannels.read, () => this.state());
    handle(nativeNotificationChannels.test, () => this.test());
    handle(nativeNotificationChannels.settings, async () => {
      const error = await shell.openPath(
        "/System/Applications/System Settings.app",
      );
      return error
        ? {
            status: "failed",
            message:
              "Откройте Системные настройки → Уведомления → Small Calendar.",
          }
        : this.state();
    });
    app.on("before-quit", () => {
      for (const n of this.notifications.values()) n.close();
      this.notifications.clear();
    });
  }
}

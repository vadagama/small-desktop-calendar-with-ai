import type { UpdateState } from "../shared/updates.js";

interface Release {
  version: string;
  releaseNotes?: string | { note: string | null }[] | null;
}

// The transport is electron-updater; this controller owns only product behaviour.
export interface UpdateDriver {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(
    event: "update-available" | "update-downloaded",
    listener: (info: Release) => void,
  ): unknown;
  on(
    event: "download-progress",
    listener: (info: { percent: number }) => void,
  ): unknown;
  on(event: "update-not-available" | "error", listener: () => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export class AppUpdates {
  private state: UpdateState;
  private checking: Promise<UpdateState> | undefined;
  private downloading = false;

  constructor(
    version: string,
    private readonly driver?: UpdateDriver,
    unsupported = "Автообновление доступно в подписанной сборке macOS.",
    private readonly changed: (state: UpdateState) => void = () => {},
  ) {
    this.state = {
      currentVersion: version,
      status: driver ? "idle" : "unsupported",
      ...(!driver ? { message: unsupported } : {}),
    };
    if (!driver) return;
    driver.autoDownload = false;
    driver.autoInstallOnAppQuit = false;
    driver.allowPrerelease = false;
    driver.allowDowngrade = false;
    driver.on("update-available", (info) => {
      if (
        this.downloading ||
        this.state.status === "ready" ||
        this.state.status === "installing"
      )
        return;
      const notes =
        typeof info.releaseNotes === "string"
          ? info.releaseNotes
          : (info.releaseNotes?.map((note) => note.note ?? "").join("\n\n") ??
            "");
      this.set({ version: info.version, notes: notes.slice(0, 20000) });
      void this.download();
    });
    driver.on("update-not-available", () => this.set({ status: "current" }));
    driver.on("download-progress", ({ percent }) => {
      if (this.state.status === "downloading" && Number.isFinite(percent))
        this.set({ percent: Math.max(0, Math.min(100, percent)) });
    });
    driver.on("update-downloaded", (info) =>
      this.set({ status: "ready", version: info.version, percent: 100 }),
    );
    driver.on("error", () => this.fail());
  }

  read(): UpdateState {
    return { ...this.state };
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.read());
  }

  private fail() {
    this.set({
      status: "error",
      message:
        "Не удалось проверить или скачать обновление. Проверьте интернет и повторите попытку.",
    });
  }

  private async download() {
    if (!this.driver || this.downloading) return;
    this.downloading = true;
    this.set({ status: "downloading", percent: 0, message: "" });
    try {
      await this.driver.downloadUpdate();
    } catch {
      this.fail();
    } finally {
      this.downloading = false;
    }
  }

  check(): Promise<UpdateState> {
    if (
      !this.driver ||
      this.downloading ||
      ["ready", "installing"].includes(this.state.status)
    )
      return Promise.resolve(this.read());
    if (this.checking) return this.checking;
    this.checking = this.performCheck().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async performCheck(): Promise<UpdateState> {
    if (this.state.status === "error" && this.state.version) {
      await this.download();
      return this.read();
    }
    this.set({ status: "checking", message: "" });
    try {
      await this.driver!.checkForUpdates();
      this.set({ checkedAt: new Date().toISOString() });
    } catch {
      this.fail();
    }
    return this.read();
  }

  install(): boolean {
    if (!this.driver || this.state.status !== "ready") return false;
    this.set({ status: "installing" });
    try {
      this.driver.quitAndInstall();
      return true;
    } catch {
      this.fail();
      return false;
    }
  }

  start(initialMs = 10000, intervalMs = 4 * 60 * 60 * 1000) {
    if (!this.driver) return () => {};
    const startup = setTimeout(() => void this.check(), initialMs);
    const periodic = setInterval(() => void this.check(), intervalMs);
    startup.unref();
    periodic.unref();
    return () => {
      clearTimeout(startup);
      clearInterval(periodic);
    };
  }
}

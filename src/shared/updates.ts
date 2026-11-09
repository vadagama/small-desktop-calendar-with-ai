export const updateChannels = {
  read: "updates:read",
  check: "updates:check",
  install: "updates:install",
  changed: "updates:changed",
} as const;

export interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "current"
    | "downloading"
    | "ready"
    | "installing"
    | "error"
    | "unsupported";
  currentVersion: string;
  version?: string;
  notes?: string;
  percent?: number;
  checkedAt?: string;
  message?: string;
}

export interface UpdateBridge {
  read(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  install(): Promise<{ ok: boolean }>;
  subscribe(listener: (state: UpdateState) => void): () => void;
}

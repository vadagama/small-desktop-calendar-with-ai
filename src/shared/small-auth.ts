export const smallAuthChannels = {
  read: "small-auth:read",
  login: "small-auth:login",
  logout: "small-auth:logout",
  required: "small-auth:required",
} as const;
export type SmallAuthState =
  | { status: "signed-out"; warning?: string }
  | {
      status: "signed-in";
      profile: {
        id: string;
        name: string;
        username: string;
        participantId?: string;
      };
    };
export type SmallAuthReply =
  | { ok: true; state: SmallAuthState }
  | { ok: false; error: string; kind?: "auth" | "network" };
export type SmallAuthStatus =
  "checking" | "verified" | "signed-out" | "required" | "unknown";
export interface SmallAuthBridge {
  read(): Promise<SmallAuthReply>;
  login(input: { username: string; password: string }): Promise<SmallAuthReply>;
  logout(): Promise<SmallAuthReply>;
  subscribeRequired(listener: () => void): () => void;
}

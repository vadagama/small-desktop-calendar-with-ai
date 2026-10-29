export type ProfileId = "small" | "personal";
export type ActiveProfile = ProfileId | "synthetic";
export interface LlmProfile {
  id: ProfileId;
  baseURL: string;
  modelId: string;
}
export interface ProfileInput extends LlmProfile {
  apiKey?: string;
}
export interface ModelConnection extends LlmProfile {
  apiKey: string;
}
export interface ProfileState {
  active: ActiveProfile;
  profiles: (LlmProfile & { keySuffix?: string; hasKey?: boolean })[];
  warning?: string;
}
export type ProfileReply =
  { ok: true; state: ProfileState } | { ok: false; error: string };
export interface ProfileBridge {
  read(): Promise<ProfileReply>;
  save(input: ProfileInput): Promise<ProfileReply>;
  activate(id: ActiveProfile): Promise<ProfileReply>;
  remove(id: ProfileId): Promise<ProfileReply>;
}
export const profileChannels = {
  read: "profiles:read",
  save: "profiles:save",
  activate: "profiles:activate",
  remove: "profiles:remove",
} as const;

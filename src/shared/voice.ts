export const voiceChannel = "voice:request";
export const VOICE_SAMPLE_RATE = 16000;
export const VOICE_MAX_SECONDS = 120;
export type VoiceModelPhase =
  "absent" | "downloading" | "paused" | "verifying" | "ready" | "error";
export interface VoiceStatus {
  phase: VoiceModelPhase;
  received: number;
  total: number;
  bytesPerSecond: number;
  error: string;
  source: string;
  runtimeAvailable: boolean;
  active: boolean;
}
export type VoiceRequest =
  | { action: "status" | "install" | "pause" | "remove" | "cancelDownload" }
  | { action: "source"; deviceId: string }
  | { action: "begin" | "cancel"; sessionId: string }
  | { action: "transcribe"; sessionId: string; pcm: ArrayBuffer };
export type VoiceReply =
  | { ok: true; status: VoiceStatus; text?: string }
  | { ok: false; error: string };
export interface VoiceBridge {
  request(input: VoiceRequest): Promise<VoiceReply>;
}

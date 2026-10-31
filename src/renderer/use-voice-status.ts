import { useEffect, useState } from "react";
import type { VoiceRequest, VoiceStatus } from "../shared/voice.js";
export function useVoiceStatus() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const reply = await window.smallDesktop.voice.request({
          action: "status",
        });
        if (alive) {
          if (reply.ok) setStatus(reply.status);
          else setError(reply.error);
        }
      } catch {
        if (alive) setError("Голосовой ввод недоступен");
      }
      if (alive) timer = setTimeout(read, 600);
    };
    void read();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  async function request(input: VoiceRequest) {
    setError("");
    try {
      const reply = await window.smallDesktop.voice.request(input);
      if (reply.ok) setStatus(reply.status);
      else setError(reply.error);
      return reply;
    } catch {
      const reply = { ok: false as const, error: "Голосовой ввод недоступен" };
      setError(reply.error);
      return reply;
    }
  }
  return { status, error, setError, request };
}

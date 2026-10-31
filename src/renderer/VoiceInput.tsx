import { useEffect, useRef, useState } from "react";
import { Mic, Square, X, LoaderCircle } from "lucide-react";
import { captureMicrophone, type MicrophoneCapture } from "./voice-capture";
import { useVoiceStatus } from "./use-voice-status";
import "./voice.css";

type Phase = "idle" | "starting" | "recording" | "transcribing";
type RecordingJob = {
  id: string;
  controller: AbortController;
  capture?: MicrophoneCapture;
  processing: boolean;
};

export function VoiceInput({
  disabled,
  onBusy,
  onStart,
  onResult,
  chatId,
}: {
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onStart: () => void;
  onResult: (text: string) => void;
  chatId: string;
}) {
  const { status } = useVoiceStatus();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const callbacks = useRef({ onBusy, onStart, onResult });
  callbacks.current = { onBusy, onStart, onResult };
  const job = useRef<RecordingJob | null>(null);
  function cancel() {
    const active = job.current;
    job.current = null;
    if (active) {
      active.controller.abort();
      active.capture?.cancel();
      void window.smallDesktop.voice.request({
        action: "cancel",
        sessionId: active.id,
      });
    }
    setPhase("idle");
    callbacks.current.onBusy(false);
    setLevel(0);
  }
  useEffect(() => () => cancel(), [chatId]);
  useEffect(() => {
    if (phase === "idle") return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [phase]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  async function stop() {
    const active = job.current;
    if (!active?.capture || active.processing) return;
    active.processing = true;
    setPhase("transcribing");
    try {
      const pcm = await active.capture.stop();
      if (job.current !== active) return;
      const reply = await window.smallDesktop.voice.request({
        action: "transcribe",
        sessionId: active.id,
        pcm,
      });
      if (job.current !== active) return;
      if (!reply.ok) throw new Error(reply.error);
      if (reply.text) callbacks.current.onResult(reply.text);
      cancel();
    } catch (error) {
      if (job.current === active) {
        cancel();
        setError(
          error instanceof Error ? error.message : "Не удалось распознать речь",
        );
      }
    }
  }
  async function start() {
    if (job.current || disabled) return;
    const active = {
      id: crypto.randomUUID(),
      controller: new AbortController(),
      processing: false,
    } as RecordingJob;
    job.current = active;
    setError("");
    setSeconds(0);
    setPhase("starting");
    callbacks.current.onStart();
    callbacks.current.onBusy(true);
    try {
      const reply = await window.smallDesktop.voice.request({
        action: "begin",
        sessionId: active.id,
      });
      if (job.current !== active) return;
      if (!reply.ok) throw new Error(reply.error);
      active.capture = await captureMicrophone(
        status?.source ?? "default",
        active.controller.signal,
        setLevel,
        () => {
          cancel();
          setError("Микрофон отключён. Выберите источник в настройках");
        },
        () => void stop(),
      );
      if (job.current !== active) {
        active.capture.cancel();
        return;
      }
      setPhase("recording");
    } catch (error) {
      if (job.current === active) {
        cancel();
        setError(
          error instanceof DOMException
            ? "Не удалось открыть микрофон. Проверьте доступ и выбранное устройство"
            : error instanceof Error
              ? error.message
              : "Не удалось включить микрофон",
        );
      }
    }
  }
  if (status?.phase !== "ready" && phase === "idle") return null;
  return (
    <div className="speech-input">
      {phase === "idle" ? (
        <button
          type="button"
          className="speech-mic"
          aria-label="Начать голосовой ввод"
          title="Голосовой ввод · русский"
          disabled={disabled || status?.active}
          onClick={() => void start()}
        >
          <Mic size={18} />
        </button>
      ) : (
        <>
          <span className="speech-status" role="status">
            {phase === "recording"
              ? `${seconds >= 110 ? "Осталось " + (120 - seconds) + " с · " : ""}Слушаю · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
              : phase === "starting"
                ? "Подключаем…"
                : "Распознаём…"}
          </span>
          {phase === "recording" ? (
            <button
              type="button"
              className="speech-stop"
              aria-label="Остановить запись"
              onClick={() => void stop()}
            >
              <meter
                aria-label="Уровень записи"
                min={0}
                max={1}
                value={level}
              />
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <LoaderCircle size={16} aria-hidden="true" />
          )}
          <button
            type="button"
            className="speech-mic"
            aria-label="Отменить голосовой ввод"
            title="Отменить · Esc"
            onClick={cancel}
          >
            <X size={16} />
          </button>
        </>
      )}
      {error && (
        <span className="speech-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

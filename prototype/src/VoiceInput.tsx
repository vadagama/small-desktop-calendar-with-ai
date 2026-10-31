import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Check, Trash2, Mic, Square, X } from "lucide-react";
import "./voice-input.css";

type ModelState = "absent" | "downloading" | "paused" | "verifying" | "ready";
type CaptureState = "idle" | "recording" | "transcribing";
interface VoiceState {
  model: ModelState;
  setModel: (state: ModelState) => void;
  progress: number;
  reset: () => void;
  source: string;
  setSource: (source: string) => void;
  capture: CaptureState;
  setCapture: (state: CaptureState) => void;
}
const VoiceContext = createContext<VoiceState | null>(null);
export const useVoiceDemo = () => useContext(VoiceContext);

// Mounted only by the browser prototype; no microphone or network access.
export function VoiceDemoProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<ModelState>("absent");
  const [progress, setProgress] = useState(0);
  const [source, setSource] = useState("system");
  const [capture, setCapture] = useState<CaptureState>("idle");
  useEffect(() => {
    if (model !== "downloading") return;
    const timer = setInterval(
      () => setProgress((value) => Math.min(100, value + 5)),
      250,
    );
    return () => clearInterval(timer);
  }, [model]);
  useEffect(() => {
    if (progress === 100 && model === "downloading") setModel("verifying");
  }, [progress, model]);
  useEffect(() => {
    if (model !== "verifying") return;
    const timer = setTimeout(() => setModel("ready"), 700);
    return () => clearTimeout(timer);
  }, [model]);
  return (
    <VoiceContext.Provider
      value={{
        model,
        setModel,
        progress,
        source,
        setSource,
        capture,
        setCapture,
        reset: () => {
          setModel("absent");
          setProgress(0);
        },
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function VoiceSettings() {
  const voice = useVoiceDemo();
  if (!voice) return null;
  const { model, progress, setModel } = voice;
  return (
    <section className="voice-settings" aria-labelledby="voice-title">
      <h3 id="voice-title">
        <Mic size={16} />
        Голосовой ввод
      </h3>
      <p className="voice-demo-note">
        Демонстрация: скачивание и диктовка имитируются. Микрофон не
        записывается.
      </p>
      <div className="voice-model">
        <strong>Whisper large-v3-turbo</strong>
        <span>Русский · на устройстве · ≈1,62 GB</span>
      </div>
      <p>
        После установки можно диктовать запросы без интернета. Текст появится в
        поле сообщения для проверки.
      </p>
      <div
        role="status"
        className={model === "ready" ? "voice-ready-chip" : undefined}
      >
        {model === "ready" && <Check size={14} aria-hidden="true" />}
        {model === "absent" && "Модель не установлена"}
        {model === "downloading" &&
          `Скачиваем · ${progress}% · ${Math.round(progress * 16.2)} / 1620 MB`}
        {model === "paused" && "Скачивание приостановлено"}
        {model === "verifying" && "Проверяем модель…"}
        {model === "ready" && "Модель готова"}
      </div>
      {(model === "downloading" || model === "paused") && (
        <>
          <progress aria-label="Скачивание модели" value={progress} max={100} />
          <small>
            {model === "paused"
              ? `${progress}% · можно продолжить позже`
              : "Демо-прогресс · скорость и время в реальном приложении"}
          </small>
        </>
      )}
      <div className="voice-actions">
        {model === "absent" && (
          <button
            type="button"
            className="secondary"
            onClick={() => setModel("downloading")}
          >
            Скачать модель · ≈1,62 GB
          </button>
        )}
        {model === "downloading" && (
          <button
            type="button"
            className="secondary"
            onClick={() => setModel("paused")}
          >
            Пауза
          </button>
        )}
        {model === "paused" && (
          <button
            type="button"
            className="secondary"
            onClick={() => setModel("downloading")}
          >
            Продолжить
          </button>
        )}
        {(model === "paused" || model === "downloading") && (
          <button type="button" className="text-button" onClick={voice.reset}>
            Отменить скачивание
          </button>
        )}
        {model === "ready" && (
          <button
            type="button"
            className="secondary voice-remove-model"
            disabled={voice.capture !== "idle"}
            onClick={voice.reset}
          >
            <Trash2 size={14} aria-hidden="true" />
            Удалить модель
          </button>
        )}
      </div>
      <label>
        Источник звука
        <select
          value={voice.source}
          disabled={voice.capture !== "idle"}
          onChange={(event) => voice.setSource(event.target.value)}
        >
          <option value="system">Системный микрофон (демо)</option>
          <option value="builtin">Встроенный микрофон (демо)</option>
          <option value="headset">Микрофон гарнитуры (демо)</option>
        </select>
      </label>
      <small>
        Установка и выбор источника применяются сразу, до перезагрузки страницы.
      </small>
    </section>
  );
}

export function VoiceControl({
  disabled,
  onStart,
  onResult,
}: {
  disabled: boolean;
  onStart: () => void;
  onResult: (text: string) => void;
}) {
  const voice = useVoiceDemo();
  const capture = voice?.capture ?? "idle";
  const setCapture = voice?.setCapture;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => () => setCapture?.("idle"), [setCapture]);
  useEffect(() => {
    if (capture === "idle") return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCapture?.("idle");
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [capture, setCapture]);
  useEffect(() => {
    if (capture !== "recording") return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [capture]);
  useEffect(() => {
    if (capture === "recording" && seconds >= 120) setCapture?.("transcribing");
  }, [seconds, capture, setCapture]);
  useEffect(() => {
    if (capture !== "transcribing") return;
    const timer = setTimeout(() => {
      onResult("Найди 30 минут для команды завтра.");
      setCapture?.("idle");
    }, 900);
    return () => clearTimeout(timer);
  }, [capture, onResult, setCapture]);
  if (!voice || voice.model !== "ready") return null;
  return (
    <div className="voice-control">
      {capture === "idle" ? (
        <button
          type="button"
          className="voice-mic"
          aria-label="Начать голосовой ввод"
          title="Голосовой ввод · демо"
          disabled={disabled}
          onClick={() => {
            onStart();
            setSeconds(0);
            setCapture?.("recording");
          }}
        >
          <Mic size={18} />
        </button>
      ) : (
        <>
          <span className="voice-capture-status" role="status">
            {capture === "recording"
              ? `Слушаю · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
              : "Распознаём…"}
          </span>
          {capture === "recording" && (
            <button
              className="voice-stop"
              type="button"
              aria-label="Остановить запись"
              title="Остановить запись"
              onClick={() => setCapture?.("transcribing")}
            >
              <span className="voice-wave" aria-hidden="true">
                •••••
              </span>
              <Square size={13} fill="currentColor" />
            </button>
          )}
          <button
            className="voice-cancel"
            type="button"
            aria-label="Отменить голосовой ввод"
            title="Отменить · Esc"
            onClick={() => setCapture?.("idle")}
          >
            <X size={15} />
          </button>
        </>
      )}
    </div>
  );
}

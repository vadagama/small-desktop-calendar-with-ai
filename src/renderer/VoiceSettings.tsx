import { useEffect, useRef, useState } from "react";
import { Check, Download, Mic, Square, Trash2 } from "lucide-react";
import { useVoiceStatus } from "./use-voice-status";
import { captureMicrophone, type MicrophoneCapture } from "./voice-capture";
import "./voice.css";

type MicrophoneTest = {
  id: string;
  controller: AbortController;
  capture?: MicrophoneCapture;
  timer?: ReturnType<typeof setTimeout>;
};

export function VoiceSettings() {
  const { status, error, setError, request } = useVoiceStatus();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const test = useRef<MicrophoneTest | null>(null);
  const refresh = () =>
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) =>
        setDevices(
          list.filter(
            (d) =>
              d.kind === "audioinput" && d.deviceId && d.deviceId !== "default",
          ),
        ),
      )
      .catch(() => {});
  function stopTest() {
    const job = test.current;
    if (!job) return;
    test.current = null;
    job.controller.abort();
    job.capture?.cancel();
    clearTimeout(job.timer);
    void window.smallDesktop.voice.request({
      action: "cancel",
      sessionId: job.id,
    });
    setTesting(false);
    setLevel(0);
  }
  useEffect(() => {
    void refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
      stopTest();
    };
  }, []);
  async function startTest() {
    if (test.current) return;
    const job = {
      id: crypto.randomUUID(),
      controller: new AbortController(),
    } as MicrophoneTest;
    test.current = job;
    setTesting(true);
    setError("");
    try {
      const reply = await request({ action: "begin", sessionId: job.id });
      if (!reply.ok) throw new Error(reply.error);
      if (test.current !== job) return;
      job.capture = await captureMicrophone(
        status?.source ?? "default",
        job.controller.signal,
        setLevel,
        () => {
          stopTest();
          setError("Микрофон отключён");
        },
        stopTest,
      );
      if (test.current !== job) {
        job.capture.cancel();
        return;
      }
      await refresh();
      job.timer = setTimeout(stopTest, 10000);
    } catch {
      if (test.current === job) {
        stopTest();
        setError(
          "Не удалось включить микрофон. Проверьте устройство и доступ в настройках системы",
        );
      }
    }
  }
  const downloading = status?.phase === "downloading";
  const paused = status?.phase === "paused";
  const ready = status?.phase === "ready";
  return (
    <section className="speech-settings" aria-labelledby="speech-title">
      <h3 id="speech-title">
        <Mic size={16} />
        Голосовой ввод
      </h3>
      <div className="speech-model">
        <strong>Whisper large-v3-turbo</strong>
        <span>Русский · локально · 1,62 GB</span>
      </div>
      <p>
        Скачайте модель один раз. Голос распознаётся на устройстве; текст можно
        проверить перед отправкой.
      </p>
      <div role="status" className={ready ? "speech-ready" : undefined}>
        {ready ? (
          <>
            <Check size={14} aria-hidden="true" />
            Модель готова
          </>
        ) : !status ? (
          "Проверяем модель…"
        ) : status.phase === "verifying" ? (
          "Проверяем и загружаем модель…"
        ) : downloading ? (
          "Скачиваем модель…"
        ) : paused ? (
          "Скачивание приостановлено"
        ) : status.phase === "error" ? (
          "Не удалось установить модель"
        ) : (
          "Модель не установлена"
        )}
      </div>
      {status && (downloading || paused) && (
        <>
          <progress
            aria-label="Скачивание модели"
            max={status.total}
            value={status.received}
          />
          <small>
            {Math.floor((status.received / status.total) * 100)}% ·{" "}
            {Math.round(status.received / 1e6)} /{" "}
            {Math.round(status.total / 1e6)} MB
            {downloading && status.bytesPerSecond > 0
              ? ` · ${(status.bytesPerSecond / 1e6).toFixed(1)} MB/s · осталось ≈${Math.ceil((status.total - status.received) / status.bytesPerSecond / 60)} мин`
              : ""}
          </small>
        </>
      )}
      {(error || status?.error) && (
        <p className="form-error" role="alert">
          {error || status?.error}
        </p>
      )}
      {status && !status.runtimeAvailable && (
        <p className="form-error">
          Движок Whisper отсутствует. Установите полную сборку приложения.
        </p>
      )}
      <div className="speech-actions">
        {status && ["absent", "error", "paused"].includes(status.phase) && (
          <button
            type="button"
            className="secondary"
            disabled={!status.runtimeAvailable || status.active}
            onClick={() => void request({ action: "install" })}
          >
            <Download size={14} />
            {paused ? "Продолжить скачивание" : "Скачать модель · 1,62 GB"}
          </button>
        )}
        {downloading && (
          <button
            type="button"
            className="secondary"
            onClick={() => void request({ action: "pause" })}
          >
            Пауза
          </button>
        )}
        {(downloading || paused) && (
          <button
            type="button"
            className="secondary"
            onClick={() => void request({ action: "cancelDownload" })}
          >
            Отменить скачивание
          </button>
        )}
        {ready && (
          <button
            type="button"
            className="secondary"
            disabled={status.active}
            onClick={() => void request({ action: "remove" })}
          >
            <Trash2 size={14} />
            Удалить модель
          </button>
        )}
      </div>
      <label>
        Источник звука
        <select
          value={status?.source ?? "default"}
          disabled={!status || status.active}
          onChange={(e) =>
            void request({ action: "source", deviceId: e.target.value })
          }
        >
          <option value="default">Системный микрофон</option>
          {devices.map((device, i) => (
            <option value={device.deviceId} key={device.deviceId}>
              {device.label || `Микрофон ${i + 1}`}
            </option>
          ))}
          {status &&
            status.source !== "default" &&
            !devices.some((d) => d.deviceId === status.source) && (
              <option value={status.source}>
                Выбранный микрофон недоступен
              </option>
            )}
        </select>
      </label>
      <div className="speech-actions">
        <button
          type="button"
          className="secondary"
          disabled={!ready || (!!status?.active && !testing)}
          onClick={() => (testing ? stopTest() : void startTest())}
        >
          {testing ? <Square size={14} /> : <Mic size={14} />}{" "}
          {testing ? "Остановить проверку" : "Проверить микрофон"}
        </button>
        {testing && (
          <meter aria-label="Уровень микрофона" min={0} max={1} value={level} />
        )}
      </div>
      <small>
        Разрешение запрашивается при проверке или первой диктовке. Проверка
        автоматически остановится через 10 секунд.
      </small>
    </section>
  );
}

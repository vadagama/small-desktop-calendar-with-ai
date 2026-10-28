import { useChat } from "@ai-sdk/react";
import {
  ArrowUp,
  GripVertical,
  Settings2,
  Sparkles,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DesktopTransport } from "./transport";
import { MessageList } from "./MessageList";
import { ModelSettings } from "./ModelSettings";
import type { ProfileState } from "../shared/profiles.js";

export function DesktopAssistant({ swap }: { swap: () => void }) {
  const [transport] = useState(
    () => new DesktopTransport(window.smallDesktop.assistant),
  );
  const [input, setInput] = useState("");
  const [stopped, setStopped] = useState(false);
  const [profiles, setProfiles] = useState<ProfileState | null>(null);
  const [profileError, setProfileError] = useState("");
  const [settings, setSettings] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    transport,
    onFinish: ({ isAbort }) => {
      if (isAbort) setStopped(true);
    },
  });
  useEffect(() => {
    let mounted = true;
    void window.smallDesktop.profiles
      .read()
      .then((reply) => {
        if (!mounted) return;
        if (reply.ok) setProfiles(reply.state);
        else setProfileError(reply.error);
      })
      .catch(() => {
        if (mounted) setProfileError("Не удалось прочитать настройки модели");
      });
    return () => {
      mounted = false;
    };
  }, []);
  const activeProfile = profiles?.profiles.find(
    (profile) => profile.id === profiles.active,
  );
  const local = profiles?.active === "synthetic";
  const modelLabel =
    activeProfile?.modelId ??
    (local ? "Локальная проверка" : "Загрузка профиля…");
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => () => transport.close(), [transport]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages, error, status, stopped]);
  function send() {
    if (busy || !profiles || !input.trim()) return;
    clearError();
    setStopped(false);
    const text = input.trim();
    setInput("");
    void sendMessage({ text });
  }
  return (
    <section
      className="desktop-assistant assistant-panel"
      aria-label="AI-ассистент"
    >
      <div
        className="panel-caption"
        draggable
        onDragStart={(event) =>
          event.dataTransfer.setData("text/plain", "assistant")
        }
        onDoubleClick={swap}
      >
        <span>
          <GripVertical size={14} />
          Ассистент
        </span>
        <span className="subtle model-name" title={modelLabel}>
          {modelLabel}
        </span>
        <button
          className="icon-button"
          aria-label="Настройки модели"
          disabled={!profiles}
          onClick={() => setSettings(true)}
        >
          <Settings2 size={18} />
        </button>
      </div>
      <div className="assistant-scroll" ref={scroll}>
        {!messages.length && (
          <div className="assistant-intro">
            <span className="assistant-mark">
              <Sparkles size={25} />
            </span>
            <h2>Проверим диалог?</h2>
            <p>
              Напишите «Сложи 2 и 3». Ассистент покажет ход вычисления и ответ.
              {local
                ? "Модель синтетическая."
                : activeProfile
                  ? `Выбрана ${activeProfile.modelId}.`
                  : "Загружаю настройки."}{" "}
              Календарь ещё не подключён.
            </p>
          </div>
        )}
        <MessageList messages={messages} />
        <p role="status" className="tool-status">
          {stopped
            ? "Запрос остановлен"
            : status === "submitted"
              ? "Запускаю ассистента…"
              : status === "streaming"
                ? "Получаю ответ…"
                : "Жду сообщение"}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}
      </div>
      <div className="composer-area">
        {profileError && (
          <p className="form-error" role="alert">
            {profileError}
          </p>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            aria-label="Сообщение ассистенту"
            placeholder="Например, сложи 2 и 3…"
            rows={2}
            value={input}
            maxLength={2000}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div>
            <span>
              <Sparkles size={13} />
              {local
                ? "Синтетическая модель"
                : activeProfile
                  ? activeProfile.modelId
                  : "Загрузка…"}
            </span>
            {busy ? (
              <button
                type="button"
                aria-label="Остановить ответ"
                onClick={() => {
                  setStopped(true);
                  void stop();
                }}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Отправить сообщение"
                disabled={!profiles || !input.trim()}
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </form>
        <p>
          {local ? "Локальная проверка" : "Выбранный LLM-профиль"} · без
          календарных операций
        </p>
      </div>
      {settings && profiles && (
        <ModelSettings
          initial={profiles}
          update={setProfiles}
          close={() => setSettings(false)}
        />
      )}
    </section>
  );
}

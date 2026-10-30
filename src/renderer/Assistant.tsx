import {
  AssistantPresentation,
  TemplateMarkdown,
} from "./AssistantPresentation";
import type { AssistantTemplates } from "../shared/agent-settings.js";
import type { AgentSettingsState } from "../shared/agent-settings.js";
import { createPortal } from "react-dom";
import { useChat } from "@ai-sdk/react";
import { ArrowUp, Settings2, Sparkles, Square, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DesktopTransport } from "./transport";
import { MessageList } from "./MessageList";
import { ModelSettings } from "./ModelSettings";
import type { ProfileState } from "../shared/profiles.js";

export function DesktopAssistant({
  swap,
  headerTarget,
}: {
  swap: () => void;
  headerTarget: HTMLElement | null;
}) {
  const [promptTemplates, setPromptTemplates] = useState<string[]>([]);
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [templates, setTemplates] = useState<AssistantTemplates | null>(null);
  const [transport] = useState(
    () => new DesktopTransport(window.smallDesktop.assistant),
  );
  const [input, setInput] = useState("");
  const [stopped, setStopped] = useState(false);
  const [profiles, setProfiles] = useState<ProfileState | null>(null);
  const [profileError, setProfileError] = useState("");
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const update = (event: Event) => {
      const state = (event as CustomEvent<AgentSettingsState>).detail;
      setTemplates(state.templates);
      setPromptTemplates(state.settings.promptTemplates ?? []);
    };
    window.addEventListener("small:agent-settings-changed", update);
    return () =>
      window.removeEventListener("small:agent-settings-changed", update);
  }, []);
  const scroll = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    transport,
    id: chatId,
    onFinish: ({ isAbort }) => {
      if (isAbort) setStopped(true);
    },
  });
  useEffect(() => {
    let mounted = true;
    void window.smallDesktop.agentSettings
      .read()
      .then((reply) => {
        if (mounted && reply.ok) {
          setTemplates(reply.state.templates);
          setPromptTemplates(reply.state.settings.promptTemplates ?? []);
        }
      })
      .catch(() => {});
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
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => () => transport.close(), [transport]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages, error, status, stopped]);
  function choose(text: string) {
    if (busy || !profiles || !text.trim()) return;
    clearError();
    setStopped(false);
    void sendMessage({ text });
  }
  function send() {
    if (busy || !profiles || !input.trim()) return;
    const text = input.trim();
    setInput("");
    choose(text);
  }
  return (
    <AssistantPresentation.Provider
      value={{ templates, choose, disabled: busy || !profiles }}
    >
      <section
        className="desktop-assistant assistant-panel"
        aria-label="AI-ассистент"
      >
        {headerTarget &&
          createPortal(
            <div className="assistant-header-actions" onDoubleClick={swap}>
              <button
                className="icon-button"
                aria-label="Новый диалог"
                disabled={busy}
                onClick={() => setChatId(crypto.randomUUID())}
              >
                <RotateCcw size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Настройки модели"
                disabled={!profiles}
                onClick={() => setSettings(true)}
              >
                <Settings2 size={18} />
              </button>
            </div>,
            headerTarget,
          )}
        <div className="assistant-scroll" ref={scroll}>
          {!messages.length && (
            <div className="assistant-intro">
              <span className="assistant-mark">
                <Sparkles size={25} />
              </span>
              <TemplateMarkdown name="welcome" />
              <div className="assistant-suggestions">
                {promptTemplates.map((text, index) => (
                  <button
                    type="button"
                    key={index}
                    disabled={busy || !profiles}
                    onClick={() => choose(text)}
                  >
                    {text}
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  window.dispatchEvent(new Event("small:open-ai-settings"))
                }
              >
                Настроить шаблоны
              </button>
              {local && (
                <p className="form-note">
                  Выберите модель и войдите в Small для работы с календарём.
                </p>
              )}
            </div>
          )}
          <MessageList messages={messages} busy={busy} />
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
              placeholder="Например, встреча завтра после обеда с Олегом и Витей…"
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
        </div>
        {settings && profiles && (
          <ModelSettings
            initial={profiles}
            update={setProfiles}
            close={() => setSettings(false)}
          />
        )}
      </section>
    </AssistantPresentation.Provider>
  );
}

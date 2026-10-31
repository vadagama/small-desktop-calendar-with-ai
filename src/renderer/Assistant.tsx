import { VoiceInput } from "./VoiceInput";
import { notifyInfo } from "./notification-events";
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
import { ModelPicker } from "./ModelPicker";
import { ModelSettings } from "./ModelSettings";
import type { ProfileState } from "../shared/profiles.js";

export function DesktopAssistant({
  swap,
  headerTarget,
  helpPrompt,
  onHelpPromptApplied,
}: {
  swap: () => void;
  headerTarget: HTMLElement | null;
  helpPrompt?: { id: string; text: string };
  onHelpPromptApplied?: () => void;
}) {
  const [promptTemplates, setPromptTemplates] = useState<string[]>([]);
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const [templates, setTemplates] = useState<AssistantTemplates | null>(null);
  const [transport] = useState(
    () => new DesktopTransport(window.smallDesktop.assistant),
  );
  const [voiceBusy, setVoiceBusy] = useState(false);
  const voiceSelection = useRef({ start: 0, end: 0 });
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const appliedPrompt = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!helpPrompt || appliedPrompt.current === helpPrompt.id) return;
    appliedPrompt.current = helpPrompt.id;
    const next = input.trim()
      ? `${input}\n${helpPrompt.text}`
      : helpPrompt.text;
    if (next.length > 2000) {
      notifyInfo(
        "В поле ввода недостаточно места для примера. Сократите черновик и подставьте запрос из помощи ещё раз.",
      );
    } else {
      setInput(next);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
    onHelpPromptApplied?.();
  }, [helpPrompt, onHelpPromptApplied]);
  const [stopped, setStopped] = useState(false);
  const [profiles, setProfiles] = useState<ProfileState | null>(null);
  const [profileError, setProfileError] = useState("");
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    const open = () => setSettings(true);
    window.addEventListener("small:open-model-settings", open);
    return () => window.removeEventListener("small:open-model-settings", open);
  }, []);
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
  const local = profiles?.active === "synthetic";
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => () => transport.close(), [transport]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages, error, status, stopped]);
  function choose(text: string) {
    if (busy || voiceBusy || !profiles || !text.trim()) return;
    clearError();
    setStopped(false);
    void sendMessage({ text });
  }
  function send() {
    if (busy || voiceBusy || !profiles || !input.trim()) return;
    if (input.length > 2000) {
      notifyInfo("Сократите сообщение до 2000 символов перед отправкой");
      return;
    }
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
                disabled={busy || voiceBusy}
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
                  Выберите модель для работы ассистента.
                </p>
              )}
            </div>
          )}
          <MessageList messages={messages} busy={busy} />
          <p
            role="status"
            aria-label="Состояние ответа ассистента"
            className="tool-status"
          >
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
          {input.length > 2000 && (
            <p role="alert">
              Текст сохранён полностью. Сократите его до 2000 символов перед
              отправкой.
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
              ref={inputRef}
              aria-label="Сообщение ассистенту"
              placeholder="Например, встреча завтра после обеда с Олегом и Витей…"
              rows={2}
              value={input}
              readOnly={voiceBusy}
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
              <ModelPicker
                state={profiles}
                disabled={busy}
                update={setProfiles}
                onError={setProfileError}
              />
              <VoiceInput
                disabled={busy}
                chatId={chatId}
                onBusy={setVoiceBusy}
                onStart={() => {
                  const field = inputRef.current;
                  voiceSelection.current = {
                    start: field?.selectionStart ?? input.length,
                    end: field?.selectionEnd ?? input.length,
                  };
                }}
                onResult={(text) => {
                  const { start, end } = voiceSelection.current;
                  setInput(
                    (current) =>
                      current.slice(0, start) + text + current.slice(end),
                  );
                  inputRef.current?.focus();
                }}
              />
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
                  disabled={
                    voiceBusy ||
                    !profiles ||
                    !input.trim() ||
                    input.length > 2000
                  }
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

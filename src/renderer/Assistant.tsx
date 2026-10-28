import { useChat } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import { ArrowUp, GripVertical, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DesktopTransport } from "./transport";

function sumLabel(output: unknown) {
  return typeof output === "object" &&
    output !== null &&
    "sum" in output &&
    typeof output.sum === "number" &&
    Number.isFinite(output.sum)
    ? String(output.sum)
    : "Результат недоступен";
}

export function DesktopAssistant({ swap }: { swap: () => void }) {
  const [transport] = useState(
    () => new DesktopTransport(window.smallDesktop.assistant),
  );
  const [input, setInput] = useState("");
  const [stopped, setStopped] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    transport,
  });
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => () => transport.close(), [transport]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages, error, status, stopped]);
  function send() {
    if (busy || !input.trim()) return;
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
        <span className="subtle">Локальная проверка</span>
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
              Модель синтетическая, календарь ещё не подключён.
            </p>
          </div>
        )}
        <div className="messages" role="log" aria-live="polite">
          {messages.map((message) => (
            <div className={`message ${message.role}`} key={message.id}>
              {message.role === "assistant" && (
                <span className="message-icon">
                  <Sparkles size={15} />
                </span>
              )}
              <div>
                {message.parts.map((part, index) => {
                  if (part.type === "text")
                    return <span key={index}>{part.text}</span>;
                  if (isToolUIPart(part))
                    return (
                      <div
                        className="draft-card sdk-tool"
                        key={part.toolCallId}
                        data-tool-state={part.state}
                      >
                        <strong>Сложение чисел</strong>
                        {part.state === "input-streaming" && (
                          <p>Получаю параметры…</p>
                        )}
                        {part.state === "input-available" && <p>Вычисляю…</p>}
                        {part.state === "output-available" && (
                          <p>Сумма: {sumLabel(part.output)}</p>
                        )}
                        {part.state === "output-error" && (
                          <p>
                            Не удалось вычислить: проверьте, что введены два
                            целых числа от −1 000 000 до 1 000 000.
                          </p>
                        )}
                      </div>
                    );
                  return null;
                })}
              </div>
            </div>
          ))}
        </div>
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
              Синтетическая модель
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
                disabled={!input.trim()}
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </form>
        <p>Локальный режим · без календарных операций</p>
      </div>
    </section>
  );
}

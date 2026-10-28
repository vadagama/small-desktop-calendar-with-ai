import { isToolUIPart, type UIMessage } from "ai";
import { Sparkles } from "lucide-react";

function sumLabel(output: unknown) {
  return typeof output === "object" &&
    output !== null &&
    "sum" in output &&
    typeof output.sum === "number" &&
    Number.isFinite(output.sum)
    ? String(output.sum)
    : "Результат недоступен";
}

export function MessageList({ messages }: { messages: UIMessage[] }) {
  return (
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
                        Не удалось вычислить: проверьте, что введены два целых
                        числа от −1 000 000 до 1 000 000.
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
  );
}

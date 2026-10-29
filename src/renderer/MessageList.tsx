import { CalendarToolResult } from "./CalendarToolResult";
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
              if (isToolUIPart(part)) {
                const calendar =
                  part.type === "tool-searchPeople" ||
                  part.type === "tool-findSlots" ||
                  part.type === "tool-prepareMeetingDraft";
                return (
                  <div
                    className="draft-card sdk-tool"
                    key={part.toolCallId}
                    data-tool-state={part.state}
                  >
                    <strong>
                      {part.type === "tool-searchPeople"
                        ? "Поиск сотрудников"
                        : part.type === "tool-findSlots"
                          ? "Общее время"
                          : part.type === "tool-prepareMeetingDraft"
                            ? "Черновик встречи"
                            : "Сложение чисел"}
                    </strong>
                    {part.state === "input-streaming" && (
                      <p>Получаю параметры…</p>
                    )}
                    {part.state === "input-available" && (
                      <p>{calendar ? "Проверяю данные Small…" : "Вычисляю…"}</p>
                    )}
                    {part.state === "output-available" &&
                      (calendar ? (
                        <CalendarToolResult output={part.output} />
                      ) : (
                        <p>Сумма: {sumLabel(part.output)}</p>
                      ))}
                    {part.state === "output-error" && (
                      <p>
                        {calendar
                          ? "Не удалось выполнить запрос. Уточните параметры и повторите."
                          : "Не удалось вычислить: проверьте, что введены два целых числа от −1 000 000 до 1 000 000."}
                      </p>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

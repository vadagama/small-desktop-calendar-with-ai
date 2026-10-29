import {
  AssistantMarkdown,
  AssistantPresentation,
  useAssistantPresentation,
} from "./AssistantPresentation";
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

export function MessageList({
  messages,
  busy = false,
}: {
  messages: UIMessage[];
  busy?: boolean;
}) {
  const presentation = useAssistantPresentation();
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
              if (
                part.type === "text" &&
                message.parts.some(
                  (item) =>
                    isToolUIPart(item) &&
                    item.type === "tool-prepareMeetingDraft" &&
                    item.state === "output-available" &&
                    typeof item.output === "object" &&
                    item.output !== null &&
                    "ok" in item.output &&
                    item.output.ok === true,
                )
              )
                return null;
              if (part.type === "text")
                return (
                  <AssistantMarkdown key={index}>{part.text}</AssistantMarkdown>
                );
              if (isToolUIPart(part)) {
                if (part.type === "tool-searchPeople") return null;
                if (
                  [
                    "tool-loadSkill",
                    "tool-loadReference",
                    "tool-selectParticipants",
                    "tool-participantMemory",
                  ].includes(part.type)
                ) {
                  return (
                    <details
                      className="assistant-tool-detail"
                      key={part.toolCallId}
                    >
                      <summary>
                        {part.type === "tool-loadSkill"
                          ? "Навык"
                          : part.type === "tool-loadReference"
                            ? "Справочник"
                            : part.type === "tool-selectParticipants"
                              ? "Участники"
                              : "Память участников"}{" "}
                        ·{" "}
                        {part.state === "output-available"
                          ? "Обработано"
                          : part.state === "output-error"
                            ? "Ошибка"
                            : "Выполняется"}
                      </summary>
                      {part.state === "output-available" && (
                        <p>
                          {typeof part.output === "object" &&
                          part.output &&
                          "error" in part.output
                            ? String(part.output.error)
                            : "Результат передан ассистенту."}
                        </p>
                      )}
                    </details>
                  );
                }
                const calendar =
                  part.type === "tool-findSlots" ||
                  part.type === "tool-prepareMeetingDraft";
                if (
                  calendar &&
                  (part.state === "input-streaming" ||
                    part.state === "input-available")
                )
                  return null;
                return (
                  <div
                    className={
                      part.type === "tool-prepareMeetingDraft"
                        ? "sdk-tool assistant-draft-tool"
                        : "draft-card sdk-tool"
                    }
                    key={part.toolCallId}
                    data-tool-state={part.state}
                  >
                    {part.type !== "tool-prepareMeetingDraft" && (
                      <strong>
                        {part.type === "tool-findSlots"
                          ? "Общее время"
                          : part.type === "tool-prepareMeetingDraft"
                            ? "Черновик встречи"
                            : "Сложение чисел"}
                      </strong>
                    )}
                    {part.state === "input-streaming" && (
                      <p>Получаю параметры…</p>
                    )}
                    {part.state === "input-available" && <p>Вычисляю…</p>}
                    {part.state === "output-available" &&
                      (calendar ? (
                        <AssistantPresentation.Provider
                          value={{
                            ...presentation,
                            disabled:
                              presentation.disabled ||
                              busy ||
                              message.id !== messages.at(-1)?.id,
                          }}
                        >
                          <CalendarToolResult output={part.output} />
                        </AssistantPresentation.Provider>
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

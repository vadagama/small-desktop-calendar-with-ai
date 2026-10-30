import {
  AssistantMarkdown,
  AssistantPresentation,
  useAssistantPresentation,
} from "./AssistantPresentation";
import { CalendarToolResult } from "./CalendarToolResult";
import { AnalyticsCard } from "./AnalyticsCard";
import { ToolContext, SearchActivity } from "./ToolContext";
import { groupSearchActivity } from "./search-activity";
import { MemoryToolResult } from "./MemoryChangeCard";
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
            {groupSearchActivity(message.parts).map((part, index, parts) => {
              if (Array.isArray(part))
                return (
                  <SearchActivity
                    key={part[0]!.toolCallId}
                    parts={part}
                    active={
                      busy &&
                      message.id === messages.at(-1)?.id &&
                      index === parts.length - 1
                    }
                  />
                );
              if (
                part.type === "text" &&
                message.parts.some(
                  (item) =>
                    isToolUIPart(item) &&
                    [
                      "tool-prepareMeetingDraft",
                      "tool-prepareMeetingDeletion",
                    ].includes(item.type) &&
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
                if (
                  part.type === "tool-assistantMemory" ||
                  part.type === "tool-participantMemory"
                ) {
                  return (
                    <div key={part.toolCallId}>
                      <ToolContext part={part} />
                      {part.state === "output-available" && (
                        <MemoryToolResult
                          output={part.output}
                          disabled={busy}
                        />
                      )}
                    </div>
                  );
                }
                if (
                  [
                    "tool-searchPeople",
                    "tool-listMeetings",
                    "tool-loadSkill",
                    "tool-loadReference",
                    "tool-selectParticipants",
                  ].includes(part.type)
                )
                  return <ToolContext key={part.toolCallId} part={part} />;
                if (part.type === "tool-meetingAnalytics") {
                  if (part.state === "output-available")
                    return (
                      <div key={part.toolCallId}>
                        <ToolContext part={part} />
                        <AnalyticsCard output={part.output} />
                      </div>
                    );
                  return (
                    <div key={part.toolCallId}>
                      <ToolContext part={part} />
                      <p className="analytics-pending">
                        {part.state === "output-error"
                          ? "Не удалось построить отчёт. Уточните период и повторите."
                          : "Считаю аналитику…"}
                      </p>
                    </div>
                  );
                }
                const calendar =
                  part.type === "tool-findSlots" ||
                  part.type === "tool-prepareMeetingDraft" ||
                  part.type === "tool-prepareMeetingDeletion";
                if (
                  calendar &&
                  (part.state === "input-streaming" ||
                    part.state === "input-available")
                )
                  return <ToolContext key={part.toolCallId} part={part} />;
                return (
                  <div
                    className={
                      [
                        "tool-prepareMeetingDraft",
                        "tool-prepareMeetingDeletion",
                      ].includes(part.type)
                        ? "sdk-tool assistant-draft-tool"
                        : "draft-card sdk-tool"
                    }
                    key={part.toolCallId}
                    data-tool-state={part.state}
                  >
                    <ToolContext part={part} />
                    {![
                      "tool-prepareMeetingDraft",
                      "tool-prepareMeetingDeletion",
                    ].includes(part.type) && (
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

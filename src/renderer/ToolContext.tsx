import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { searchActivityStatus } from "./search-activity";

const labels: Record<string, string> = {
  loadSkill: "Навык",
  loadReference: "Справочник",
  searchPeople: "Поиск участников",
  selectParticipants: "Участники",
  participantMemory: "Память участников",
  assistantMemory: "Память",
  listMeetings: "Расписание",
  findSlots: "Общее время",
  meetingAnalytics: "Аналитика",
  prepareMeetingDraft: "Подготовка встречи",
  prepareMeetingDeletion: "Подготовка удаления",
};

function format(value: unknown) {
  if (value === undefined) return "Нет данных.";
  if (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    "content" in value &&
    typeof value.content === "string"
  )
    return value.content;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function ToolContext({
  part,
}: {
  part: ToolUIPart | DynamicToolUIPart;
}) {
  const name =
    part.type === "dynamic-tool" ? part.toolName : part.type.slice(5);
  const failed =
    part.state === "output-error" ||
    (part.state === "output-available" &&
      typeof part.output === "object" &&
      part.output !== null &&
      "ok" in part.output &&
      part.output.ok === false);
  return (
    <details className="assistant-tool-detail">
      <summary>
        {labels[name] ?? name} ·{" "}
        {failed
          ? "Ошибка"
          : part.state === "output-available"
            ? "Обработано"
            : "Выполняется"}
      </summary>
      <p>Команда: {name}</p>
      <p>Параметры</p>
      <pre>{format(part.input)}</pre>
      {part.state === "output-available" && (
        <>
          <p>Результат</p>
          <pre>{format(part.output)}</pre>
        </>
      )}
      {part.state === "output-error" && (
        <>
          <p>Ошибка</p>
          <pre>{part.errorText}</pre>
        </>
      )}
    </details>
  );
}

export function SearchActivity({
  parts,
  active,
}: {
  parts: (ToolUIPart | DynamicToolUIPart)[];
  active: boolean;
}) {
  return (
    <details className="assistant-tool-detail assistant-search-group">
      <summary>
        Поиск участников · {searchActivityStatus(parts, active)} · Шагов:{" "}
        {parts.length}
      </summary>
      <div className="assistant-search-steps">
        {parts.map((part) => (
          <ToolContext key={part.toolCallId} part={part} />
        ))}
      </div>
    </details>
  );
}

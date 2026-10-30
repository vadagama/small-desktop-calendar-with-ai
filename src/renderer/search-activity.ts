import {
  isToolUIPart,
  type UIMessage,
  type ToolUIPart,
  type DynamicToolUIPart,
} from "ai";

type ToolPart = ToolUIPart | DynamicToolUIPart;

export function groupSearchActivity(parts: UIMessage["parts"]) {
  const grouped: (UIMessage["parts"][number] | ToolPart[])[] = [];
  for (const part of parts) {
    if (part.type === "step-start") continue;
    const name = isToolUIPart(part)
      ? part.type === "dynamic-tool"
        ? part.toolName
        : part.type.slice(5)
      : null;
    if (
      isToolUIPart(part) &&
      (name === "searchPeople" || name === "selectParticipants")
    ) {
      const previous = grouped.at(-1);
      if (Array.isArray(previous)) previous.push(part);
      else grouped.push([part]);
    } else grouped.push(part);
  }
  return grouped;
}

export function searchActivityStatus(parts: ToolPart[], active: boolean) {
  if (active) return "Выполняется";
  const last = parts.at(-1);
  if (
    !last ||
    !["output-available", "output-error", "output-denied"].includes(last.state)
  )
    return "Прерван";
  if (
    last.state !== "output-available" ||
    (typeof last.output === "object" &&
      last.output !== null &&
      "ok" in last.output &&
      last.output.ok === false)
  )
    return "Не завершён";
  return "Завершён";
}

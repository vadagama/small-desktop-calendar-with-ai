import { useEffect, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { z } from "zod";
import { memoryChange, type MemoryChange } from "../shared/assistant-memory.js";

const proposal = z.object({
  ok: z.literal(true),
  data: z.object({
    kind: z.literal("memory-proposal"),
    id: z.uuid(),
    change: memoryChange,
    label: z.string().optional(),
    groupName: z.string().optional(),
  }),
});
export function MemoryToolResult({
  output,
  disabled,
}: {
  output: unknown;
  disabled: boolean;
}) {
  const parsed = proposal.safeParse(output);
  if (parsed.success)
    return (
      <MemoryChangeCard
        id={parsed.data.data.id}
        change={parsed.data.data.change}
        label={parsed.data.data.label}
        groupName={parsed.data.data.groupName}
        disabled={disabled}
      />
    );
  if (
    typeof output === "object" &&
    output !== null &&
    "ok" in output &&
    output.ok === false &&
    "error" in output
  )
    return <p role="alert">{String(output.error)}</p>;
  return null;
}
const labels: Record<string, string> = {
  durationMinutes: "Длительность, минут",
  timeFrom: "Предлагать с",
  timeTo: "Предлагать до",
  bufferMinutes: "Перерыв, минут",
  entries: "Сохранённый контекст",
  groups: "Группы",
  presets: "Форматы",
  preferences: "Предпочтения",
  all: "Вся память",
};
function MemoryChangeCard({
  id,
  change,
  disabled,
  label,
  groupName,
}: {
  label?: string;
  groupName?: string;
  id: string;
  change: MemoryChange;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <div className="draft-card memory-proposal">
      <strong>
        <Brain size={16} /> Изменение памяти
      </strong>
      {change.action === "entry" ? (
        <p>{change.text}</p>
      ) : change.action === "preferences" ? (
        <>
          <p>Предпочтения встреч:</p>
          <dl>
            {Object.entries(change.value).map(([key, value]) => (
              <div key={key}>
                <dt>{labels[key]}</dt>
                <dd>{value === null ? "Сбросить" : value}</dd>
              </div>
            ))}
          </dl>
          <p>Остальные предпочтения сохранятся.</p>
        </>
      ) : change.action === "clear" ? (
        <p>Очистить: {labels[change.category]}. Встречи сохранятся.</p>
      ) : change.action === "delete" ? (
        <p>
          Удалить из категории «{labels[change.category]}»:{" "}
          {label ?? "выбранную запись"}.
        </p>
      ) : (
        <>
          <p>
            {change.action === "group" ? "Группа" : "Формат"}:{" "}
            <strong>{change.value.name}</strong>
          </p>
          <p>
            {change.value.people?.map((p) => p.name).join(", ") ??
              "Состав будет заново проверен перед использованием"}
          </p>
          {change.action === "preset" && (
            <>
              <p>{change.value.title}</p>
              <p>
                {change.value.durationMinutes
                  ? `${change.value.durationMinutes} минут`
                  : "Длительность из предпочтений"}
              </p>
              <p>{change.value.agenda}</p>
              {change.value.groupId && (
                <p>Группа: {groupName ?? "Сохранённая группа"}</p>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {saved ? (
        <p role="status">Изменение сохранено в памяти.</p>
      ) : (
        <button
          className="primary"
          disabled={disabled || busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              const reply = await window.smallDesktop.memory.confirm({ id });
              if (alive.current) {
                if (reply.ok) setSaved(true);
                else setError(reply.error);
              }
            } catch {
              if (alive.current)
                setError(
                  "Не удалось сохранить память. Повторите подтверждение.",
                );
            } finally {
              if (alive.current) setBusy(false);
            }
          }}
        >
          {busy ? "Сохраняю…" : "Подтвердить изменение памяти"}
        </button>
      )}
    </div>
  );
}

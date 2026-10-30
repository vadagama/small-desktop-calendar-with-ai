import { useState } from "react";
import {
  Plus,
  PencilLine,
  Trash2,
  UsersRound,
  CalendarDays,
} from "lucide-react";
import { MeetingPeoplePicker } from "./MeetingPeoplePicker";
import { useAvailability } from "./useAvailability";
import type {
  AssistantMemoryState,
  MemoryChange,
  MemoryGroup,
  MemoryPreset,
} from "../shared/assistant-memory.js";

function CollectionEditor({
  category,
  item,
  state,
  accountId,
  save,
  cancel,
}: {
  category: "groups" | "presets";
  item?: MemoryGroup | MemoryPreset;
  state: AssistantMemoryState;
  accountId: string;
  save: (change: MemoryChange) => Promise<boolean>;
  cancel: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const preset = item as MemoryPreset | undefined;
  const [title, setTitle] = useState(preset?.title ?? "");
  const [agenda, setAgenda] = useState(preset?.agenda ?? "");
  const [duration, setDuration] = useState(
    preset?.durationMinutes?.toString() ?? "",
  );
  const [groupId, setGroup] = useState(preset?.groupId ?? "");
  const [error, setError] = useState("");
  const people = useAvailability(
    accountId,
    () => setError("Аккаунт изменился. Откройте память заново."),
    item?.people ??
      state.participants.filter((p) =>
        item?.participantIds?.includes(p.participantId),
      ),
  );
  return (
    <form
      className="memory-editor memory-collection-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        if (category === "groups" && !people.selected.length) {
          setError("Выберите участников из каталога.");
          return;
        }
        const members = {
          participantIds: people.selected.map((p) => p.participantId),
          people: people.selected,
        };
        const change: MemoryChange =
          category === "groups"
            ? {
                action: "group",
                ...(item ? { id: item.id } : {}),
                value: { name, ...members },
              }
            : {
                action: "preset",
                ...(item ? { id: item.id } : {}),
                value: {
                  name,
                  ...(title.trim() ? { title: title.trim() } : {}),
                  ...(agenda ? { agenda } : {}),
                  ...(duration ? { durationMinutes: Number(duration) } : {}),
                  ...(groupId
                    ? { groupId }
                    : people.selected.length
                      ? members
                      : {}),
                },
              };
        if (await save(change)) cancel();
      }}
    >
      <label>
        Название {category === "groups" ? "группы" : "формата"}
        <input
          autoFocus
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {category === "presets" && (
        <>
          <label>
            Название встречи
            <input
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Длительность формата, минут
            <input
              type="number"
              min={1}
              max={480}
              value={duration}
              placeholder="Из предпочтений"
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <label>
            Группа участников
            <select
              aria-label="Группа участников"
              value={groupId}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">Выбрать отдельных участников</option>
              {state.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
              {groupId && !state.groups.some((g) => g.id === groupId) && (
                <option value={groupId}>
                  Группа удалена — выберите состав заново
                </option>
              )}
            </select>
          </label>
          <label>
            Шаблон повестки
            <textarea
              rows={3}
              maxLength={8000}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
            />
          </label>
          <p className="memory-hint">
            Дата выбирается при использовании. Формат не создаёт повторяющуюся
            серию.
          </p>
        </>
      )}
      {!groupId && <MeetingPeoplePicker data={people} label="участников" />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-actions">
        <button className="primary" type="submit">
          Сохранить {category === "groups" ? "группу" : "формат"}
        </button>
        <button className="secondary" type="button" onClick={cancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function MemoryCollections({
  category,
  state,
  accountId,
  save,
  sourceLabel,
}: {
  category: "groups" | "presets";
  state: AssistantMemoryState;
  accountId: string;
  save: (change: MemoryChange) => Promise<boolean>;
  sourceLabel: (value: MemoryGroup | MemoryPreset) => string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const items = state[category];
  const isGroup = category === "groups";
  return (
    <section
      className="memory-section"
      aria-label={isGroup ? "Группы участников" : "Форматы встреч"}
    >
      <div className="memory-section-heading">
        <h3>
          {isGroup ? <UsersRound size={16} /> : <CalendarDays size={16} />}{" "}
          {isGroup ? "Группы участников" : "Форматы встреч"}{" "}
          <span className="memory-count">{items.length}</span>
        </h3>
        <button
          className="text-button memory-add"
          onClick={() => setEditing("new")}
        >
          <Plus size={14} />
          {isGroup ? "Добавить группу" : "Добавить формат"}
        </button>
      </div>
      <p className="memory-hint">
        {isGroup
          ? "Именованные составы. Перед встречей каждый участник проверяется в каталоге."
          : "Привычные название, состав, длительность и повестка встречи."}
      </p>
      {editing && (
        <CollectionEditor
          key={editing}
          category={category}
          item={items.find((i) => i.id === editing)}
          state={state}
          accountId={accountId}
          save={save}
          cancel={() => setEditing(null)}
        />
      )}
      {!items.length && !editing && (
        <p className="memory-collection-empty">
          {isGroup
            ? "Пока нет сохранённых групп"
            : "Пока нет сохранённых форматов"}
        </p>
      )}
      <ul className="memory-entries">
        {items.map((item, index) => (
          <li key={item.id}>
            <div className="memory-entry-content">
              <strong>{item.name}</strong>
              <p>
                {"groupId" in item && item.groupId
                  ? `Группа: ${state.groups.find((g) => g.id === item.groupId)?.name ?? "удалена — исправьте формат"}`
                  : `Участников: ${item.participantIds?.length ?? 0}`}
                {"durationMinutes" in item && item.durationMinutes
                  ? ` · ${item.durationMinutes} мин`
                  : ""}
              </p>
              <small>{sourceLabel(item)}</small>
            </div>
            <div className="memory-entry-actions">
              <button
                className="icon-button"
                aria-label={`Изменить ${isGroup ? "группу" : "формат"} ${index + 1}`}
                onClick={() => setEditing(item.id)}
              >
                <PencilLine size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`Удалить ${isGroup ? "группу" : "формат"} ${index + 1}`}
                onClick={() =>
                  void save({ action: "delete", category, id: item.id })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

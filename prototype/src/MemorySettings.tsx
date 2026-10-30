import { useState } from "react";
import { Clock3, HardDrive, Trash2 } from "lucide-react";
import { Modal } from "./Dialogs";
import { MemoryPreferences, emptyPreferences } from "./MemoryPreferences";
import type { PreferenceKey } from "./MemoryPreferences";
import { MemoryEntries } from "./MemoryEntries";
import type { DemoMemory } from "./memory-demo";
import "./memory-settings.css";

export function MemorySettings({
  memory,
  change,
  close,
}: {
  memory: DemoMemory;
  change: (memory: DemoMemory) => void;
  close: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState("");
  const { preferences: p, sources } = memory;
  const hasMemory = Object.values(p).some(Boolean) || memory.entries.length > 0;
  const rows = [
    {
      title: "Длительность встречи",
      value: p.duration ? `${p.duration} минут` : "Не задано",
      source: sources.duration,
    },
    {
      title: "Предпочтительное время",
      value:
        p.from && p.to
          ? `${p.from}–${p.to}`
          : p.from
            ? `После ${p.from}`
            : p.to
              ? `До ${p.to}`
              : "Не задано",
      source: [
        ...new Set(
          [p.from && sources.from, p.to && sources.to].filter(Boolean),
        ),
      ].join(" · "),
    },
    {
      title: "Перерыв между встречами",
      value: p.buffer ? `${p.buffer} минут` : "Не задано",
      source: sources.buffer,
    },
  ];
  return (
    <Modal label="Память" close={close}>
      <div className="memory-screen">
        <div className="memory-account">
          <span className="memory-avatar" aria-hidden="true">
            А
          </span>
          <div>
            <strong>Алексей · демо-аккаунт</strong>
            <span>
              <HardDrive size={12} /> Локально на этом компьютере
            </span>
          </div>
          <span className="demo-pill">Демо</span>
        </div>
        <p className="memory-description">
          Здесь можно проверить и изменить то, что вы попросили ассистента
          запомнить.
        </p>
        <section
          className="memory-section"
          aria-labelledby="memory-preferences-title"
        >
          <div className="memory-section-heading">
            <h3 id="memory-preferences-title">
              <Clock3 size={16} />
              Предпочтения встреч
            </h3>
            {!editing && (
              <button
                className="text-button"
                aria-label="Изменить предпочтения"
                onClick={() => {
                  setEditing(true);
                  setConfirmClear(false);
                  setStatus("");
                }}
              >
                Изменить
              </button>
            )}
          </div>
          <p className="memory-hint">
            Используются по умолчанию. Ваша просьба в чате важнее. Время —
            Алматы, UTC+5.
          </p>
          {editing ? (
            <MemoryPreferences
              values={p}
              cancel={() => setEditing(false)}
              save={(values) => {
                const nextSources = { ...sources };
                for (const key of Object.keys(values) as PreferenceKey[]) {
                  if (values[key] !== p[key])
                    nextSources[key] = values[key]
                      ? "Изменено в настройках · 30 октября 2026"
                      : "";
                }
                change({
                  ...memory,
                  preferences: values,
                  sources: nextSources,
                });
                setEditing(false);
                setStatus("Предпочтения сохранены в демо-памяти.");
              }}
            />
          ) : (
            <dl className="memory-preferences">
              {rows.map((row) => (
                <div key={row.title}>
                  <dt>{row.title}</dt>
                  <dd>
                    <span>{row.value}</span>
                    {row.value !== "Не задано" && <small>{row.source}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <MemoryEntries
          key={confirmClear ? "clearing" : "entries"}
          entries={memory.entries}
          change={(entries) => change({ ...memory, entries })}
          announce={setStatus}
        />
        <div className="memory-clear">
          {confirmClear ? (
            <div role="group" aria-label="Подтверждение очистки памяти">
              <strong>Очистить всю память?</strong>
              <p>
                Предпочтения и все записи контекста будут удалены. Встречи в
                календаре сохранятся.
              </p>
              <div className="memory-actions">
                <button
                  className="danger"
                  onClick={() => {
                    change({
                      preferences: { ...emptyPreferences },
                      sources: { duration: "", from: "", to: "", buffer: "" },
                      entries: [],
                    });
                    setConfirmClear(false);
                    setEditing(false);
                    setStatus("Демо-память очищена.");
                  }}
                >
                  Да, очистить память
                </button>
                <button
                  autoFocus
                  className="secondary"
                  onClick={() => setConfirmClear(false)}
                >
                  Оставить память
                </button>
              </div>
            </div>
          ) : (
            <button
              className="text-button"
              disabled={!hasMemory}
              onClick={() => {
                setConfirmClear(true);
                setEditing(false);
                setStatus("");
              }}
            >
              <Trash2 size={14} />
              Очистить всю память
            </button>
          )}
        </div>
        <p className="memory-status" role="status">
          {status}
        </p>
        <p className="memory-demo-note">
          Демонстрационные данные · изменения сбросятся при перезагрузке.
          Подключение памяти к ассистенту появится при реализации.
        </p>
      </div>
    </Modal>
  );
}

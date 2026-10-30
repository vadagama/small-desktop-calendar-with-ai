import { useEffect, useRef, useState } from "react";
import { Brain, Clock3, HardDrive, Trash2 } from "lucide-react";
import { Modal } from "../../prototype/src/Dialogs";
import { MemoryEntries } from "../../prototype/src/MemoryEntries";
import { MemoryPreferences } from "../../prototype/src/MemoryPreferences";
import { MemoryCollections } from "./MemoryCollections";
import { SmallAuthNotice } from "./SmallAuthNotice";
import { openSmallAccount } from "./useSmallAccount";
import type {
  AssistantMemoryState,
  MemoryChange,
  MemorySource,
} from "../shared/assistant-memory.js";
import "../../prototype/src/memory-settings.css";
import "./memory-settings.css";

const sourceText = (source: MemorySource) =>
  `${source.kind === "chat" ? "По вашей просьбе" : source.kind === "legacy-import" ? "Из прежней памяти участников" : "Из настроек"} · ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long", year: "numeric" }).format(new Date(source.at))}`;
export function MemorySettings({
  account,
  close,
  authRequired = false,
}: {
  account: { id: string; name: string } | null;
  close: () => void;
  authRequired?: boolean;
}) {
  const [state, setState] = useState<AssistantMemoryState | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [clear, setClear] = useState<
    "preferences" | "entries" | "groups" | "presets" | "all" | "reset" | null
  >(null);
  const alive = useRef(true),
    locked = useRef(false);
  const load = async () => {
    setBusy(true);
    try {
      const r = await window.smallDesktop.memory.read();
      if (!alive.current) return;
      if (r.ok && r.accountId === account?.id) {
        setState(r.state);
        setError("");
      } else setError(r.ok ? "Аккаунт изменился." : r.error);
    } catch {
      if (alive.current) setError("Не удалось загрузить память.");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    if (account && !authRequired) void load();
    else setBusy(false);
    return () => {
      alive.current = false;
    };
  }, [account?.id, authRequired]);
  async function save(change: MemoryChange) {
    if (!state || locked.current || authRequired) return false;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const reply = await window.smallDesktop.memory.write({
        revision: state.revision,
        requestId: crypto.randomUUID(),
        change,
      });
      if (!alive.current) return false;
      if (!reply.ok) {
        setError(reply.error);
        return false;
      }
      if (reply.accountId !== account?.id) {
        setError("Аккаунт изменился.");
        return false;
      }
      setState(reply.state);
      setNotice("Память сохранена.");
      return true;
    } catch {
      if (alive.current)
        setError("Не удалось сохранить память. Текст оставлен в редакторе.");
      return false;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const p = state?.preferences;
  const rows = p
    ? [
        {
          label: "Длительность встречи",
          value:
            p.durationMinutes !== undefined
              ? `${p.durationMinutes} минут`
              : "Не задано",
          source: state?.preferenceSources.durationMinutes,
        },
        {
          label: "Предпочтительное время",
          value:
            p.timeFrom && p.timeTo
              ? `${p.timeFrom}–${p.timeTo}`
              : p.timeFrom
                ? `После ${p.timeFrom}`
                : p.timeTo
                  ? `До ${p.timeTo}`
                  : "Не задано",
          source:
            state?.preferenceSources.timeFrom ??
            state?.preferenceSources.timeTo,
        },
        {
          label: "Перерыв между встречами",
          value:
            p.bufferMinutes !== undefined
              ? `${p.bufferMinutes} минут`
              : "Не задано",
          source: state?.preferenceSources.bufferMinutes,
        },
      ]
    : [];
  return (
    <Modal label="Память" close={close}>
      {authRequired && account && <SmallAuthNotice expired />}
      <div className="memory-screen">
        <div className="memory-account">
          <Brain size={22} />
          <div>
            <strong>{account?.name ?? "Аккаунт Small"}</strong>
            <span>
              <HardDrive size={12} />
              Локально на этом компьютере
            </span>
          </div>
        </div>
        <p className="memory-description">
          Здесь можно проверить и изменить то, что вы попросили ассистента
          запомнить.
        </p>
        {!account ? (
          authRequired ? (
            <SmallAuthNotice />
          ) : (
            <div>
              <p className="form-note">
                Не удалось подтвердить аккаунт Small. Откройте профиль, чтобы
                проверить доступ.
              </p>
              <button
                className="secondary"
                type="button"
                onClick={openSmallAccount}
              >
                Проверить доступ
              </button>
            </div>
          )
        ) : (
          <>
            {busy && !state && <p role="status">Загружаю память…</p>}
            {state && p && (
              <fieldset
                disabled={busy || authRequired}
                className="memory-fields-reset"
              >
                <section
                  className="memory-section"
                  aria-label="Предпочтения встреч"
                >
                  <div className="memory-section-heading">
                    <h3>
                      <Clock3 size={16} />
                      Предпочтения встреч
                    </h3>
                    {!editing && (
                      <button
                        className="text-button"
                        aria-label="Изменить предпочтения"
                        onClick={() => setEditing(true)}
                      >
                        Изменить
                      </button>
                    )}
                  </div>
                  <p className="memory-hint">
                    Используются по умолчанию. Ваша просьба в чате важнее. Время
                    — Алматы, UTC+5.
                  </p>
                  {editing ? (
                    <MemoryPreferences
                      values={{
                        duration: p.durationMinutes?.toString() ?? "",
                        from: p.timeFrom ?? "",
                        to: p.timeTo ?? "",
                        buffer: p.bufferMinutes?.toString() ?? "",
                      }}
                      cancel={() => setEditing(false)}
                      save={async (value) => {
                        if (
                          await save({
                            action: "preferences",
                            value: {
                              durationMinutes: value.duration
                                ? Number(value.duration)
                                : null,
                              timeFrom: value.from || null,
                              timeTo: value.to || null,
                              bufferMinutes: value.buffer
                                ? Number(value.buffer)
                                : null,
                            },
                          })
                        )
                          setEditing(false);
                      }}
                    />
                  ) : (
                    <dl className="memory-preferences">
                      {rows.map((row) => (
                        <div key={row.label}>
                          <dt>{row.label}</dt>
                          <dd>
                            <span>{row.value}</span>
                            {row.source && (
                              <small>{sourceText(row.source)}</small>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
                <MemoryEntries
                  key={clear ? "clearing" : "entries"}
                  entries={state.entries.map((e) => ({
                    id: e.id,
                    text: e.text,
                    source: sourceText(e.lastSource),
                  }))}
                  change={() => {}}
                  announce={setNotice}
                  saveEntry={(id, text) =>
                    save({ action: "entry", ...(id ? { id } : {}), text })
                  }
                  deleteEntry={(id) =>
                    save({ action: "delete", category: "entries", id })
                  }
                />
                <MemoryCollections
                  category="groups"
                  state={state}
                  accountId={account.id}
                  save={save}
                  sourceLabel={(item) => sourceText(item.lastSource)}
                />
                <MemoryCollections
                  category="presets"
                  state={state}
                  accountId={account.id}
                  save={save}
                  sourceLabel={(item) => sourceText(item.lastSource)}
                />
                <div className="memory-clear">
                  <label>
                    Очистить категорию
                    <select
                      aria-label="Категория очистки"
                      value=""
                      onChange={(e) => setClear(e.target.value as typeof clear)}
                    >
                      <option value="" disabled>
                        Выберите категорию
                      </option>
                      <option value="preferences">Предпочтения</option>
                      <option value="entries">Сохранённый контекст</option>
                      <option value="groups">Группы</option>
                      <option value="presets">Форматы</option>
                    </select>
                  </label>
                  <button
                    className="text-button"
                    onClick={() => setClear("all")}
                  >
                    <Trash2 size={14} />
                    Очистить всю память
                  </button>
                </div>
              </fieldset>
            )}
            {clear && (
              <div
                className="memory-clear"
                role="group"
                aria-label="Подтверждение очистки памяти"
              >
                <strong>
                  {clear === "all" || clear === "reset"
                    ? "Очистить всю память?"
                    : "Очистить выбранную категорию?"}
                </strong>
                <p>
                  Сохранённые данные будут удалены. Встречи в календаре
                  сохранятся.
                </p>
                <div className="memory-actions">
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      if (clear === "reset") {
                        setBusy(true);
                        try {
                          const reply =
                            await window.smallDesktop.memory.reset();
                          if (alive.current) {
                            if (reply.ok && reply.accountId === account.id) {
                              setState(reply.state);
                              setError("");
                              setClear(null);
                            } else
                              setError(
                                reply.ok ? "Аккаунт изменился." : reply.error,
                              );
                          }
                        } catch {
                          if (alive.current)
                            setError("Не удалось очистить память.");
                        } finally {
                          if (alive.current) setBusy(false);
                        }
                      } else if (
                        await save({ action: "clear", category: clear })
                      ) {
                        setClear(null);
                        setEditing(false);
                      }
                    }}
                  >
                    Да, очистить память
                  </button>
                  <button
                    autoFocus
                    className="secondary"
                    onClick={() => setClear(null)}
                  >
                    Оставить память
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div>
                <p className="form-error" role="alert">
                  {error}
                </p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  Обновить память
                </button>
                {!state && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setClear("reset")}
                  >
                    Очистить повреждённую память
                  </button>
                )}
              </div>
            )}
            <p role="status" className="memory-status">
              {notice || (busy && state ? "Сохраняю…" : "")}
            </p>
            <p className="memory-demo-note">
              Нужные записи передаются выбранной модели для ответа. Выход из
              аккаунта закрывает доступ, но не удаляет память.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

import {
  CalendarDays,
  Clock3,
  MapPin,
  Users,
  Columns2,
  Rows2,
  ArrowLeftRight,
  Check,
} from "lucide-react";
import { useState } from "react";
import type { DataState, Draft, Layout, Meeting } from "./types";
import { dateLabel, time, TODAY } from "./calendar";
import { PEOPLE } from "./data";
import { Modal } from "../../src/renderer/ui/Modal";
export { Modal } from "../../src/renderer/ui/Modal";
export function EventDialog({
  event,
  close,
  remove,
}: {
  event: Meeting;
  close: () => void;
  remove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal label="О встрече" close={close}>
      <span className={`event-label calendar-${event.calendar}`}>
        Демонстрационная встреча
      </span>
      <h3 className="event-title">{event.title}</h3>
      <div className="event-details">
        <p>
          <CalendarDays size={18} />
          <span>
            {dateLabel(event.date, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
        </p>
        <p>
          <Clock3 size={18} />
          <span>
            {time(event.start)} — {time(event.start + event.duration)} ·{" "}
            {event.duration} мин
            <br />
            <small>Asia/Almaty · UTC+5</small>
          </span>
        </p>
        <p>
          <Users size={18} />
          <span>
            {event.people.join(", ")}
            <br />
            <small>Организатор: {event.organizer} · демо-участники</small>
          </span>
        </p>
        <p>
          <MapPin size={18} />
          <span>
            {event.location}
            <br />
            <small>Реальная ссылка не создавалась</small>
          </span>
        </p>
      </div>
      <h4>Повестка</h4>
      <p className="event-agenda">{event.agenda}</p>
      <div className="dialog-actions">
        {confirm ? (
          <>
            <p>Убрать встречу из демо-календаря?</p>
            <button className="danger" onClick={remove}>
              Да, убрать демо-встречу
            </button>
            <button className="secondary" onClick={() => setConfirm(false)}>
              Оставить
            </button>
          </>
        ) : (
          <>
            <button
              className="text-button danger-text"
              onClick={() => setConfirm(true)}
            >
              Отменить демо-встречу
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
export function CreateDialog({
  close,
  add,
  date,
}: {
  close: () => void;
  add: (draft: Draft) => string | undefined;
  date: string;
}) {
  const [error, setError] = useState("");
  return (
    <Modal label="Новая демо-встреча" close={close}>
      <p className="modal-description">
        Проверьте сценарий создания. Встреча останется только в этом стенде.
      </p>
      <form
        className="meeting-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const [hour, minute] = String(data.get("time"))
            .split(":")
            .map(Number);
          const draft = {
            title: String(data.get("title")).trim(),
            date: String(data.get("date")),
            start: hour * 60 + minute,
            duration: Number(data.get("duration")),
            people: data.getAll("person").map(String),
            agenda: String(data.get("agenda")).trim(),
          };
          if (!draft.title) {
            setError("Укажите название встречи.");
            return;
          }
          if (!draft.people.length) {
            setError("Выберите хотя бы одного участника.");
            return;
          }
          if (draft.start < 480 || draft.start + draft.duration > 1080) {
            setError("Для стенда выберите время между 08:00 и 18:00.");
            return;
          }
          const problem = add(draft);
          if (problem) setError(problem);
          else close();
        }}
      >
        <label>
          Название
          <input
            name="title"
            placeholder="Что обсудим?"
            required
            maxLength={100}
            autoFocus
          />
        </label>
        <div className="form-two">
          <label>
            Дата
            <input
              name="date"
              type="date"
              defaultValue={date || TODAY}
              required
            />
          </label>
          <label>
            Начало
            <input name="time" type="time" defaultValue="13:00" required />
          </label>
        </div>
        <label>
          Длительность
          <select name="duration" defaultValue="30">
            <option value="30">30 минут</option>
            <option value="60">1 час</option>
            <option value="90">1 час 30 минут</option>
          </select>
        </label>
        <fieldset>
          <legend>Демо-участники</legend>
          {PEOPLE.map((person) => (
            <label className="person-option" key={person}>
              <input
                type="checkbox"
                name="person"
                value={person}
                defaultChecked={person === "Алексей"}
              />
              {person}
            </label>
          ))}
        </fieldset>
        <label>
          Повестка
          <textarea
            name="agenda"
            rows={3}
            placeholder="Цель встречи и вопросы для обсуждения"
            maxLength={1500}
          />
        </label>
        <p className="form-note">
          Организатор: Алексей · личная · без повторений
          <br />
          Asia/Almaty · UTC+5 · ссылка не создаётся
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit">
          Подтвердить и добавить демо-встречу
        </button>
      </form>
    </Modal>
  );
}
export function SettingsDialog({
  close,
  layout,
  setLayout,
  state,
  setState,
  reset,
}: {
  close: () => void;
  layout: Layout;
  setLayout: (layout: Layout) => void;
  state: DataState;
  setState: (state: DataState) => void;
  reset: () => void;
}) {
  return (
    <Modal label="Рабочее пространство" close={close}>
      <p className="modal-description">
        Расположите календарь и ассистента так, как удобно вам.
      </p>
      <h3 className="settings-heading">Положение ассистента</h3>
      <div className="layout-options">
        {(
          [
            ["right", "Справа"],
            ["left", "Слева"],
            ["bottom", "Снизу"],
            ["top", "Сверху"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={layout === id ? "selected" : ""}
            aria-pressed={layout === id}
            onClick={() => setLayout(id)}
          >
            {id === "right" || id === "left" ? (
              <Columns2 size={24} />
            ) : (
              <Rows2 size={24} />
            )}
            <span>{label}</span>
            {layout === id && <Check className="layout-check" size={13} />}
          </button>
        ))}
      </div>
      <p className="form-note">
        <ArrowLeftRight size={14} /> Можно также перетащить заголовок одной
        панели на другую. Границу можно двигать мышью или стрелками.
      </p>
      <label className="state-select">
        Состояние календаря
        <select
          value={state}
          onChange={(e) => setState(e.target.value as DataState)}
        >
          <option value="ready">Обычное · демо-события</option>
          <option value="loading">Загрузка</option>
          <option value="empty">Пустой календарь</option>
          <option value="error">Ошибка сети</option>
          <option value="denied">Нет доступа</option>
        </select>
      </label>
      <p className="form-note">
        Состояния имитируются для проверки интерфейса. Ассистент не предлагает
        слоты при недоступном календаре.
      </p>
      <div className="dialog-actions">
        <button className="primary" onClick={close}>
          Готово
        </button>
        <button className="text-button" onClick={reset}>
          Сбросить компоновку
        </button>
      </div>
    </Modal>
  );
}

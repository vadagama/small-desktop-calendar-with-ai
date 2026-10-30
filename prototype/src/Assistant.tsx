import { resolveListSearch, type PendingListSearch } from "./list-search";
import type { ListFilter } from "./event-list";
import {
  ArrowUp,
  ArrowUpRight,
  CalendarPlus,
  ChartNoAxesCombined,
  Check,
  CheckCheck,
  Clock3,
  GripVertical,
  RotateCcw,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { addDays, dateLabel, findSlots, time, TODAY } from "./calendar";
import { PEOPLE } from "./data";
import type { DataState, Draft, Meeting, Slot } from "./types";
interface Props {
  showEventList?: (filter: ListFilter) => number;
  events: Meeting[];
  add: (draft: Draft) => string | undefined;
  state: DataState;
  swap: () => void;
  analytics: () => void;
  analysisContext?: { id: number; title: string; text: string };
}
interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}
const prompts = [
  "Найди 30 минут для команды завтра",
  "Подготовь встречу по развитию календаря",
  "Как выглядит моя неделя?",
  "Найди все события, где организатором была Жанна",
];
export function Assistant(p: Props) {
  const [pendingSearch, setPendingSearch] = useState<PendingListSearch | null>(
    null,
  );
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (messages.length)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: "smooth",
      });
  }, [messages, slots, draft, busy]);
  useEffect(() => {
    if (!p.analysisContext) return;
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    setSlots([]);
    setDraft(null);
    setMessages((old) => [
      ...old,
      {
        id: p.analysisContext!.id,
        role: "user",
        text: `Объясни дэшборд «${p.analysisContext!.title}»`,
      },
      {
        id: p.analysisContext!.id + 1,
        role: "assistant",
        text: `Демонстрационный разбор выбранного снимка. ${p.analysisContext!.text}\n\nЧисла рассчитаны кодом. Для реального диалога потребуется подключение AI-харнесса.`,
      },
    ]);
  }, [p.analysisContext]);
  function send(text: string) {
    if (!text.trim() || busy) return;
    setInput("");
    setDraft(null);
    setSlots([]);
    setError("");
    setBusy(true);
    setMessages((old) => [
      ...old,
      { id: Date.now(), role: "user", text: text.trim() },
    ]);
    timer.current = setTimeout(() => {
      let response: string;
      if (p.state !== "ready")
        response =
          "Календарь недоступен или пуст в выбранном сценарии. Верните обычное состояние в настройках, чтобы проверить подбор времени.";
      else if (
        p.showEventList &&
        (pendingSearch ||
          /спис[ок]|организатор|событи.*жанн|встреч.*жанн/i.test(text))
      ) {
        const result = resolveListSearch(text, pendingSearch, p.events, TODAY)!;
        setPendingSearch(result.pending);
        response = result.text;
        if (result.filter) {
          const count = p.showEventList(result.filter);
          response = `Найдено событий: ${count}. ${response}`;
        }
      } else if (
        /недел|аналит|сколько/i.test(text) &&
        !/найди|встреч|минут/i.test(text)
      ) {
        p.analytics();
        response =
          "Открыла обзор демонстрационной недели. В нём показаны количество событий и их запланированная длительность; это не фактическое присутствие.";
      } else if (!/найди|подготов|встреч|собери|слот|команд|минут/i.test(text))
        response =
          "В этом прототипе доступны сценарии подбора встречи и обзора недели. Попробуйте «Найди 30 минут для команды завтра». Ответы демонстрационные, модель не подключена.";
      else {
        const duration = Number(text.match(/(\d+)\s*мин/i)?.[1] || 30);
        const found = findSlots(p.events, PEOPLE, addDays(TODAY, 1), duration);
        setSlots(found);
        response = found.length
          ? `Нашла варианты для ${PEOPLE.length} демо-участников на ${duration} минут. Проверила пересечения только по событиям стенда. Выберите время — затем покажу черновик.`
          : "В рабочем интервале нет подходящих демо-слотов. Попробуйте длительность от 15 до 480 минут.";
      }
      setMessages((old) => [
        ...old,
        { id: Date.now(), role: "assistant", text: response },
      ]);
      setBusy(false);
    }, 650);
  }
  function choose(slot: Slot) {
    setDraft({
      ...slot,
      title: "Обсуждение развития календаря",
      people: PEOPLE,
      agenda:
        "Посмотреть прототип. Сверить сценарии календаря и ассистента. Зафиксировать следующие шаги.",
    });
    setSlots([]);
  }
  function confirm() {
    if (!draft) return;
    const problem = p.add(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setMessages((old) => [
      ...old,
      {
        id: Date.now(),
        role: "assistant",
        text: `Демо-встреча «${draft.title}» добавлена: ${dateLabel(draft.date)}, ${time(draft.start)}–${time(draft.start + draft.duration)}. Приглашения не отправлялись.`,
      },
    ]);
    setDraft(null);
    setError("");
  }
  return (
    <section className="assistant-panel" aria-label="AI-ассистент">
      <div
        className="panel-caption"
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", "assistant")}
      >
        <span>
          <GripVertical size={14} />
          Ассистент
        </span>
        <span className="demo-pill">Демо</span>
        <button
          className="icon-button"
          aria-label="Новый диалог"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setBusy(false);
            setMessages([]);
            setPendingSearch(null);
            setSlots([]);
            setDraft(null);
            setError("");
          }}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div className="assistant-scroll" ref={scroll}>
        {!messages.length ? (
          <>
            <div className="assistant-intro">
              <span className="assistant-mark">
                <Sparkles size={25} strokeWidth={1.5} />
              </span>
              <h2>Помочь с расписанием?</h2>
              <p>Найду события, подберу время и подготовлю черновик встречи.</p>
            </div>
            <div className="suggestions">
              {prompts.map((prompt, i) => (
                <button key={prompt} onClick={() => send(prompt)}>
                  {i === 0 ? (
                    <Users size={17} />
                  ) : i === 1 ? (
                    <CalendarPlus size={17} />
                  ) : (
                    <ChartNoAxesCombined size={17} />
                  )}
                  <span>{prompt}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
            <div className="assistant-tip">
              <span className="tiny-stars">
                <Sparkles size={14} />
              </span>
              <p>
                Календарь и диалог — рядом.
                <br />
                Потяните границу, чтобы устроиться удобнее.
              </p>
            </div>
          </>
        ) : (
          <div className="messages" role="log" aria-live="polite">
            {messages.map((message) => (
              <div className={`message ${message.role}`} key={message.id}>
                {message.role === "assistant" && (
                  <span className="message-icon">
                    <Sparkles size={15} />
                  </span>
                )}
                <div>{message.text}</div>
              </div>
            ))}
            {busy && (
              <div className="thinking" role="status">
                <span />
                <span />
                <span />
                Проверяю демо-календарь
              </div>
            )}
          </div>
        )}
        {!!slots.length && (
          <div className="slot-list">
            <span className="slot-label">Доступные варианты · UTC+5</span>
            {slots.map((slot) => (
              <button
                key={`${slot.date}-${slot.start}`}
                onClick={() => choose(slot)}
              >
                <div>
                  <strong>{dateLabel(slot.date)}</strong>
                  <span>
                    {time(slot.start)} – {time(slot.start + slot.duration)}
                  </span>
                </div>
                <Check size={17} />
              </button>
            ))}
          </div>
        )}
        {draft && (
          <div className="draft-card">
            <div className="draft-heading">
              <span>
                <CalendarPlus size={16} />
                Черновик встречи
              </span>
              <button
                className="icon-button"
                aria-label="Отменить черновик"
                onClick={() => setDraft(null)}
              >
                <X size={15} />
              </button>
            </div>
            <h3>{draft.title}</h3>
            <p>
              <Clock3 size={15} />
              {dateLabel(draft.date)}, {time(draft.start)}–
              {time(draft.start + draft.duration)}
              <br />
              Asia/Almaty · UTC+5
            </p>
            <p>
              <Users size={15} />
              {draft.people.join(", ")}
            </p>
            <dl>
              <dt>Организатор</dt>
              <dd>Алексей (демо)</dd>
              <dt>Формат</dt>
              <dd>Онлайн · ссылка не создаётся в стенде</dd>
              <dt>Повторение</dt>
              <dd>Не повторяется · личная встреча</dd>
            </dl>
            <p className="draft-agenda">{draft.agenda}</p>
            <div className="conflict-status">
              <CheckCheck size={15} />
              Нет пересечений в демо-данных
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" onClick={confirm}>
              Добавить в демо-календарь
            </button>
            <button
              className="text-button"
              onClick={() => {
                setSlots(
                  findSlots(p.events, draft.people, draft.date, draft.duration),
                );
                setDraft(null);
              }}
            >
              Выбрать другое время
            </button>
          </div>
        )}
      </div>
      <div className="composer-area">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            aria-label="Сообщение ассистенту"
            placeholder="Например, собери команду завтра…"
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <div>
            <span>
              <Sparkles size={13} />
              Демо-ассистент
            </span>
            <button
              aria-label="Отправить сообщение"
              type="submit"
              disabled={!input.trim() || busy}
            >
              <ArrowUp size={17} />
            </button>
          </div>
        </form>
        <p>Демо-режим · без отправки приглашений</p>
      </div>
    </section>
  );
}

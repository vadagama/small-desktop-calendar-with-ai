import { createAvailabilityPeoplePicker } from "./availability-people-picker.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
} from "lucide-react";

const icons = {
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
};
for (const node of document.querySelectorAll("[data-icon]")) {
  node.innerHTML = renderToStaticMarkup(
    createElement(icons[node.dataset.icon], { "aria-hidden": true }),
  );
}
// Isolated UX demo. No calendar requests, credentials, or persistent storage.
const $ = (id) => document.getElementById(id);
const people = [
  { id: "demo-anna", name: "Анна Смирнова", role: "Продукт" },
  { id: "demo-ivan", name: "Иван Волков", role: "Разработка" },
  { id: "demo-maria", name: "Мария Белова", role: "Дизайн" },
  { id: "demo-alex", name: "Алексей Морозов", role: "Разработчик" },
  { id: "demo-elena", name: "Елена Соколова", role: "Менеджер проектов" },
  { id: "demo-dmitry", name: "Дмитрий Орлов", role: "Аналитик" },
];
let selected = people.slice(0, 3).map((person) => person.id);
const peoplePicker = createAvailabilityPeoplePicker(
  $("people"),
  people,
  (ids) => {
    selected = ids;
    render();
  },
);
let week = 0;
let commonOnly = false;
let choice = null;
const time = (index) =>
  `${String(9 + Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`;
const date = (day) => new Date(Date.UTC(2026, 10, 9 + week * 7 + day));
const dayLabel = (day) =>
  date(day).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
function state(personId, day, index) {
  if ($("demo-state").value === "partial" && personId === people[2].id)
    return "unknown";
  const person = people.findIndex((item) => item.id === personId);
  // Deterministic fictitious half-hour occupancy. Lunch is unavailable.
  return index === 6 ||
    index === 7 ||
    (index + day * 3 + person * 2 + week) % 11 < 3
    ? "busy"
    : "free";
}
function common(day, index) {
  return (
    selected.length > 0 &&
    $("demo-state").value !== "empty" &&
    selected.every((id) => state(id, day, index) === "free")
  );
}
function windows(day, personId = null) {
  const result = [];
  const minimum = Number($("duration").value) / 30;
  let start = null;
  for (let index = 0; index <= 18; index++) {
    const free =
      index < 18 &&
      (personId ? state(personId, day, index) === "free" : common(day, index));
    if (free && start === null) start = index;
    if (!free && start !== null) {
      if (index - start >= minimum) result.push({ day, start, end: index });
      start = null;
    }
  }
  return result;
}
function openTab(open = true) {
  $("availability-view").hidden = !open;
  $("calendar-view").hidden = open;
  $("availability-tab").setAttribute("aria-pressed", String(open));
  $("calendar-tab").setAttribute("aria-pressed", String(!open));
}
function render() {
  choice = null;
  $("selection").hidden = true;
  const mode = $("demo-state").value;
  const days = $("weekends").checked ? 7 : 5;
  $("period").textContent =
    `${date(0).getUTCDate()}–${date(days - 1).getUTCDate()} ${date(days - 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  $("availability-tab").querySelector("span").textContent = selected.length;
  peoplePicker.update(selected);
  $("feedback").textContent = !selected.length
    ? "Выберите хотя бы одного сотрудника для анализа."
    : {
        loading: "Проверяем доступность сотрудников…",
        empty:
          "Общих окон нужной длительности нет. Попробуйте сократить длительность или изменить состав.",
        partial:
          "Нет данных Марии Беловой. Общая доступность не подтверждена; неизвестные интервалы отмечены штриховкой.",
        error:
          "Не удалось загрузить доступность. Повторите запрос кнопкой «Обновить».",
      }[mode] || "";
  const incomplete = mode === "partial" && selected.includes(people[2].id);
  if (mode === "partial" && !incomplete && selected.length)
    $("feedback").textContent = "";
  const unavailable = ["loading", "error"].includes(mode) || !selected.length;
  $("grid").closest(".demo-grid-scroll").hidden = unavailable;
  $("grid").setAttribute("aria-busy", String(mode === "loading"));
  const all = unavailable
    ? []
    : Array.from({ length: days }, (_, day) => windows(day)).flat();
  $("window-count").textContent = unavailable || incomplete ? "—" : all.length;
  $("free-total").textContent =
    unavailable || incomplete
      ? "—"
      : `${all.reduce((sum, item) => sum + (item.end - item.start) / 2, 0).toLocaleString("ru-RU")} ч`;
  $("best-window").innerHTML = all.length
    ? `Ближайшее: <strong>${escape(dayLabel(all[0].day))} · ${time(all[0].start)}–${time(all[0].end)}</strong>`
    : "Подтверждённого общего окна нет";
  if (unavailable) return;
  $("unknown-legend").hidden =
    mode !== "partial" || !selected.includes(people[2].id);
  const rows = commonOnly
    ? [
        {
          id: null,
          name: "Свободны все",
          role: `${selected.length} участника · от ${$("duration").value} мин`,
        },
      ]
    : people.filter((person) => selected.includes(person.id));
  const scroll = $("grid").closest(".demo-grid-scroll");
  const oldLeft = scroll.dataset.initialized ? scroll.scrollLeft : 8 * 64;
  $("grid").innerHTML =
    `<caption>Часы от 00:00 до 24:00 по горизонтали. Даты по вертикали; внутри каждого дня строки участников. Время Asia/Almaty.</caption><colgroup><col class="demo-name-column"><col class="demo-time-column"></colgroup><thead><tr><th scope="col">Участники · GMT+5</th><th scope="col" class="demo-hour-axis"><div>${Array.from({ length: 25 }, (_, hour) => `<span class="${hour === 24 ? "last-hour" : ""}" style="--hour:${hour}">${String(hour).padStart(2, "0")}</span>`).join("")}</div></th></tr></thead>${Array.from(
      { length: days },
      (_, day) =>
        `<tbody><tr><th colspan="2" scope="rowgroup" class="demo-date-heading"><div>${escape(dayLabel(day))}<span>${date(day).getUTCFullYear()}</span></div></th></tr>${rows
          .map((person) => {
            const initials = person.id
              ? person.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
              : selected.length;
            return `<tr><th class="demo-person-heading" scope="row"><div class="demo-person-title"><span class="demo-avatar" aria-hidden="true">${initials}</span><span><span class="demo-person-name">${person.name}</span><span class="demo-person-info">${person.role}</span></span></div></th><td class="demo-cells"><div class="demo-day-track">${renderTrack(person, day, all)}</div></td></tr>`;
          })
          .join("")}</tbody>`,
    ).join("")}`;
  scroll.scrollLeft = oldLeft;
  scroll.dataset.initialized = "true";
}

function renderTrack(person, day, all) {
  const valid = windows(day, person.id);
  const segments = [];
  for (let index = 0; index < 18; index++) {
    const own = person.id
      ? state(person.id, day, index)
      : selected.some((id) => state(id, day, index) === "unknown")
        ? "unknown"
        : common(day, index)
          ? "free"
          : "busy";
    const group = all.find(
      (item) => item.day === day && index >= item.start && index < item.end,
    );
    const kind = own === "free" && group ? "common" : own;
    const previous = segments.at(-1);
    if (previous?.kind === kind) previous.end = index + 1;
    else segments.push({ kind, start: index, end: index + 1 });
  }
  return (
    `<span class="demo-outside before" role="img" aria-label="00:00–09:00: вне рабочих часов"></span><span class="demo-outside after" role="img" aria-label="18:00–24:00: вне рабочих часов"></span>` +
    segments
      .map((segment) => {
        const { kind, start, end } = segment;
        const target =
          kind === "common"
            ? all.find(
                (item) =>
                  item.day === day && start >= item.start && start < item.end,
              )
            : kind === "free"
              ? valid.find((item) => start >= item.start && start < item.end)
              : null;
        const label = {
          unknown: "Нет данных",
          busy: person.id ? "Занят" : "Не все свободны",
          common: "Свободны все",
          free: "Свободен",
        }[kind];
        const description = `${person.name}, ${dayLabel(day)}, ${time(start)}–${time(end)}: ${label}`;
        const props = `class="slot ${kind}" style="--start:${start + 18};--length:${end - start}" title="${escape(description)}"`;
        const content =
          end - start >= 2
            ? kind === "unknown"
              ? "Нет данных"
              : end - start >= 3
                ? `${time(start)}–${time(end)}`
                : time(start)
            : "";
        return target
          ? `<button ${props} aria-label="${escape(description)}" data-day="${day}" data-start="${target.start}" data-end="${target.end}" data-person="${kind === "common" ? "" : person.id || ""}">${content}</button>`
          : `<span ${props} role="img" aria-label="${escape(description)}">${content}</span>`;
      })
      .join("")
  );
}
$("grid").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-day]");
  if (!button) return;
  choice = {
    day: Number(button.dataset.day),
    start: Number(button.dataset.start),
    end: Number(button.dataset.end),
    person: button.dataset.person,
  };
  document
    .querySelectorAll(".slot.selected")
    .forEach((item) => item.classList.remove("selected"));
  button.classList.add("selected");
  const { day, start, end, person } = choice;
  const ids = person ? [person] : selected;
  $("selection").hidden = false;
  $("selection").innerHTML =
    `<p><strong>${escape(dayLabel(day))} · ${time(start)}–${time(end)}</strong><br>${ids.length === 1 ? escape(people.find((item) => item.id === ids[0]).name) : `Все выбранные сотрудники · ${ids.length}`} · встреча ${$("duration").value} мин с ${time(start)}</p><button id="prepare" class="demo-primary">В черновик встречи</button><button id="clear-selection" aria-label="Снять выбор">Закрыть</button>`;
});
function message(text, user = false) {
  const paragraph = document.createElement("p");
  paragraph.className = user ? "demo-user" : "demo-answer";
  paragraph.textContent = text;
  $("messages").append(paragraph);
}
$("selection").addEventListener("click", (event) => {
  if (event.target.id === "clear-selection") {
    $("selection").hidden = true;
    choice = null;
    document
      .querySelectorAll(".slot.selected")
      .forEach((item) => item.classList.remove("selected"));
  }
  if (event.target.id !== "prepare" || !choice) return;
  const { day, start, person } = choice;
  message(
    `Демо-черновик: ${dayLabel(day)}, ${time(start)}–${time(start + Number($("duration").value) / 30)}, Asia/Almaty. Участники: ${(person ? people.filter((item) => item.id === person) : people.filter((item) => selected.includes(item.id))).map((item) => item.name).join(", ")}. В рабочем приложении перед открытием формы потребуется повторная проверка доступности. Встреча не создана.`,
  );
  event.target.disabled = true;
  event.target.textContent = "Передано в демо-чат ✓";
});
$("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  message(prompt, true);
  if (/только анн/i.test(prompt)) selected = [people[0].id];
  if (/всех/i.test(prompt)) selected = people.map((item) => item.id);
  if (/следующ/i.test(prompt)) week++;
  openTab();
  render();
  message(
    "Обновил вкладку «Свободные слоты» слева. Это демонстрация сценария; AI и календарь не подключены.",
  );
  $("prompt").value = "";
});
for (const id of ["duration", "weekends", "demo-state"])
  $(id).addEventListener("change", render);
$("previous").onclick = () => {
  week--;
  render();
};
$("next").onclick = () => {
  week++;
  render();
};
$("refresh").onclick = () => {
  $("demo-state").value = "ready";
  render();
};
$("all-view").onclick = () => {
  commonOnly = false;
  $("all-view").setAttribute("aria-pressed", "true");
  $("common-view").setAttribute("aria-pressed", "false");
  render();
};
$("common-view").onclick = () => {
  commonOnly = true;
  $("all-view").setAttribute("aria-pressed", "false");
  $("common-view").setAttribute("aria-pressed", "true");
  render();
};
for (const id of ["availability-tab", "show-report", "return"])
  $(id).onclick = () => openTab();
$("calendar-tab").onclick = () => openTab(false);
render();

$("grid").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    $("selection").hidden = true;
    choice = null;
    document
      .querySelectorAll(".slot.selected")
      .forEach((item) => item.classList.remove("selected"));
  }
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Search, X } from "lucide-react";

const icon = (component) =>
  renderToStaticMarkup(createElement(component, { "aria-hidden": true }));

// Demo counterpart of MeetingPeoplePicker: uses only the synthetic directory.
export function createAvailabilityPeoplePicker(root, directory, onChange) {
  let selected = [];
  let candidates = [];
  let active = -1;
  root.innerHTML = `<label for="availability-person-search">Участники</label>
    <div class="demo-people-field"><div class="demo-people-chips"></div>
      <div class="demo-people-search"><input id="availability-person-search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="availability-person-results" autocomplete="off" maxlength="200" placeholder="Имя сотрудника">
      <button type="button" aria-label="Найти сотрудников">${icon(Search)}</button></div>
    </div><div id="availability-person-results" class="demo-people-results" role="listbox" aria-label="Результаты поиска сотрудников" hidden></div>
    <span class="visually-hidden" role="status" aria-live="polite"></span>`;
  const input = root.querySelector("input");
  const results = root.querySelector('[role="listbox"]');
  const chips = root.querySelector(".demo-people-chips");
  function close() {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }
  function highlight(index) {
    active = index;
    const options = [...results.querySelectorAll('[role="option"]')];
    options.forEach((node, i) =>
      node.setAttribute("aria-selected", String(i === active)),
    );
    if (options[active]) {
      input.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function search() {
    const query = input.value.trim().toLocaleLowerCase("ru-RU");
    const matches = directory.filter((p) =>
      `${p.name} ${p.role}`.toLocaleLowerCase("ru-RU").includes(query),
    );
    candidates = matches.filter((p) => !selected.includes(p.id));
    results.replaceChildren();
    active = -1;
    input.removeAttribute("aria-activedescendant");
    for (const person of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `availability-option-${person.id}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.tabIndex = -1;
      const avatar = document.createElement("span");
      avatar.className = "demo-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = person.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("");
      const name = document.createElement("span");
      name.textContent = person.name;
      const role = document.createElement("small");
      role.textContent = person.role;
      name.append(role);
      button.append(avatar, name);
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => add(person));
      results.append(button);
    }
    if (!candidates.length) {
      const empty = document.createElement("p");
      empty.textContent = matches.length
        ? "Все найденные сотрудники уже добавлены"
        : "Сотрудники не найдены";
      results.append(empty);
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function add(person) {
    if (selected.includes(person.id) || selected.length >= 20) return;
    input.value = "";
    close();
    onChange([...selected, person.id]);
    input.focus();
    close();
  }
  input.addEventListener("focus", search);
  input.addEventListener("input", search);
  root
    .querySelector(".demo-people-search button")
    .addEventListener("click", () => {
      input.focus();
      search();
    });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.hidden) search();
      highlight(
        Math.min(
          candidates.length - 1,
          Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1)),
        ),
      );
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!results.hidden && candidates[active]) add(candidates[active]);
      else search();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target)) close();
  });
  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget)) close();
  });
  return {
    update(ids) {
      selected = [...ids];
      chips.replaceChildren();
      for (const id of selected) {
        const person = directory.find((p) => p.id === id);
        const chip = document.createElement("span");
        chip.append(document.createTextNode(person.name));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", `Убрать ${person.name}`);
        remove.innerHTML = icon(X);
        remove.addEventListener("click", () => {
          close();
          onChange(selected.filter((current) => current !== id));
          input.focus();
          close();
        });
        chip.append(remove);
        chips.append(chip);
      }
      root.querySelector('[role="status"]').textContent =
        `Сотрудников в анализе: ${selected.length}`;
      if (!results.hidden) search();
    },
  };
}

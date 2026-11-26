---
id: "REF-templates"
description: "Шаблоны, которые init создаёт в продукте: product.yaml, engineering.yaml, MANUAL. Читать при создании или пересмотре артефактов."
kind: "reference"
status: "current"
owner: "maintainer"
related: ["../README.md", "../handbook/20-artifact-contract.md"]
---

# Шаблоны документов продукта

Здесь заготовки для настройки продукта и последующей разработки UI.

| Шаблон | Куда в продукте | Когда создаётся |
|---|---|---|
| [product.yaml](product.yaml) | `product.yaml` (корень) | init |
| [engineering.yaml](engineering.yaml) | `engineering.yaml` (корень) | init; далее ведёт агент при каждой установке и обновлении |
| [ui/](ui/README.md) | `docs/ui/DESIGN.md` и `docs/ui/<SPEC>/` | при разработке целевого UI |
| [opencode-agent.md](opencode-agent.md) | `.opencode/agents/<role>.md` (V2) | для выбранных ролей OpenCode; заменить placeholders и проверить версию |
| [opencode.json](opencode.json) | `opencode.json` | если выбран OpenCode; заполнить по назначениям |
| [manual.md](manual.md) | `MANUAL.md` (корень) | init; заполняет агент фактически проверенными командами |

- **product.yaml** — паспорт продукта по главе 20 руководства: имя, назначение,
  владельцы, стадия (discovery, development, production); актуализируется
  по мере развития продукта.
- **engineering.yaml** — инженерный профиль: единственное место фиксации состава
  набора — навыки, агенты и референсы с источниками и ревизиями проектных копий;
  здесь же профиль, UI-режим, эксперименты, выбранные ADE/основная среда и семь
  назначений моделей/харнесов (schema 1.2). Нативные адаптеры Codex, Claude Code,
  OpenCode, Orca и Zed создавать по [единой инструкции](../references/ade-installation.md)
  для установленной версии; шаблоны OpenCode не подходят другим средам.
- **manual.md** — заготовка руководства по продукту: подготовка, окружение
  и установка, запуск и остановка, проверки и чек-лист готовности; секреты
  не вносятся.

Необязательный блок modernization в engineering.yaml описывает рефакторинг или
миграцию готового продукта. Схема и правила заполнения —
[контракт модернизации](../skills/go-product-modernization/references/profile.md).
Он не создаётся автоматически при обычной настройке продукта (null в шаблоне).

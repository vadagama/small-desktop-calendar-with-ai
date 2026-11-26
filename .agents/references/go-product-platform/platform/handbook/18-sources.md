---
title: "Первоисточники и проверка утверждений"
description: "Ссылки на первоисточники решений handbook: PostgreSQL, Wails, Connect, Buf, worktrees, mise, sync-провайдеры, security-сервисы, тестирование, UI, AI SDK и источники решений v11."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 18
source: "handbook.md §23, §46"
tags: [sources, references, verification]
up: README.md
prev: 17-roadmap.md
next: 19-agent-sdd.md
---

# Первоисточники и проверка утверждений

**В этом документе:** [Источники базового стандарта](#sources) · [Источники решений v11](#sources-v11)

<a name="sources"></a>

## Первоисточники и проверка утверждений

Ссылки ведут на документацию исходных проектов. Версии и стабильность зафиксированы **на 20 ноября 2026**; перед выпуском следующей версии руководства пересмотреть их.

| Тема | Источник |
|---|---|
| PostgreSQL 18.7 / 19.0 и дата GA | [Объявление о выпуске PostgreSQL](https://www.postgresql.org/about/news/postgresql-187-1712-1616-1520-1425-and-19-rc-2-released-3442/) |
| Политика поддержки PostgreSQL | [Правила версионирования PostgreSQL](https://www.postgresql.org/support/versioning/) |
| Статус настольной версии Wails, требования к Go | [План развития Wails](https://wails.io/status/) |
| Экспериментальный статус Wails Mobile | [Обзор Wails Mobile](https://wails.io/guides/mobile/) · [iOS](https://wails.io/guides/mobile/ios/) · [Android](https://wails.io/guides/mobile/android/) |
| Замечания по безопасности моста Wails | [История изменений Wails](https://wails.io/changelog/) |
| Протоколы Connect-Go | [Начало работы с Connect](https://connectrpc.com/docs/go/getting-started/) · [Справочник протокола](https://connectrpc.com/docs/protocol/) |
| Buf lint/breaking/generate | [Buf CLI](https://buf.build/docs/cli/) |
| Git worktrees | [Документация рабочих деревьев Git](https://git-scm.com/docs/git-worktree) |
| Mise | [Документация mise](https://mise.jdx.dev/) |
| Лицензирование PowerSync | [Лицензирование PowerSync](https://powersync.com/legal/licensing-terms) |
| Electric | [Electric Sync](https://electric-sql.com/docs) |
| OpenBao | [Документация OpenBao](https://openbao.org/docs/) |
| Rauthy | [Rauthy GitHub](https://github.com/sebadob/rauthy) |
| RustFS | [RustFS GitHub](https://github.com/rustfs/rustfs) |
| Тестирование Go | [Пакет тестирования Go](https://pkg.go.dev/testing) · [Детектор гонок Go](https://go.dev/doc/articles/race_detector) |
| UI | [shadcn/ui](https://ui.shadcn.com/) · [Base UI](https://base-ui.com/) |
| Нативные Apple/Android | [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/) · [Compose](https://developer.android.com/compose) |
| Среда выполнения ИИ-агентов | [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) |
| Методы разработки с ИИ-агентами | [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/) |

<a name="sources-v11"></a>

## Первоисточники решений v11

| Раздел | Первичный источник |
|---|---|
| Инструменты Go 1.27 | [История выпусков Go](https://go.dev/doc/devel/release) |
| PostgreSQL 19 (19.11.2026) | [Официальный выпуск PostgreSQL](https://www.postgresql.org/about/news/postgresql-19-released-3449/) |
| Настольное приложение Wails vs Mobile | [Статус Wails](https://wails.io/status/) |
| Локальные E2E: интерфейс и наблюдение | [Playwright UI Mode](https://playwright.dev/docs/test-ui-mode) |
| Изоляция рабочего дерева | [Документация рабочих деревьев Git](https://git-scm.com/docs/git-worktree) |
| Наблюдение за фоновыми E2E | [Руководство watchexec](https://github.com/watchexec/watchexec/blob/main/doc/watchexec.1.md) |
| GitLab macOS shell | [Безопасность и обслуживание исполнителя GitLab](https://docs.gitlab.com/runner/executors/shell/) |
| Изоляция тестового сервера | [Playwright webServer](https://playwright.dev/docs/test-webserver) |
| Задачи Go и транзакционное добавление в очередь | [Документация River](https://riverqueue.com/docs/transactional-enqueueing) |
| FSM | [stateless](https://github.com/qmuntal/stateless), [looplab/fsm](https://github.com/looplab/fsm) |
| Внутрипроцессные флаги | [Документация GO Feature Flag](https://gofeatureflag.org/docs/go_module/getting-started) |
| Обмен в реальном времени | [coder/websocket](https://github.com/coder/websocket) |
| Поиск | [PostgreSQL FTS](https://www.postgresql.org/docs/current/textsearch.html), [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) |
| Email | [go-mail](https://github.com/wneessen/go-mail) |
| Сессии | [SCS](https://github.com/alexedwards/scs) |
| Общая аналитика | [Документация установки Umami](https://docs.umami.is/docs/install) |
| Кэш Go | [Ristretto v2](https://github.com/dgraph-io/ristretto) |
| Реестр или генератор внедрения зависимостей | [Архивированный Wire](https://github.com/google/wire) |

## UI и харнесы разработки

- [Impeccable](https://github.com/pbakaus/impeccable) — дизайн, итерации и ревью UI.
- [OpenCode Skills](https://opencode.ai/docs/skills/), [Instructions](https://opencode.ai/docs/instructions/),
  [Config](https://opencode.ai/docs/config/), [Agents](https://opencode.ai/docs/agents/),
  [Models](https://opencode.ai/docs/models/), [Providers](https://opencode.ai/docs/providers/) —
  первичные источники адаптера; проверять против установленной версии CLI.

---

Навигация: [← 17. Эталонный путь](17-roadmap.md) · [Оглавление](README.md) · [19. SDD →](19-agent-sdd.md)

## Настройка ADE и интерактивный опрос

Актуальные ссылки на официальные инструкции Codex, Claude Code, OpenCode, Orca
и Zed собраны рядом с соответствующими шагами в
[ade-installation.md](../references/ade-installation.md). Возможности вопросов
проверяются по инструментам текущей сессии, включая ограничения режима и клиента.

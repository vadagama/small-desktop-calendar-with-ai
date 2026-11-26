---
title: "LOCAL-NATIVE разработка"
description: "Разработка без Docker: нативные процессы Go + Vite + PostgreSQL, Git worktree как отдельное окружение, управляющий CLI devctl, mise, фоновые E2E и измеряемые бюджеты скорости."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 10
source: "handbook.md §11, §38, §39"
tags: [local-native, worktree, devctl, mise, vite, postgresql, e2e, playwright, watchexec, fast-loop]
up: README.md
prev: 09-testing-quality-gates.md
next: 11-agents-workflow.md
---

# LOCAL-NATIVE разработка

**В этом документе:** [LOCAL-NATIVE: разработка без Docker](#local-native) · [Инструменты разработки на Mac](#local-install) · [Git worktrees](#worktrees) · [CLI devctl](#devctl) · [Mise и контракты скриптов](#mise) · [Измеряемый быстрый цикл](#fast-loop) · [LOCAL-NATIVE 2.0](#native-iteration) · [Нативный стек и кэши](#native-toolchain) · [Worktree как окружение](#worktree-resources) · [Бюджеты скорости](#native-budgets) · [Фоновые E2E](#background-e2e)

<a name="local-native"></a>

## LOCAL-NATIVE: разработка без Docker

**Основной dev-профиль:** macOS host → нативные Go процессы + Vite HMR + нативный PostgreSQL. Изменение React не требует пересборки Go/OCI; изменение Go не требует запуска контейнера. Docker используется при **воспроизводимой сборке выпуска**, интеграционном тесте инфраструктуры или в рабочей среде.

<div class="diagram"><div class="diagram-title">Рисунок 3. Локальное окружение и параллельные worktrees</div><div class="flowboxes"><div class="node">Рабочее дерево A<small>Vite :4101 · Go :8101<br>DB product_a</small></div><div class="node">Рабочее дерево B<small>Vite :4102 · Go :8102<br>DB product_b</small></div><div class="node">Рабочее дерево C<small>Vite :4103 · Go :8103<br>DB product_c</small></div></div><div class="flowboxes stack"><div style="font-size:20px;color:#64748b">↕ локальные соединения UNIX/TCP, раздельные базы данных</div><div class="node accent" style="min-width:65%">PostgreSQL 18.7 — одна локальная служба<small>изолированные БД, пользователи и история миграций для каждого worktree</small></div></div><div class="diagram-note">Ветки Git изолируют файлы, но НЕ порты, SQL-данные, env, файловые хранилища и процессы. Их изоляция — задача devctl.</div></div>

<a name="local-install"></a>

### Инструменты разработки и база на Mac

Инструменты: Go (версию закрепить через mise), Node + pnpm, Buf, Git, PostgreSQL **18.7** (major 18), Swift/Xcode, Android SDK/NDK только если собирается mobile. Wails v3 требует Go 1.26+ для стабильного desktop-профиля согласно документации проекта. Проверить зависимости реального проекта командой `wails3 doctor`. Не смешивать случайные глобальные модули Go разных проектов.

```bash
# Пример для macOS с Homebrew — команды требуют установленного Homebrew.
brew install postgresql@18 mise buf
brew services start postgresql@18
"$(brew --prefix postgresql@18)/bin/psql" --version

# Пример проверки локального соединения.
pg_isready -h 127.0.0.1 -p 5432
```

Запуск на localhost не означает выключенную аутентификацию. Создать отдельную роль для разработки; не давать приложению `SUPERUSER`/`CREATEDB` и не подключаться как superuser в обычных тестах. Создание и удаление БД делает devctl под отдельной локальной admin-ролью.

<a name="worktrees"></a>

### Рабочие деревья Git: назначение ресурсов

Для каждой ветки нужны: путь worktree, уникальный `worktree_id`, изолированная роль/БД PostgreSQL, порты UI/API, локальная директория хранения, логи, `.env.local` (не коммитить), temp-файлы, тестовые артефакты. Идентификаторы БД не использовать непосредственно из имени Git-ветки без нормализации. Ресурсы регистрируются атомарно, конфликты портов обнаруживаются до запуска.

| Ресурс | Правило |
|---|---|
| `git worktree` | Отдельная ветка и каталог с явным владельцем |
| PG | Одна БД + DB role для каждого worktree |
| API/UI ports | Порт резервируется из pool, проверяется конфликт |
| RustFS/S3 | Локальный каталог/mock или уникальный bucket prefix |
| Auth | DEV OIDC issuer либо строго тестовые подписанные токены |
| Secrets | Локальные короткоживущие учетные данные, не рабочая среда |
| Data | Deterministic тестовые данные, migration базовый вариант, быстрый reset |
| Locks | Файл registry/devctl lock от гонок агентов |
| Cleanup | Сначала остановить процессы, затем удалить DB и worktree |

<a name="devctl"></a>

### Управляющий CLI `devctl`

`devctl` — **предлагаемый собственный Go-инструмент**, а не готовая команда Wails/Git. Его интерфейс должен быть маленьким, одинаковым для человека и агента.

```bash
devctl create feature-orders
devctl up feature-orders
devctl status
devctl test feature-orders --affected
devctl integrate feature-orders
devctl clean feature-orders
```

**Create:** `git worktree add -b`, регистрация портов, локальных путей, роль и БД PostgreSQL, применить миграции и тестовые данные. **Up:** Go API watch/restart + Vite HMR + отдельные логи; при desktop — Wails dev. **Test:** Анализ влияния изменений на тесты. **Integrate:** Buf breaking + совместимость миграций + тесты затронутых компонентов, merge в интеграционную ветку с проверкой конфликтов. **Clean:** guard против удаления главного worktree или БД вне пространства имён разработки; если результат нечеткий — остановиться, не удалять.

<a name="mise"></a>

### Mise и контракты скриптов

```toml
# mise.toml — example; pin exact versions in the real repository.
[tools]
go = "1.27.4"
node = "24"

[tasks.check-contracts]
run = "buf lint && buf breaking --against '.git#branch=main'"

[tasks.test-go]
run = "go test ./..."

[tasks.dev-api]
run = "go run ./cmd/api"
```

Сохранить `go.mod`, lock-файл pnpm, версии generator plugins и зафиксированный CI image digest. Обновление toolchain проводится отдельным MR с регрессионными тестами, а не незаметно после `brew upgrade`.

<a name="fast-loop"></a>

### Измеряемый быстрый цикл

| Действие | Целевой warm budget, не benchmark |
|---|---|
| React HMR | ~1–2 с |
| TS/ESLint для затронутой области | ~1–5 с |
| Vitest related | ~1–5 с |
| Go API restart | ~1–5 с |
| Browser smoke на один feature | ~3–15 с |
| Go unit warm | ~2–15 с |
| Merge + affected gates | ~5–30 с в простом случае |

Для нативных сборок, Go с CGO, полного тестового набора, подписывания iOS/macOS и публикации бюджет «секунды» не применяется. Сначала измерить базовые времена и сломанные слои. Не оптимизировать сборку GPU, если узкое место — тестовые данные серверной части или постоянный запуск всей тестовой инфраструктуры.

<a name="native-iteration"></a>

## LOCAL-NATIVE 2.0: главный режим агентной разработки

**Основная цель платформы — не скорость полной релизной сборки, а время между правкой файла и достоверной обратной связью агенту.** В рабочей итерации Docker, OCI, Linux VM, сборка `.app`, общий CI и внешняя облачная серверная часть **не участвуют**, если фича этого не требует.

<div class="diagram"><div class="diagram-title">Рисунок 9. Локальный цикл работы агента без VM и Docker</div><div class="flowboxes"><div class="node accent">ИИ-агент · Рабочее дерево A<small>Ветка Git + собственные порты и БД</small></div><div class="node accent">ИИ-агент · Рабочее дерево B<small>отдельные данные и код</small></div></div><div class="flowboxes stack"><div style="font-size:18px;color:#64748b">↓ правка / сохранение</div><div class="node">Наблюдение за Go API + Vite HMR<small>нативные процессы macOS · прогретые кэши</small></div><div style="font-size:18px;color:#64748b">↓ несколько секунд</div><div class="node">Тесты затронутых компонентов Go + Vitest<small>Проверка типов / линтинг / модульные и компонентные тесты</small></div><div style="font-size:18px;color:#64748b">↘ параллельно, с ограничением ресурсов</div><div class="node">Фоновые E2E Playwright<small>watchexec · 1 обработчик задач · screenshot/trace</small></div><div style="font-size:18px;color:#64748b">↓ готова фича: фиксированный кандидат</div><div class="node accent">Финальная локальная проверка перед слиянием<small>сборка · контракты · интеграция с PG · базовые браузерные проверки</small></div></div><div class="diagram-note">Release: отдельный Linux OCI build / Docker Compose deploy; macOS/iOS/Android подписание — отдельная редкая фаза. Worktrees разделяют Git, но не процессы/БД автоматически.</div></div>

<a name="native-toolchain"></a>

### Нативный стек, инструменты и кэши

| Компонент | Режим | Примечание |
|---|---|---|
| **Go 1.27.4** | Native / `mise` pinned | Go 1.27 — актуальный стабильный major на 20.11.2026; использовать актуальный patch |
| **Node 24 LTS + pnpm** | Native / pinned | Vite HMR, React, Vitest, Playwright |
| **PostgreSQL 18.7** | Один native instance на macOS | Консервативный базовый вариант для рабочей среды; идентичная major-ветка в CI |
| PostgreSQL **19.0** | Отдельный compatibility profile | **Вышел 19.11.2026**; новый major сначала проверить на расширениях/миграциях |
| Wails 3.x | Native dev, только когда нужна оболочка | Бизнес-логика и большинство UI-тестов работают без Wails |
| [mise](https://mise.jdx.dev/) | Pin toolchain + tasks | Избежать случайных обновлений через Homebrew |
| [watchexec](https://watchexec.github.io/) | Watcher E2E | `--on-busy-update=queue`, debounce, неблокирующий процесс наблюдения |
| [Air](https://github.com/air-verse/air) | Опциональный процесс наблюдения с перезапуском Go | Не использовать, если встроенный процесс разработки Wails достаточен |
| GitLab Runner | Только финальный integration gate | На личной Mac для соло; в команде общий runner |

Для Go рекомендую **1.27.4**, а не старый 1.26, если зависимости совместимы. Документация Go: [релизы](https://go.dev/doc/devel/release). Для PG 19.0 рекомендую отдельную ветку совместимости, а не незаметную замену major в середине разработки: [PostgreSQL 19 Released](https://www.postgresql.org/about/news/postgresql-19-released-3449/).

**Кэши:** кэши сборки и модулей Go, хранилище pnpm и скачанные браузеры Playwright могут использоваться несколькими worktree; `node_modules`, `.tsbuildinfo`, `dist`, результаты тестов, сгенерированные артефакты, ports, БД и временное состояние — **локальные для каждого worktree**. Команда `go clean -cache` не должна выполняться после каждой правки. Сборка Wails или полного клиентская часть bundle не запускается автоматически при изменении одной функции.

<a name="worktree-resources"></a>

### Рабочее дерево — отдельное окружение, а не только каталог

Пример контракта внутреннего `devctl` (это проектный CLI, не существующая стандартная утилита):

```bash
devctl create feature-a
devctl up feature-a
devctl test feature-a --affected
devctl e2e feature-a --background
devctl status feature-a
devctl submit feature-a
devctl clean feature-a
```

`devctl create` создает ветку + worktree, определяет уникальные `APP_PORT`, `VITE_PORT`, `E2E_PORT`, `DB_NAME`, `DB_ROLE`, выделяет `.runs/`, применяет миграции, загружает тестовые данные и записывает leases в защищённый от гонок реестр (например, SQLite/lockfile в корневом состоянии devctl). `up` поднимает только необходимые процессы. `clean` не имеет права удалить не относящуюся к namespace БД; операции удаления требуют проверки владение и состояния Git.

Изоляция каждого проекта:

| Ресурс | Пример |
|---|---|
| Worktree | `../worktrees/feature-a/` |
| PostgreSQL DB / role | `app_wt_a`, `app_wt_a_user` |
| Go API | `127.0.0.1:18101` |
| React HMR | `127.0.0.1:18102` |
| E2E candidate | `127.0.0.1:18103` |
| Files | `.runs/feature-a/files/` |
| Test artifacts | `.runs/feature-a/e2e/` |
| Флаги функций | Файл конфигурации конкретного worktree |
| Secrets | Учётные данные только для разработки, отдельные роли и scope |

При отсутствии настоящего OIDC/SMTP/S3 требуются адаптеры и имитации / тестовые реализации; реальные интеграционные тесты с внешними компонентами выполняются отдельными проверками. Для локального бизнес-кода **одного нативного PostgreSQL достаточно**. 24 ГБ RAM не повод одновременно запускать 5 комплектов browser+Wails+agent, если это ухудшает время ответа.

<a name="native-budgets"></a>

### Бюджеты скорости, отслеживаемые во времени

| Изменение | Цель цикл с прогретыми кэшами (не гарантия) | Измеряемое значение |
|---|---|---|
| React CSS/компонент | HMR менее 2 с | `save→visible` p50/p95 |
| Go бизнес-пакет | package tests ~1–5 с | `save→go test` p95 |
| TS lint / related tests | ~1–5 с | time-to-signal |
| API code reload | ~1–5 с | Go watch restart latency |
| 1 affected browser smoke | ~3–15 с | `trigger→result` и browser startup |
| Полный быстрый набор | Десятки секунд–минуты | обязательный gate duration |
| Full native E2E + подписание | Отдельно, редко | процесса выпуска duration |

Если цифры не достигнуты, сначала оценивать **стоимость подготовки**: повторный `pnpm install`, cold browser, лишние rebuild dependencies, ожидание test тестовые данные, запуск всей инфраструктуры, недостаточное переиспользование Кэш Go, высокая суммарная параллельность. Новая база/оркестратор редко лечат эти причины.

<a name="background-e2e"></a>

## Фоновые локальные E2E: без блокировки агента

**Цель:** агент продолжает менять код и получать unit-тесты, пока отдельный низкоприоритетный процесс запускает browser smoke по измененным маршрутам. Это **локальная активная проверка**, а не гарантия, что последний результат относится к последней незавершенной правке.

<a name="e2e-two-modes"></a>

### Два режима, решающие разные задачи

| Режим | Инструмент | Триггер | Зачем |
|---|---|---|---|
| **Interactive visual** | Playwright `test --ui` и выборочный watch | Агент активирует тест в UI | Диагностика, trace/time travel, сравнение скриншотов |
| **Background continuous** | watchexec + Playwright smoke + debounce | Изменения frontend/e2e файлов | Автопроверка без блокировки ввода/кодинга |
| **Candidate verify** | Playwright на отдельно собранном клиентская часть и фиксированной БД | Ready MR / merge | Однозначное доказательство проверенного коммита |
| **Native smoke** | Wails package + подходящий OS UI automation | Изменения bridge/permissions или релиз | Проверка реального WebView/системных возможностей |

Playwright **UI Mode watch** документирован для запуска тестов при изменении *тестовых файлов*. Он не гарантирует выполнение E2E при любом изменении React-кода; для этого предназначен отдельный watcher. [Playwright UI Mode](https://playwright.dev/docs/test-ui-mode).

<a name="e2e-watcher"></a>

### Процесс наблюдения и ограничение ресурсов

```bash
#!/usr/bin/env bash
# scripts/e2e-watch.sh — запускается ОДИН РАЗ в каждом активном worktree.
set -euo pipefail
mkdir -p .runs/e2e
exec watchexec \
  --watch web/src \
  --watch web/tests/e2e \
  --watch packages/ui \
  --debounce 1200ms \
  --on-busy-update=queue \
  --shell=none -- \
  bash scripts/e2e-once.sh
```

Семантика `--on-busy-update=queue`: **выполнять один тестовый процесс за раз**, а изменения во время работы собрать в ещё один прогон после завершения, вместо запуска неограниченного числа Chromium. Debounce фильтрует всплеск сохранений файлов. [Watchexec manual](https://github.com/watchexec/watchexec/blob/main/doc/watchexec.1.md).

```bash
#!/usr/bin/env bash
# scripts/e2e-once.sh — отчет и статус, не блокируя основной терминал.
set -uo pipefail
mkdir -p .runs/e2e
commit="$(git rev-parse HEAD)"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if nice -n 10 pnpm exec playwright test --config web/playwright.config.ts --grep @smoke --workers=1 \
     --retries=0 --reporter=line > .runs/e2e/latest.log 2>&1; then
  status=passed
  rc=0
else
  status=failed
  rc=1
fi
printf 'status=%s\ncommit=%s\nstarted=%s\n' \
  "$status" "$commit" "$started" > .runs/e2e/status.tmp
mv .runs/e2e/status.tmp .runs/e2e/status.txt
exit "$rc"
```

**Это рабочий skeleton**, адаптируемый к структуре репозитория и package scripts; подключить outputDir Playwright, сохранение screenshot/trace и запуск в фоне через process supervisor/devctl. Отчёт фиксирует HEAD, **но не полный хеш незакоммиченных файлов**; поэтому не может считаться доказательством точного состояния рабочего дерева. Можно расширить `devctl` контентным fingerprint всех watched inputs и отмечать отчет как `stale`, если изменения произошли во время теста.

<a name="e2e-isolation"></a>

### Изолировать браузер, порт и данные

**На каждой активной фиче** использовать отдельную DB role/database и URL; один dev server для разработки и отдельный test candidate server для финального smoke. Для background smoke допустим выделенный Vite server без сборки пакета для рабочей среды, если его состояние и тестовые данные предсказуемы. Playwright `webServer.reuseExistingServer` в финальном gate должен быть `false`, а URL/порт — однозначно выделены текущему worktree. Иначе тест может «успешно» пройти против чужого уже запущенного сервера. [Playwright webServer](https://playwright.dev/docs/test-webserver).

```ts
// web/playwright.config.ts — укороченный пример.
import { defineConfig } from '@playwright/test';
const port = Number(process.env.E2E_PORT ?? 18103);
const url = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  workers: process.env.CI ? 2 : 1,
  retries: 0,
  outputDir: '../.runs/e2e/results',
  use: {
    baseURL: url,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "web",
    url,
    reuseExistingServer: false,
  },
});
```

**Важно:** путь testDir и location config относятся к фактической структуре приложения. При финальном gate заменить dev Vite на `vite preview` после полноценного build; API и БД должны быть фиксированными тестовыми инстансами с проверенными migrations/fixtures.

<a name="e2e-impact-policy"></a>

### Что запускать при каждом изменении

| Тип изменения | Основной быстрый тест | Background E2E |
|---|---|---|
| CSS/локальный UI-компонент | Vitest related + Storybook state | Affected screen smoke, если есть пользовательское поведение |
| React route / form | TypeScript + component tests | Affected browser workflow + screenshot |
| Go pure domain | `go test ./internal/modules/...` | Не нужен автоматически |
| Connect schema / generated SDK | Buf lint/breaking + контрактные тесты | Затронутые сквозные операции |
| PG migration / authorization | Migration / negative security tests | Короткий интеграционный browser smoke |
| Wails bridge / native permissions | Go adapter tests | Native smoke в отдельном platform gate |
| Build/toolchain/CI configs | Full affected dependency graph | Расширенный набор по policy |

**Правило:** фоновые E2E — сигнал для агента, но не разрешение на merge. Только frozen candidate с чистыми inputs, текущим main и обязательным gate образует проверенный результат. Агенты не должны править тот же worktree во время финального gate. Порядок merge описан в [Работе агентов](11-agents-workflow.md#verified-merge).

---

Навигация: [← 09. Тесты и контрольные проверки качества](09-testing-quality-gates.md) · [Оглавление](README.md) · [11. Работа агентов →](11-agents-workflow.md)

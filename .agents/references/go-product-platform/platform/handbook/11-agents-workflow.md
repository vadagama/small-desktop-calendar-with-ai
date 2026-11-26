---
title: "Работа агентов и интеграция"
description: "Параллельная работа AI-агентов и владение, engineering guardrails, инструменты диагностики, политики агентов и контрольные проверки качества, соло и команда до пяти, точный кандидат и последовательный merge, Makefile-интерфейс."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 11
source: "handbook.md §12, §44, §40"
tags: [ai-agents, ownership, guardrails, quality-gates, merge, gitlab-runner, makefile, worktrees]
up: README.md
prev: 10-local-native-dev.md
next: 12-ai-sdk.md
---

# Работа агентов и интеграция

> **v16:** порядок разработки и условия переходов задаёт [SDD-процесс](19-agent-sdd.md); документацию продукта — [контракт артефактов](20-artifact-contract.md). Исторические рекомендации ниже применяются в этих границах.

**В этом документе:** [ИИ-агенты: параллельная работа и владение](#agents) · [Guardrails](#agent-guardrails) · [Инструменты диагностики](#agent-debug) · [Политики агентов и контрольные проверки качества](#agent-policy-v11) · [Соло и команда до пяти](#agent-integration-v11) · [Три режима проверки](#three-check-modes) · [Точный кандидат и merge](#verified-merge) · [Makefile-интерфейс](#make-commands)

<a name="agents"></a>

## ИИ-агенты: параллельная работа и владение

Код могут писать агенты, но **качество доказывают артефакты и тесты**, а не их текстовые заверения. На Mac с 24 ГБ RAM стартовать с 2–3 активных coding-agent worktrees, затем увеличивать параллелизм только после мониторинга RAM и длительности сборок.

<div class="diagram"><div class="diagram-title">Рисунок 4. AI harness с контролем параллельных изменений</div><div class="flowboxes stack"><div class="node">Intent + Spec + Acceptance Criteria<small>архитектурные ограничения и schema owners</small></div><div style="font-size:20px;color:#64748b">↓ task decomposition</div></div><div class="flowboxes"><div class="node">Agent A · Go domain/API<small>Рабочее дерево A</small></div><div class="node">Agent B · React UI<small>Рабочее дерево B</small></div><div class="node">Agent C · Tests/Review<small>Рабочее дерево C</small></div></div><div class="flowboxes stack"><div style="font-size:20px;color:#64748b">↓ contract merge + impact tests</div><div class="node accent">Integrator Agent<small>Buf · Go tests · Visual regressions · Architecture fitness</small></div><div style="font-size:20px;color:#64748b">↓ protected main / release</div></div></div>

**Ownership:** один агент владеет изменением `.proto` и миграций в момент интеграции; UI и API согласуются по сгенерированным контрактам. Не допускать параллельного редактирования одной миграционной истории без очереди. Конфликт — новая task или rebase, не скрытое overwrite.

<a name="agent-guardrails"></a>

### Ограничения и правила разработки с ИИ

| Инвариант | Машинная проверка |
|---|---|
| Нет изменения wire-contract без Buf | `buf lint`, `buf breaking` |
| Нет бизнес-логики в Wails/UI adapter | dependency graph / import checks |
| Транзакции и idempotency сохраняются | integration/property tests |
| Секреты не попадают в Git и prompt logs | secret scanning, egress restrictions |
| Клиент не обращается к PG/S3 admin напрямую | architecture fitness, network policy |
| Локальные worktrees изолированы | devctl resource registry tests |
| Нет безосновательных абстракций | complexity-review + review rubric |
| Финальный результат подтвержден | test artifact manifest, снимки экрана |

**Навыки по профилям:** `test-driven-development`, `systematic-debugging`, `verification-before-completion` (Superpowers), Vercel React Best Practices, официальные рекомендации shadcn, аудит безопасности Trail of Bits, внутренние `go-service-patterns`, `connect-contract-review`, `wails-security`, `worktree-isolation`, `mobile-readiness`, `sync-conflict-tests`, `complexity-review`. У сторонних навыков проверять реальную установку/версии и исполняемые скрипты; pin по commit SHA. Каталог и маршрутизация — в [Навыки ИИ](14-skills-catalog.md#skills).

<a name="agent-debug"></a>

### Инструменты диагностики для агента

Каждый agent worktree предоставляет URL приложения, structured logs, trace_id, sample SQL трассировки, снимки экрана и возможность запускать локальные команды без Docker. Сбой агент локализует через reproducible fixture и log/trace, а не многократной генерацией кода без анализа.

<a name="agent-policy-v11"></a>

## Политики для AI-агентов и контрольные проверки качества

AI-агент может **изменять код**, но не может сам себе засчитывать невыполненные проверки. Отчет содержит список команд, exit codes, длительности, ссылки на browser traces/screenshots, контентный fingerprint или точный SHA кандидата.

| Правило | Проверка |
|---|---|
| Локальная итерация не запускает OCI/native release build | devctl trace / latency budget |
| Модуль не импортирует чужой внутренний persistence | import graph / lint |
| Флаг функции не заменяет право | негативные тесты авторизации |
| Любая state transition проверяет версию и scope | race/concurrency интеграционные тесты |
| Действия обработчика задач идемпотентны | replay tests и crash-between-steps |
| Все события аналитики из словаря | event contract lint/schema tests |
| Callback/webhook не исполняется под широкими credentials | egress / SSRF / credential review |
| Отчет E2E старее исходников | `stale`, не разрешает merge |
| Нет новых инфраструктурных сервисов без ADR | `compose diff` + architecture budget |
| Стоимость package/dep оправдана | license/security/dependency-review |
| Критичные API контракты не сломаны | `buf lint`, `buf breaking` |

**Рекомендуемые навыки для harness** (включать по задаче, а не все глобально): `test-driven-development`, `systematic-debugging`, `verification-before-completion` (Superpowers); `vercel-react-best-practices`, `web-design-guidelines` (Vercel); официальные рекомендации shadcn; внутренние `go-module-boundaries`, `go-transactions`, `river-reliable-jobs`, `fsm-lifecycle`, `product-analytics-contracts`, `background-e2e`, `worktree-isolation`, `complexity-review`. Последние — **предлагаемые корпоративные навыки**, не названия подтвержденных публичных пакетов.

<a name="agent-integration-v11"></a>

## Соло и команда до пяти: один подход, разная финальная интеграция

**Одна задача — одна short-lived ветка — один worktree — один ответственный за изменяемые файлы.** Ревью/исследовательским агентам write-access обычно не нужен. Для простого сквозного изменения один агент реализует domain → API → UI → tests в одном worktree, чтобы не создавать лишние межагентные согласования.

| Аспект | Соло на Mac | Команда до пяти человек |
|---|---|---|
| Основные изменения | Нативный Go/Vite/PG, локальные агенты | Такой же LOCAL-NATIVE на машинах разработчиков |
| Готовность merge | Финальный gate через **локальный GitLab macOS runner** | На **общем** Linux runner, macOS runner для платформенных задач |
| Изоляция | Worktree и отдельные DB/ports | Worktree у каждого + CI job isolation |
| Владение фичей | Один ответственный/agent coordinator | Один fullstack feature owner |
| Параллельность | 1–2 writing агента на Mac, по измерениям | Одна основная фича на человека |
| Интеграция | Serial candidate queue | Serial MR queue либо GitLab merge trains при потребности |
| Release | Отдельный pipeline, не на каждом сохранении | То же, общие release artifacts |

**GitLab Runner shell executor** на macOS допустим для доверенного проекта, но на ноябрь 2026 он находится в maintenance mode и предоставляет слабую изоляцию: не запускать из него чужие PR с prod secrets. В командном контуре Linux Docker executor управляемее; локальный macOS runner — платформенное дополнение, а не обязательная точка отказа. [GitLab shell executor](https://docs.gitlab.com/runner/executors/shell/).

<a name="three-check-modes"></a>

### Три режима тестирования и интеграции

| Режим | Когда | Что запускается |
|---|---|---|
| `make check` / `devctl test --affected` | После содержательной правки | Fmt/lint, related unit, related component/contract |
| `devctl e2e --background` | Постоянно для активной фичи, если нужно | Chrome smoke, снимки экрана, трассировки, низкий приоритет |
| `make verify` | **Один раз на актуальном кандидате**, заново при изменении SHA/main | Full typecheck/lint, Go tests, contract/migrations, browser E2E/build |
| `make release` | Перед публикацией | Linux OCI, real desktop/mobile package, подписание, OS smoke, recovery checks |

В рабочем цикле не должно быть скрытой двойной полной проверки `pre-push full verify` и затем такого же job в GitLab на том же Mac. `make submit` подготавливает чистый кандидат и запускает runner; `make verify` — одна авторитетная реализация обязательного набора.

<a name="verified-merge"></a>

### Точный кандидат и последовательный merge

1. Координатор получает актуальный `main`, обновляет ветку и устраняет конфликты.
2. Замораживает candidate; при необходимости squash делается **до** проверки.
3. Runner проверяет конкретный commit (или merged result, где это поддерживается).
4. Если проверяемые входы candidate или base меняются, соответствующий gate запускается снова. Исключение для коммита только с отчётами — в [правилах свежести](19-agent-sdd.md#sdd-evidence); SHA проверенного кандидата сохраняется в отчёте.
5. При успехе — fast-forward merge; скрипт сверяет expected commit и current main.
6. Только после подтверждения очистить worktree/DB/ports.

**Состояние main = интегрированная прошедшая проверку версия.** Release = версия, прошедшая дополнительные платформенные проверки и опубликованная. Long-lived `dev`, `stage`, `prod` branches не нужны: окружения получают определенный артефакт.

<a name="make-commands"></a>

### Интеграционный интерфейс Makefile

```makefile
.PHONY: bootstrap dev check verify release e2e-watch
bootstrap:
	pnpm install --frozen-lockfile
	go mod download

dev:
	@echo "Запускай Go/Vite через devctl, без Docker"

check:
	go test ./internal/modules/...
	pnpm exec vitest run --changed

verify:
	go vet ./...
	go test -count=1 ./...
	buf lint
	pnpm exec tsc --noEmit
	pnpm exec vitest run
	pnpm run build
	pnpm exec playwright test --config web/playwright.config.ts --grep @smoke --workers=2

e2e-watch:
	bash scripts/e2e-watch.sh

release:
	@echo "Release gates: packaging, signing, smoke, deploy"
```

Это **интерфейс шаблона**, не универсальный готовый Makefile для любого репозитория: scripts и paths корректируются. Не использовать `go test ./internal/modules/...` как единственный тест на готовом MR, если изменения затрагивают адаптеры, миграции и безопасность.

## Назначения исполнителей

Семь ролей (документация, код, UI, ревью кода, ревью дизайна, требования,
архитектура) назначаются отдельно в engineering.yaml. Модель, провайдер и харнес
не смешиваются. Правила настройки, handoff и замены —
[модели и харнесы](../references/model-harness-configuration.md).
Матрица не является исполняемым orchestrator: нужны проверенные адаптеры/способы
запуска. Ревью независимо по контексту, даже если используется одна модель.

---

Навигация: [← 10. LOCAL-NATIVE](10-local-native-dev.md) · [Оглавление](README.md) · [12. Vercel AI SDK →](12-ai-sdk.md)

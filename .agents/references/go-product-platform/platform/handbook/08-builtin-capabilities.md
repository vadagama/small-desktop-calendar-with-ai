---
title: "Встроенные возможности монолита"
description: "Надёжные фоновые задачи на River, машины состояний (FSM) с транзакционной историей, product analytics внутри PostgreSQL, feature flags, поиск через FTS + pg_trgm и уведомления."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 8
source: "handbook.md §31–§36"
tags: [river, jobs, fsm, state-machine, analytics, usage-events, feature-flags, search, pg-trgm, notifications, webhooks]
up: README.md
prev: 07-security-identity.md
next: 09-testing-quality-gates.md
---

# Встроенные возможности монолита

**В этом документе:** [Фоновые задачи: River](#jobs-river-v11) · [Машины состояний](#fsm-engine) · [Надёжная операция перехода](#fsm-transaction) · [Таймеры и старые события](#fsm-stale-timers) · [Продуктовая аналитика](#product-analytics) · [Флаги функций](#flags-v11) · [Поиск](#search-v11) · [Уведомления](#notifications-v11)

<a name="jobs-river-v11"></a>

## Надёжные фоновые задачи внутри монолита: River

**Основной стек:** [River](https://riverqueue.com/docs) + `pgx` + PostgreSQL + Go обработчик задач. Один бинарник может запускаться как `app serve`, `app worker` или `app all` для маленького окружения. Этот же процесс в LOCAL-NATIVE запускается без контейнера, а в рабочей среде при необходимости API и обработчик задач разделяются **как режимы одного и того же репозитория и образа**, без немедленного выделения нового микросервиса.

<div class="diagram"><div class="diagram-title">Рисунок 7. Надёжная операция + надёжная фоновая задача без Redis</div><div class="flowboxes"><div class="node">Команда клиента<small>Connect RPC / Wails</small></div><div class="node accent">Прикладной сценарий Go<small>авторизация · инвариант · транзакция</small></div><div class="node">PostgreSQL COMMIT<small>данные + аудит + задача River</small></div></div><div class="flowboxes stack"><div style="font-size:18px;color:#64748b">↓ после фиксации</div><div class="node">Обработчик River<small>повторы · отмена · идемпотентность · предельный срок</small></div><div style="font-size:18px;color:#64748b">↓</div><div class="node">Внешнее действие / уведомление<small>результат записывается отдельно</small></div></div><div class="diagram-note">`go func(){...}` после ответа не является надёжная фоновая задача. River допускает повторное выполнение: побочные эффекты должны быть идемпотентны.</div></div>

**Базовые правила:**

1. Бизнес-состояние, аудит и `InsertTx` задания помещаются в **одну PG-транзакцию**. Это предотвращает ситуацию «данные записались, а намерение отправить уведомление потерялось». [River transactional enqueueing](https://riverqueue.com/docs/transactional-enqueueing).
2. Воркеры имеют ограниченный параллелизм, контексты отмены, deadline, retry с jitter и устойчивые idempotency keys.
3. Внешняя система может выполнить действие, после чего обработчик задач упадет до отметки об успехе: при повторе нужен dedupe/сверка. **At-least-once**, не exactly-once.
4. Для нескольких API-инстансов и при перерастании ресурса выделяется `app worker` в отдельный процесс, оставляя общую кодовую базу.
5. Отдельный outbox не нужен только ради передачи задач в River в той же транзакции; для публикации независимых интеграционных событий может потребоваться отдельный outbox.
6. **River Pro Workflows** — платный дополнительный модуль для оркестрации графов задач и сигналов; не включать Pro-функции в базовый набор с открытым исходным кодом. [River Pro](https://riverqueue.com/docs/pro).

Состояния заданий и процессные бизнес-состояния различны: `job.retrying` — техническая попытка, `entity.approved` — бизнес-факт.

<a name="fsm-engine"></a>

## Машины состояний: явно, типизированно, с транзакционной историей

**Три независимые ответственности:** FSM определяет допустимые переходы; PostgreSQL сохраняет состояние и защищает конкурентность; River исполняет последующие/отложенные действия. Библиотека FSM сама по себе **не workflow engine и не транзакционная БД**.

| Вариант | Когда выбирать | Особенности |
|---|---|---|
| Простой `switch` + typed constants | 2–4 состояния и несколько простых переходов | Самый маленький и прозрачный код |
| [qmuntal/stateless](https://github.com/qmuntal/stateless) | **Основной кандидат**, guards, иерархия, несколько жизненных циклов | Hierarchical FSM, permitted triggers, DOT visualisation |
| [looplab/fsm](https://github.com/looplab/fsm) | Простая плоская таблица переходов | Модель компактнее, встроенный Mermaid экспорт |
| River + PG | Таймеры, retry, этапы фоновой обработки | Не подменяет собственно бизнес-модель состояний |
| River Pro Workflows | Долговечный DAG, сигналы, fan-out/fan-in | Отдельное коммерческое расширение, не default |

<div class="diagram"><div class="diagram-title">Рисунок 8. Обобщённый жизненный цикл сущности</div><div class="flowboxes"><div class="node">draft<small>Создана</small></div><div style="font-size:18px;color:#64748b">→</div><div class="node">in_review<small>Проверяется</small></div><div style="font-size:18px;color:#64748b">→</div><div class="node accent">approved<small>Разрешено действие</small></div><div style="font-size:18px;color:#64748b">→</div><div class="node">active<small>Действует</small></div><div style="font-size:18px;color:#64748b">→</div><div class="node">archived<small>Закрыта</small></div></div><div class="diagram-note">`in_review → draft` означает доработку. Guard проверяет готовность, authorization — право конкретного пользователя, DB constraint — сохранность инварианта. Сигналы для прошлых циклов не должны влиять на текущий.</div></div>

<a name="fsm-transaction"></a>

### Надёжная операция перехода

1. Начать PG-транзакцию и загрузить запись по фактической области видимости пользователя.
2. Проверить `command_id` (повтор) и право выполнить действие.
3. Защитить состояние от гонки: `SELECT … FOR UPDATE` либо optimistic `row_version`.
4. Проверить бизнес-guards, вычислить новый state через чистый FSM.
5. Сохранить state, `row_version + 1`, запись `state_transitions` с actor/time/definition_version.
6. При необходимости транзакционно поставить River job (уведомление, интеграция, deadline).
7. COMMIT; внешние HTTP/SMTP/S3 эффекты выполнять **после** COMMIT в обработчик задач.

```go
// Типизированное ядро для простого FSM: без сети, SQL и таймеров.
package workflow

import "errors"

type State string
type Event string
const (
    Draft State = "draft"
    Review State = "in_review"
    Approved State = "approved"
    Active State = "active"
)
const (
    Submit Event = "submit"
    Approve Event = "approve"
    Activate Event = "activate"
)
var ErrInvalidTransition = errors.New("invalid transition")

func Next(current State, event Event, checksPassed bool) (State, error) {
    switch {
    case current == Draft && event == Submit:
        return Review, nil
    case current == Review && event == Approve && checksPassed:
        return Approved, nil
    case current == Approved && event == Activate:
        return Active, nil
    default:
        return "", ErrInvalidTransition
    }
}
```

Для сложной модели заменить логику `switch` на `qmuntal/stateless`, оставив **ту же внешнюю транзакционную границу**. Нельзя полагаться, что `FireCtx` автоматически откатывает SQL при ошибке callback: библиотека управляет in-memory состоянием, а не распределенными транзакциями.

<a name="fsm-stale-timers"></a>

### Таймеры, ожидания и старые события

**Критичный инвариант:** запланированный таймер/ответ внешней системы содержит `step_instance_id` или `round_version`. Worker перед действием сравнивает текущий ID этапа, deadline и актуальность версии записи. Проверка одного `state == in_review` ошибочна: процесс мог вернуться в то же состояние уже во втором цикле.

Хранить `entity_id`, `state`, `row_version`, `definition_version` (если процессы долгие), `step_instance_id`, `deadline_at`. Таймеры River создаются по `ScheduledAt`, но **не гарантируют выполнение ровно в назначенную секунду**. Вызов cron или постоянно спящая goroutine не заменяют persisted timers.

**Проверять:** одновременные Approve/Reject, повтор команды, restart между COMMIT и внешним действием, поздний ответ старой попытки, долгий зависший этап, смена определения FSM. Для моделей состояния полезны тесты свойств и генерация диаграмм из кода, а не независимая диаграмма, которую агент забудет обновить.

<a name="product-analytics"></a>

## Продуктовая аналитика внутри PostgreSQL

Аналитика использования отвечает на вопрос, **как реально используются возможности продукта**, а не заменяет аудит или показатели бизнес-предметной области. События не равны просмотрам страницы; одни нужны для UX-воронки, другие — для доказательства совершившейся операции.

| Тип | Пример вопроса | Основное место |
|---|---|---|
| Бизнес-KPI | Какая доля операций выполнена своевременно? | Предметные таблицы и агрегаты PG |
| Product usage | На каком шаге прерывается импорт? | `usage_events` с schema/version |
| Audit | Кто изменил настройки доступа? | `audit_events`, отдельная политика хранения |
| Technical telemetry | Почему вызов API стал медленным? | Метрики/логи/traces |

**Профиль P0:** `internal/modules/analytics`, таблица `usage_events`, `pgx/sqlc`, периодические агрегаты SQL через River, графики React [shadcn charts / Recharts](https://ui.shadcn.com/docs/components/base/chart). В одной транзакции с бизнес-операцией фиксировать именно бизнес-факт, когда это требуется; необязательный UX-clickstream направлять в ограниченную буферизованную очередь с retention и управлением пропусками.

<a name="usage-schema"></a>

### Схема событий использования

```sql
CREATE TABLE usage_events (
    event_id       uuid PRIMARY KEY,
    event_name     text NOT NULL,
    event_version  integer NOT NULL,
    occurred_at    timestamptz NOT NULL,
    received_at    timestamptz NOT NULL DEFAULT now(),
    user_id        uuid,
    organization_id uuid,
    session_id     text,
    platform       text NOT NULL,
    app_version    text,
    properties     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX usage_events_org_time_idx
    ON usage_events (organization_id, occurred_at DESC);
CREATE INDEX usage_events_name_time_idx
    ON usage_events (event_name, occurred_at DESC);
```

Пример словаря **нейтральных** событий: `resource_opened`, `edit_started`, `resource_saved`, `workflow_activated`, `file_uploaded`, `search_used`, `import_started`, `import_completed`, `import_failed`. Имена и обязательные свойства версионировать в contract catalog; не позволять каждому агенту придумывать альтернативные синонимы.

**Правила безопасности и качества:** `user_id` и `organization_id` для серверных событий берутся из проверенного контекста; события клиента валидируются и ограничиваются по размеру; `occurred_at` ≠ `received_at` (offline); дедуп по `event_id`; выборочное PII; TTL и агрегация; отчетные запросы учитывают tenant scope; ошибочный аналитический сбор не блокирует основную бизнес-операцию, если это не часть обязательного аудита.

<a name="analytics-external"></a>

### Когда нужен готовый сервер аналитики

| Система | Что дает | Решение |
|---|---|---|
| **PG + SQL** | Несколько точных панелей в продукте | **Основная рекомендация** |
| [Umami](https://docs.umami.is/docs) self-hosted | Web UI, события, funnels, retention, cohorts | Один **общий** инстанс для семейства продуктов, если нужно |
| [PostHog](https://posthog.com/docs) | Широкая продуктовая аналитика, experiments, replay | По требованиям команды; учитывать данные/лицензии и privacy |

Стабильный внутренний distinct identifier нужен при общей офисной сети и VPN: случайное объединение пользователей по IP/UA не является надежной аналитикой. Нельзя совмещать идентификацию из analytics SDK с моделью авторизации.

<a name="flags-v11"></a>

## Флаги функций и безопасные переключатели поэтапного внедрения

**Рекомендация:** [GO Feature Flag](https://gofeatureflag.org/docs/go_module/getting-started) **как прямой Go Module**, с файлом конфигурации и локальным вычислением внутри приложения. Отдельный relay-proxy не требуется. OpenFeature provider может иметь дополнительные зависимости, поэтому не вводить его автоматически для профиля без внешних сервисов.

```yaml
# flags.yaml — пример совместимого по смыслу rollout;
# реальные правила и идентификаторы audience закрепляются в продукте.
new-editor:
  variations:
    enabled: true
    disabled: false
  defaultRule:
    percentage:
      enabled: 10
      disabled: 90
```

Пример реального API: `ffclient.BoolVariation("new-editor", ffcontext.NewEvaluationContext(subjectKey), false)`; вызвать его в модуле флагов и скрыть за собственным интерфейсом, чтобы доменная логика не зависела от имени библиотеки. Важно выбрать **стабильный subject key** (`organization_id`/workspace ID), если два сотрудника не должны видеть противоречащие версии поведения.

**Не использовать feature flags как авторизацию.** Сервер проверяет право на операцию независимо от флага (см. [identity и права](07-security-identity.md#identity-access-v11)). Для выведенных из эксплуатации флагов установить deadline удаления, иначе библиотека превратится в постоянно растущий слой ветвлений. Эксперименты оценивать по заранее определённым метрикам, а не по количеству просмотров.

<a name="search-v11"></a>

## Поиск: PostgreSQL FTS + pg_trgm прежде внешнего движка

| Тип поиска | Профиль |
|---|---|
| ID, код, штрихкод, точный ключ | B-tree индекс, равенство/префикс по подходящему оператору |
| Названия и неполные слова | `pg_trgm` + GIN/GiST по измеренному запросу |
| Описания/комментарии/документы | Полнотекстовый поиск `tsvector/tsquery`, GIN |
| Фасетные фильтры и сортировка | SQL + правильные составные индексы |
| Семантический поиск | Опциональный `pgvector` / внешний retrieval после PoC |

`pg_trgm` официально поддерживает индексы и операторы сходства; для FTS GIN обычно предпочтителен. См. [PostgreSQL FTS](https://www.postgresql.org/docs/current/textsearch.html) и [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html).

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX records_title_trgm_idx
  ON records USING gin (title gin_trgm_ops);
-- Пример; tenant restriction обязательна.
SELECT id, title
FROM records
WHERE organization_id = $1
  AND title ILIKE '%' || $2 || '%'
ORDER BY title
LIMIT 50;
```

**Языки, морфология, транслитерация и сокращения** требуют реального словаря тестовых запросов и проверки качества выдачи, особенно для RU/KZ. Данные другого tenant не должны раскрыться через списки, счетчики, экспорт или autocomplete.

<a name="notifications-v11"></a>

## Уведомления, email, web push и интеграции

`notifications` — предметный модуль: inbox, unread, связь с объектом, каналы, mute, дедуп, read receipts, индивидуальные настройки. Доставка — задания River с повторные попытки и состоянием результата; при сбое SMTP бизнес-операция остается успешной, если уведомление не является частью обязательного условия.

| Канал | Библиотека/механизм | Когда |
|---|---|---|
| Встроенные уведомления | PG tables + Connect reads + WebSocket events | **По умолчанию** |
| Email | [wneessen/go-mail](https://github.com/wneessen/go-mail) + `html/template` + существующий SMTP | Включать по требованиям |
| Web Push | [webpush-go](https://github.com/SherClockHolmes/webpush-go), service обработчик задач, VAPID | Когда нужно уведомление без открытой вкладки |
| Mobile push | APNs/FCM через нативный SDK/bridge | Отдельная интеграция iOS/Android |
| Webhooks | `net/http` + River deliveries + подписанные payloads | Внешние подписчики |

**Webhooks:** хранить `delivery_id`, `endpoint`, `event_id`, `attempt`, `next_attempt_at`, статус, ответ со скрытыми чувствительными данными, ключ идемпотентности; использовать HTTPS, HMAC-подпись + timestamp/replay window, список разрешений / защита от SSRF; ограничивать redirects и сети. Повтор не должен создавать повторную бизнес-операцию у получателя. Ретрай и возможность replay отображать в административном интерфейсе.

**Локально:** проверять email по EML-файлу / тестовому SMTP sink, а webhook — через mock server без реального выхода в интернет. Отправлять реальные письма из feature worktree запрещено по умолчанию.

---

Навигация: [← 07. Безопасность](07-security-identity.md) · [Оглавление](README.md) · [09. Тесты и контрольные проверки качества →](09-testing-quality-gates.md)

---
title: "Архитектура: границы и модульный монолит"
description: "Архитектурные границы и слои, модель доменного инварианта, модульный Go-монолит без инфраструктурной избыточности, модуль ≠ плагин ≠ сервис, проверяемые инварианты, матрица возможностей и критерии выделения модуля в сервис."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 2
source: "handbook.md §2, §26, §27, §43"
tags: [architecture, modular-monolith, domain, invariants, capability-matrix, service-extraction]
up: README.md
prev: 01-overview.md
next: 03-platforms-ui.md
---

# Архитектура: границы и модульный монолит

**В этом документе:** [Архитектурные границы и модули](#architecture) · [Модель доменного инварианта](#domain-code) · [Главный стандарт v11: модульный Go-монолит](#modular-plugins) · [Модуль ≠ плагин ≠ отдельный сервис](#module-plugin-service) · [Границы и проверяемые инварианты](#module-invariants) · [Матрица возможностей](#capability-matrix) · [Когда выносить модуль в сервис](#extraction-v11)

<a name="architecture"></a>

## Архитектурные границы и модули

**Базовый стиль:** прагматичный модульный монолит. Разработка по feature, а не по искусственным горизонтальным слоям. Операции и доменные инварианты живут в общих пакетах Go; приложения содержат только адаптеры под их платформу.

| Слой | Что содержит | Чего не содержит |
|---|---|---|
| `domain` | правила, значения, состояния, проверки | HTTP, SQL, Wails, UI, SDK |
| `application` | use cases, транзакционные границы как интерфейсы | JSX, HTTP handlers |
| `adapters/postgres` | SQL, pgx, миграции | доменные правила в SQL-триггерах без ADR |
| `adapters/sqlite` | локальные операции и миграции | серверные RLS-политики |
| `adapters/connect` | Protobuf mapping, перехватчики аутентификации | обход бизнес-сервисов |
| `adapters/wails` | JS→Go методы, platform permissions | независимые бизнес-правила |
| `apps/mobile-native` | Swift/Kotlin UI и platform API | несанкционированная запись в серверную БД |

**Не требовать** реализации Repository, Unit of Work, Factory и Adapter для каждой CRUD-функции. Trait/interface добавляется там, где есть настоящая изменяемая граница или тестовая подмена. Контракты и инварианты обязательны; количество абстракций минимально.

<a name="domain-code"></a>

### Модель доменного инварианта

```go
package resource

import "errors"

type Element struct {
    ID       string
    WidthMM  int
    XMM      int
}

type Container struct { WidthMM int }

var ErrOutOfBounds = errors.New("element outside container")

func ValidatePlacement(s Container, f Element) error {
    if f.WidthMM <= 0 || f.XMM < 0 || f.XMM+f.WidthMM > s.WidthMM {
        return ErrOutOfBounds
    }
    return nil
}
```

Та же функция вызывается из Connect API и Wails, а на мобильном клиенте — только если выбран Go-бэкенд внутри приложения или создан осознанный Go native binding. См. [API и realtime](04-api-realtime.md#protocols) и [Платформы](03-platforms-ui.md).

<a name="modular-plugins"></a>

## Главный стандарт v11: модульный Go-монолит без инфраструктурной избыточности

**Нормативное решение.** Базовое приложение запускает один Go-процесс, одну PostgreSQL и один Vite-сервер только во время разработки. Пользователи, прикладные права, аудит, аналитика, уведомления, поиск, флаги, фоновые задания и машины состояний — **модули и библиотеки внутри Go-приложения**. Общая корпоративная инфраструктура подключается через адаптер, но не запускается по отдельному экземпляру на каждый продукт.

<div class="diagram"><div class="diagram-title">Рисунок 6. Приоритет встроенных модулей: модули внутри одного процесса, сервисы — за границей</div><div class="flowboxes"><div class="node">React / Web<small>Connect с бинарным Protobuf</small></div><div class="node">Настольное приложение Wails<small>Ядро Go + SQLite</small></div><div class="node">Нативные мобильные приложения<small>SwiftUI / Compose по требованиям</small></div></div><div class="flowboxes stack"><div style="font-size:20px;color:#64748b">↓ API / Wails adapters</div><div class="node accent" style="min-width:76%">Модульный Go-монолит<small>Доменные модули · доступ · аналитика · аудит · задачи · FSM · флаги · уведомления · обмен в реальном времени</small></div><div style="font-size:18px;color:#64748b">↓ локальные вызовы · транзакции · интерфейсы только на границах</div></div><div class="flowboxes"><div class="node">PostgreSQL<small>данные · очередь · события · FTS</small></div><div class="node">OS / Files<small>файлы · локальная SQLite</small></div><div class="node">Опциональные подключения<small>IdP · S3 · OpenBao · общий мониторинг</small></div></div><div class="diagram-note">Внутри монолита нет сетевого RPC между модулями. Connect работает с клиентами, а WebSocket обслуживает событийный канал. Плагины не должны владеть чужими таблицами напрямую.</div></div>

<a name="module-plugin-service"></a>

### Модуль ≠ плагин ≠ отдельный сервис

| Подход | Что означает | Когда выбирать |
|---|---|---|
| **Встроенный модуль** | Обычный Go-пакет с явными экспортируемыми функциями; собирается в один бинарник | **По умолчанию**, основная бизнес-функциональность |
| **Плагин времени компиляции** | Подключаемая при сборке реализация интерфейса, включение через конфигурацию или профиль сборки | Несколько необязательных возможностей и адаптеров |
| **Runtime plugin** | Отдельно загружаемый исполняемый модуль с политиками и жизненным циклом | Когда реально нужен динамический marketplace / сторонний код |
| **Отдельный сервис** | Собственный процесс, сетевой контракт, мониторинг и развертывание | Независимый runtime, ресурсы, безопасность или жизненный цикл |

Не использовать Go `plugin` / `.so` как основу общей системы расширений: переносимость и строгая совместимость компилятора/зависимостей усложняют build и поддержку. Для большинства задач **компоновка через обычные пакеты Go и явный реестр** надежнее и быстрее. Если в будущем появятся недоверенные сторонние расширения, рассматривать отдельный процесс или sandboxed Wasm (например, [wazero](https://github.com/tetratelabs/wazero)) после анализа угроз; это не обязательный базовый вариант.

```go
// Упрощённый compile-time registry. Плагины собираются вместе с программой.
// Инициализация явная; это не динамическая загрузка .so.
package platform

type Module interface {
    Name() string
    Start() error
    Stop() error
}

type Registry struct{ modules []Module }

func NewRegistry(modules ...Module) *Registry {
    return &Registry{modules: modules}
}

func (r *Registry) Start() error {
    for _, module := range r.modules {
        if err := module.Start(); err != nil { return err }
    }
    return nil
}
```

**Улучшение для рабочая среда:** передавать `context.Context` в lifecycle, останавливать в обратном порядке, не реализовывать общий `Module` там, где простая функция инициализации короче. Реестр — шаблон для расширяемой платформы, не обязательная обертка всех пакетов.

<a name="module-invariants"></a>

### Границы и проверяемые инварианты

| Инвариант | Как проверять |
|---|---|
| У каждого модуля есть владелец данных и публичные операции | `internal/<feature>` + import graph; документация контрактов |
| Изменение чужих данных происходит через API владельца | Архитектурные тесты импортов и интеграционные тесты |
| Один прикладной сценарий определяет транзакционную границу | DB tests: атомарность, отказ, конкурентные изменения |
| Нет «универсального Repository» без реального случая | complexity-review по каждому MR |
| Модуль можно проверить без HTTP, Wails и OIDC-сервера | `go test ./internal/<module>/...` |
| Отключение опционального модуля не ломает Core | Сборка и smoke с feature profile `minimal` |
| Все внешние действия идемпотентны или имеют компенсацию | тесты повторного воспроизведения и внедрения сбоев |
| Обратная совместимость клиентских API контролируется | Buf breaking, contract тестовые данные |

Структура модулей — **feature-first**, а не отдельные гигантские слои `handlers`, `services`, `repositories` на весь продукт:

```text
internal/
  modules/
    identity/         # прикладные профили и membership
    access/           # права и ресурсные области
    audit/            # неизменяемая семантика событий
    analytics/        # продуктовые события и агрегации
    notifications/    # уведомления / email / webhooks
    jobs/             # River workers + handlers
    workflow/         # FSM и переходы
    search/           # SQL FTS / pg_trgm
    flags/            # локальное вычисление флагов
    realtime/         # WebSocket event gateway
    records/          # пример произвольного доменного модуля
  platform/           # cfg, db, auth adapter, logging
apps/
  server/             # тонкая компоновка модулей и API
  desktop/            # Wails + shared Go Core
packages/
  ui/                 # общая React дизайн-система
```

Детализация отдельных модулей: [River-задачи](08-builtin-capabilities.md#jobs-river-v11), [FSM](08-builtin-capabilities.md#fsm-engine), [Analytics](08-builtin-capabilities.md#product-analytics), [Флаги](08-builtin-capabilities.md#flags-v11), [Поиск](08-builtin-capabilities.md#search-v11), [Уведомления](08-builtin-capabilities.md#notifications-v11), [Обмен в реальном времени](04-api-realtime.md#realtime-v11), [Identity и права](07-security-identity.md#identity-access-v11).

<a name="capability-matrix"></a>

## Матрица возможностей: что встроить, что подключать

| Возможность | Минимальный встроенный профиль | Когда подключать внешнюю систему |
|---|---|---|
| Пользователи, membership | `users`, `external_identities`, memberships в PG | Общая корпоративная директория/SSO |
| Вход | OIDC adapter к существующему IdP; автономный login только по требованию | MFA, централизованное управление учетками |
| Права | Go policy + scope в PG, затем Casbin при усложнении | OpenFGA при межпродуктовом графе отношений |
| Сессии | [SCS](https://github.com/alexedwards/scs) + PG при cookie-based web auth | Особые распределённые требования |
| Секреты | Защищённый файл / SOPS+age | Общий OpenBao при ротации/PKI/динамических credentials |
| Логи | `log/slog` в stdout, ротация среды | Общий централизованный поиск и архив |
| Метрики | `prometheus/client_golang` endpoint | Общий Prometheus/Grafana для истории и alerting |
| Бизнес-аудит | PG + запись в той же транзакции | WORM/независимый аудит при регуляторных требованиях |
| Фоновые задания | River + PG, обработчик задач в том же Go binary | Отдельный процесс обработчик задач при нехватке ресурсов |
| Кэш | Go `sync.Map` / bounded cache, затем Ristretto v2 | Общий Redis только по измеренной потребности |
| Поиск | PG FTS + `pg_trgm` | Специализированный движок при доказанной необходимости |
| Продуктовая аналитика | PG `usage_events` и SQL агрегаты | Общий Umami/PostHog при сложных воронках |
| Флаги функций | GO Feature Flag — прямой Go Module | Общая flag platform при управлении многими продуктами |
| Уведомления | Модуль PG + River + SMTP | Независимый provider / push service по требованиям |
| Обмен в реальном времени | coder/websocket + Protobuf | Межрепличный pub/sub при нескольких API-инстансах |
| Машины состояний | Go `switch` / stateless + PG transitions | Durable orchestration только для сложных workflow |
| Файлы | Локальные файлы с backup или корпоративный S3 | RustFS только если действительно нужен свой S3 runtime |

Это **не полный перечень сервисов, которые необходимо поднять локально**. Многие строки — функции одного backend-бинарника. Набор зависит от продукта; модули не используются «про запас».

<a name="extraction-v11"></a>

## Когда выносить модуль в сервис — проверяемые критерии

| Наблюдаемая проблема | Сначала что делать | Когда оправдан сервис |
|---|---|---|
| API тормозит из-за CPU-heavy jobs | Отдельный `app worker`, ограниченный параллелизм | Независимый GPU/runtime, масштабирование/изоляция ресурсов |
| Частый startup/redeploy при изменениях одного модуля | Сократить зависимости пакетов, CI affected, режим отдельного бинарного файла | Независимый цикл выпуска с владельцами и SLA |
| Права сложны в одном продукте | Casbin / PG graph в модуле | Общие межпродуктовые relationship policies |
| Секреты сложно ротировать | SOPS + bootstrapped secrets | Shared OpenBao для PKI/dynamic credentials |
| Нужен realtime между репликами | PG signal + revision log | Отдельная broker/service при throughput/HA |
| PG FTS не справляется с качеством поиска | Индексы, язык, метрики качества | Измеренный search/retrieval engine |
| Аудит должен быть tamper-resistant | Append-only + restricted roles | Независимый WORM/архив |
| Требуется аналитика воронок и cohorts | PG агрегаты и дашборды | Shared Umami/PostHog |
| Команда разрабатывает независимо | Feature владение, boundaries, CI tests | Разделение только при устойчивой самостоятельности |

**Правило ADR:** выделение сервиса требует (1) измеренную проблему, (2) SLA/ownership, (3) границу данных и консистентности, (4) стоимость дополнительной эксплуатации, (5) rollback plan. «В модуле много строк» не является достаточным основанием. Решения фиксируются в [ADR](16-evolution-adrs.md#adr).

---

Навигация: [← 01. Решение и целевая модель](01-overview.md) · [Оглавление](README.md) · [03. Платформы →](03-platforms-ui.md)

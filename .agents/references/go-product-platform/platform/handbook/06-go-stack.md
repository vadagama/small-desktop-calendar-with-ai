---
title: "Стек Go-бэкенда"
description: "Технологический стек серверной части на Go, Обработчик сервиса Connect и граница с доменной логикой, компактный каталог проверенных Go-библиотек и анти-рекомендации."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 6
source: "handbook.md §8, §42"
tags: [go, backend, connect, pgx, sqlc, libraries, catalog, stack]
up: README.md
prev: 05-data-offline.md
next: 07-security-identity.md
---

# Стек Go-бэкенда

**В этом документе:** [Технологический стек серверной части на Go](#go-stack) · [Обработчик сервиса Connect: граница с доменной логикой](#go-handler) · [Каталог проверенных Go-библиотек](#library-catalog)

<a name="go-stack"></a>

## Технологический стек серверной части на Go

| Категория | Выбор | Объяснение |
|---|---|---|
| HTTP/RPC | `net/http`, Connect-Go | HTTP совместимость и генерация контрактов |
| Routing (если нужен REST) | chi | Небольшой дополнительный маршрутизатор |
| PostgreSQL | pgx/pgxpool | Драйвер и connection pooling |
| SQL types | sqlc | Генерация типизированных SQL функций |
| Миграции | goose / atlas | Версионирование и проверяемый rollout |
| Concurrency | goroutines, `context`, `errgroup` | Cancellation и ограниченный параллелизм |
| Structured logs | `log/slog` / zap | Корреляционные поля и redaction |
| Observability | OpenTelemetry, Prometheus, pprof | Traces, metrics, profiling |
| Configuration | env + typed parsing | Не хранить секреты рабочей среды в env files |
| Jobs | Обработчик задач с хранением в PostgreSQL | Надежное исполнение и повторные попытки |
| CLI | Cobra или стандартный `flag` | Для devctl / эксплуатационные операции |
| Checks | go test, race, govulncheck, fuzz | Безопасность и корректность |

В приложении предусмотреть структурированные ошибки, передача предельного срока выполнения, ограниченный пул, корректное завершение работы, ограничения размера запросов, перехватчики аутентификации, ограничение частоты запросов и транзакции. Обработчик HTTP не должен самостоятельно изменять состояние в нескольких подсистемах без idempotency/outbox.

<a name="go-handler"></a>

### Обработчик сервиса Connect: граница с доменной логикой

```go
// Иллюстрация обработчика: типы Request/Response генерируются Buf.
type ResourceServer struct {
    Service *application.ResourceService
}

func (s *ResourceServer) MoveElement(
    ctx context.Context,
    req *connect.Request[resourcev1.MoveElementRequest],
) (*connect.Response[resourcev1.MoveElementResponse], error) {
    principal, err := auth.FromContext(ctx)
    if err != nil { return nil, connect.NewError(connect.CodeUnauthenticated, err) }
    revision, err := s.Service.MoveElement(ctx, principal, req.Msg)
    if err != nil { return nil, mapDomainError(err) }
    return connect.NewResponse(&resourcev1.MoveElementResponse{Revision: revision}), nil
}
```

`application.ResourceService`, `auth.FromContext` и `mapDomainError` — проектные функции. В полноценной реализации proto DTO следует трансформировать в доменный command на границе адаптера; код приведен для понимания, не как готовый компилируемый сервис. Контракты описаны в [API и realtime](04-api-realtime.md#protocols).

<a name="library-catalog"></a>

## Проверенные Go-библиотеки — компактный рекомендуемый каталог

Список ниже — **кандидаты по официальным репозиториям и документации**, а не обязательные зависимости любого приложения. Наборы должны быть зафиксированы по версиям, лицензии и policy update; не принимать сторонние skills/библиотеки без проверки supply chain.

| Возможность | Основной выбор | Альтернатива / когда не ставить |
|---|---|---|
| API | [Connect-Go](https://connectrpc.com/docs/go/getting-started/), Go `net/http` | chi для дополнительного routing; гRPC native по требованиям |
| SQL PG | [pgx](https://github.com/jackc/pgx) + [sqlc](https://sqlc.dev/) | `database/sql` для простых сценариев |
| DB migrations | [goose](https://github.com/pressly/goose) | Atlas при сложной схеме, но не оба одновременно |
| OIDC | [coreos/go-oidc](https://github.com/coreos/go-oidc) + `x/oauth2` | локальная авторизация только по отдельному решению |
| Сессии | [SCS](https://github.com/alexedwards/scs) + pgxstore | не нужна для stateless API с подходящей token policy |
| AuthZ | Go policy/PG membership → [Casbin](https://casbin.org/) | OpenFGA только для графа отношений |
| Jobs | [River](https://riverqueue.com/docs/) core | `go func` только для best-effort; River Pro не free базовый вариант |
| FSM | [qmuntal/stateless](https://github.com/qmuntal/stateless) | [looplab/fsm](https://github.com/looplab/fsm), либо простой Go switch |
| Флаги функций | [GO Feature Flag](https://gofeatureflag.org/docs/go_module/getting-started) direct module | Нет флагов, если продукт их не требует |
| Обмен в реальном времени | [coder/websocket](https://github.com/coder/websocket) | Обычные серверные события — Потоковая передача от сервера Connect |
| Logs | Go [`log/slog`](https://go.dev/blog/slog) | Не вводить сложный logger без причины |
| Metrics | [prometheus/client_golang](https://github.com/prometheus/client_golang) | Расширенный monitoring — shared окружение |
| Traces | [OpenTelemetry Go](https://opentelemetry.io/docs/languages/go/) | Для маленького приложения сначала correlation IDs |
| In-memory cache | stdlib / [Ristretto v2](https://github.com/dgraph-io/ristretto) | Redis при настоящем shared state |
| Поиск | [PG FTS](https://www.postgresql.org/docs/current/textsearch.html) + [pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html) | отдельный search engine не по умолчанию |
| Analytics | Собственный PG events + SQL + Recharts | Umami/PostHog как **общий** продуктовый сервис |
| Email | [wneessen/go-mail](https://github.com/wneessen/go-mail) | существующий SMTP, не создавать mail server |
| Web Push | [webpush-go](https://github.com/SherClockHolmes/webpush-go) | только при потребности в браузерных уведомлениях |
| Секреты конфигурации | SOPS + age, env/Compose secrets | shared OpenBao при ротации и audit |
| GPU | Базовые показатели CPU/GC Go, опциональный нативный обработчик GPU | Rust/wgpu/Metal только после benchmark |
| File watching | [watchexec](https://watchexec.github.io/), опционально Air | Dev tools **не входят в бинарный файл рабочей среды** |
| E2E | [Playwright](https://playwright.dev/docs/intro) + фоновое наблюдение | автоматизация нативного Wails отдельно |
| Plugin sandbox | compile-time Go registry | wazero/Wasm только при внешнем недоверенном коде |

**Чего не рекомендую в базовый вариант:** google/wire (проект архивирован в 2025), динамический Go `.so` как основа расширений, отдельный Redis ради сессий, отдельный RabbitMQ ради уведомлений, ELK/Loki на продукт, общий BPM engine для двух состояний. [Wire status](https://github.com/google/wire).

Применение этих библиотек во встроенных возможностях монолита — в документе [Встроенные возможности](08-builtin-capabilities.md).

---

Навигация: [← 05. Данные и offline](05-data-offline.md) · [Оглавление](README.md) · [07. Безопасность →](07-security-identity.md)

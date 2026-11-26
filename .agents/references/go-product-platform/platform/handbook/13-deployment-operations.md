---
title: "Развёртывание и эксплуатация"
description: "VM + Docker Compose как основной production-профиль, рабочая среда policies, контракт процесса выпуска, Compose-пример, рабочая среда readiness, техническая наблюдаемость и бизнес-аудит."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 13
source: "handbook.md §14, §41, §17, §30"
tags: [deployment, docker-compose, vm, release-pipeline, readiness, observability, audit, backup, slo]
up: README.md
prev: 12-ai-sdk.md
next: 14-skills-catalog.md
---

# Развёртывание и эксплуатация

**В этом документе:** [Инфраструктура: VM + Docker Compose](#deployment) · [Правила эксплуатации](#deployment-policies) · [Контракт процесса выпуска](#release-pipeline) · [Минимальный Compose](#compose-example) · [Развёртывание без смены архитектуры](#compose-v11) · [Готовность к эксплуатации](#operations) · [Наблюдаемость и бизнес-аудит](#embedded-observability)

<a name="deployment"></a>

## Инфраструктура без переписывания: VM + Docker Compose

**Первый и основной развёртывание в рабочей среде:** Linux VM + неизменяемый OCI-образ Go API + PostgreSQL + обратный прокси (Caddy). Rauthy, RustFS, OpenBao и sync-service подключаются только по выбранному профиль возможностей; для нескольких продуктов предпочтительны общие существующие сервисы. **Второй профиль:** Kubernetes с тем же Go API image, но другой слой оркестрации. На локальном Mac Docker не нужен. На VM Docker — нормальный способ доставки воспроизводимого приложения.

<div class="diagram"><div class="diagram-title">Рисунок 5. Приоритет VM: расширенный профиль (IdP/S3/OpenBao опциональны)</div><div class="flowboxes stack"><div class="node accent" style="min-width:65%">Linux VM · Docker Compose<small>изоляция сети · постоянные тома · проверки состояния</small></div></div><div class="flowboxes"><div class="node">Caddy<small>Завершение TLS</small></div><div class="node">Go API + ресурсы React<small>Connect-Go · health</small></div><div class="node">PostgreSQL 18<small>Резервное копирование с PITR</small></div></div><div class="flowboxes"><div class="node">Rauthy<small>OIDC</small></div><div class="node">RustFS<small>S3</small></div><div class="node">OpenBao<small>Секреты + хранилище Raft</small></div></div><div class="diagram-note">На минимальной VM достаточно Caddy + Go API + PostgreSQL. Rauthy/RustFS/OpenBao, Agent Service и Electric/PowerSync — подключаемые по запросу / общие интеграции. Одна VM — единая точка отказа.</div></div>

<a name="deployment-policies"></a>

### Правила эксплуатации

- В Git хранятся манифест Compose, зафиксированные хеши образов, Caddyfile, политики и шаблоны OpenBao, migrations, runbooks и манифест выпуска. **Не хранятся секреты рабочей среды в открытом виде.**
- Go API/React можно отдавать из одного Go binary/container, либо выделить статические assets через обратный прокси, если это проще.
- Миграции — одноразовая отдельная команда до rollout, **expand-contract**, предварительно проверенная на чистой и предыдущей схеме. `down` не всегда безопасен: для данных сначала forward-fix и backup plan.
- Healthchecks для Go API и PostgreSQL; для Rauthy, RustFS, OpenBao — только если включены; readiness отличается от process-alive. `depends_on` без health не гарантирует готовность приложения.
- Одна VM не обеспечивает HA: для рабочая среда определить допустимый RPO/RTO, независимые backup stores, PITR и restore-drills. OpenBao требует bootstrap/unseal и план ротации.
- Для сетевых RPC прокси должен корректно передавать protobuf Content-Type и потоковые ответы; переключение на WebSocket должен быть явным.

<a name="release-pipeline"></a>

### Контракт процесса выпуска

`commit → tests → buf breaking → go build → OCI/SBOM/signature → migration check → VM deploy via Ansible + Compose → smoke → promote`. K8s профиль использует тот же OCI image, migration Job, Secrets integration и metrics.

Сборка для Linux выполняется в CI в целевом окружении, а не копированием бинарника macOS. При CGO или native dependencies нужен воспроизводимый build target с соответствующей libc и arch.

<a name="compose-example"></a>

### Минимальный пример Compose для Go API

```yaml
# deploy/compose.yaml — иллюстрация минимального ядра для VM-профиля
services:
  api:
    image: registry.example.com/product/go-api@sha256:REPLACE_WITH_REAL_DIGEST
    restart: unless-stopped
    environment:
      PGHOST: postgres
      PGDATABASE: product
      PGUSER: product
      PGPASSWORD_FILE: /run/secrets/pg_password
    secrets: [pg_password]
    depends_on:
      postgres: { condition: service_healthy }
    expose: ["8080"]
  postgres:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: product
      POSTGRES_USER: product
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
    secrets: [pg_password]
    volumes: ["pgdata:/var/lib/postgresql"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U product -d product"]
      interval: 10s
      timeout: 5s
      retries: 10
secrets:
  pg_password: { file: ./secrets/pg_password }
volumes:
  pgdata:
```

Это **иллюстративный основной фрагмент**: заменить digest и добавить identity/networking, Caddy, observability, backup, OpenBao Agent, конфигурацию Rauthy и RustFS. Манифест Compose под конкретный продукт заводится при подготовке к развёртыванию; в репозитории платформы на старте готового файла нет. Для PostgreSQL обновление основной версии меняется layout; реальный путь тома сверять с используемым image/tag. `POSTGRES_PASSWORD_FILE` относится к образ postgres; для собственного API чтение `PGPASSWORD_FILE` следует реализовать отдельно (или передавать DSN через конфигурацию, подключённую как секрет).

<a name="compose-v11"></a>

## Развёртывание без смены архитектуры: VM Compose первая

**Минимальный профиль VM:** Caddy/TLS → `go-api` (собранные ресурсы React встроен через `go:embed` либо отдается proxy) + PostgreSQL; локальные директории для файлов и secrets. Встроенные River, flags, audit, analytics, notifications, FSM и websocket живут в `go-api`. **Не запускать Rauthy/RustFS/OpenBao/Electric/Umami/Kafka просто потому, что они есть в старом compose**; подключать только по выбранному профиль возможностей — см. [матрицу возможностей](02-architecture.md#capability-matrix).

| Развёртывание profile | Контейнеры/внешние зависимости | Кому подходит |
|---|---|---|
| `minimal` | Go API + PG + обратный прокси; файлы на диске с backup; SOPS secrets | Малые standalone продукты |
| `enterprise` | Go API + PG + существующие shared IdP/S3/OpenBao/monitoring | Корпоративные внутренние продукты |
| `offline` | `enterprise` + выбранный sync gateway (Electric/PowerSync) | Доказанная необходимость offline sync |
| `agent` | `minimal`/`enterprise` + отдельный TS Vercel AI SDK Agent Runtime | AI-функции по запросу |
| `scaled` | реплики Go API / обработчиков задач + broker/HA DB по результатам нагрузки | Реальные требования HA и независимого ресурса |

Один Docker Compose на одной VM — **не HA**, независимо от количества контейнеров. Резервные копии PostgreSQL, файлов, ключей и проверенный restore остаются обязательными. OpenBao в рабочая среда требуется полноценный bootstrap/unseal и recovery, а не только контейнер.

Избранные возможности не должны влиять на локальный workflow: интерфейсы OIDC, S3, SMTP и ML заменяются детерминированными тестовыми адаптерами. Kubernetes остается вторым профилем и не определяет структуру доменных пакетов.

<a name="operations"></a>

## Готовность к эксплуатации: пока не автоматизировали — не готово

| Риск | Обязательное решение |
|---|---|
| Потеря VM | Backups off-VM + restore drill + RPO/RTO |
| Непримененная миграция | Задача миграции перед развёртыванием, проверка версии схемы |
| OpenBao запечатан / недоступен | Инструкция начальной настройки, правила поведения сервиса |
| Необрабатываемые сообщения / шквал повторов | Ограниченные повторы + идемпотентность + очередь необработанных сообщений |
| Неполная загрузка файлов | Состояние загрузки в SQLite, контрольная сумма, правила возобновления |
| Пропущенные realtime события | Replay/snapshot + revision checkpoint |
| Старые мобильные клиенты | Сервер поддерживает диапазон версий, тесты совместимости |
| Неконтролируемый рост памяти / нагрузки GC в Go | Бюджеты памяти, pprof, профилирование кучи и выделений памяти |
| Утечка привилегий | Тесты прав арендаторов и ресурсов, RLS при необходимости |
| Ошибка агента | Audit, evals, sandbox, staged rollout |

Общие метрики/logs/traces: OpenTelemetry Collector → Prometheus/Grafana и Loki/Tempo либо другой существующий стек; не разворачивать большой monitoring stack в каждом приложении. Заранее определить SLO на business RPC и приемлемое время восстановления.

<a name="embedded-observability"></a>

## Техническая наблюдаемость и бизнес-аудит

Сразу разделять: **технический лог**, **операционная метрика**, **бизнес-аудит**, **аналитическое событие**. Они имеют разные гарантии, хранение и цели, даже если записываются одним процессом.

| Поток | Где создаётся | Хранение | Инвариант |
|---|---|---|---|
| Logs | `log/slog` с request/trace ID | stdout → ротация / общий лог-контур | Не содержит секретов; запись не меняет результат операции |
| Metrics | `prometheus/client_golang` | `/metrics` → общий Prometheus при необходимости | API latency, error ratio, queue depth, RAM |
| Traces | OpenTelemetry Go, выборочно | OTel Collector/shared серверная часть по необходимости | Сводит Go handler, SQL и jobs в единую трассу |
| Business audit | Собственный `audit` модуль | PostgreSQL `audit_events` | Сохраняется в транзакции бизнес-изменения |
| Product analytics | `analytics` | `usage_events`, агрегаты и retention | Не блокирует бизнес-транзакцию без бизнес-требования |

Вместо Loki, Prometheus или отдельного сервиса логов **на каждый продукт** приложение отдает совместимый формат существующему общему эксплуатационному контуру. Отдельный мониторинг процесса всё равно необходим для обнаружения полной остановки: умерший серверная часть не сможет сообщить об этом собственным логом.

**Аудит**: `actor_id`, `action`, `resource_type`, `resource_id`, `organization_id`, `correlation_id`, `occurred_at`, `result`, `before/after` только где это безопасно и необходимо. Обычная таблица не является неизменяемым WORM-хранилищем. При требованиях противодействия администратору — отдельный защищённое хранилище аудита / криптографический журнал.

---

Навигация: [← 12. Vercel AI SDK](12-ai-sdk.md) · [Оглавление](README.md) · [14. Навыки ИИ →](14-skills-catalog.md)

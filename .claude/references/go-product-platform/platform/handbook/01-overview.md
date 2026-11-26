---
title: "Решение и целевая модель"
description: "Основная модель работы v14: локальные агенты и маленький бинарник. Решение за одну минуту, почему Go-first, карта целевой архитектуры, итоговая спецификация и сравнение Go против Rust."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 1
source: "handbook.md §0, §1, §22, §24"
tags: [go-first, architecture, decision, wails, modular-monolith, rust, specification]
up: README.md
prev: README.md
next: 02-architecture.md
---

# Решение и целевая модель

**В этом документе:** [Основная модель работы v14](#v11-start) · [Решение за одну минуту](#decision) · [Почему Go-first](#why-go) · [Карта целевой архитектуры](#architecture-map) · [Итоговая спецификация](#final) · [Go против Rust](#go-rust-performance)

<a name="v11-start"></a>

## Основная модель работы v14: локальные агенты и маленький бинарник

**Главный критерий качества архитектуры:** после изменения модульного Go-кода агент должен получить достоверный результат проверки за секунды, не собирая desktop/mobile пакет, образ Docker и не поднимая инфраструктурные сервисы. Полный gate запускается **один раз на готовом кандидате**, а release — отдельно.

<div class="diagram"><div class="diagram-title">Рисунок 0. Целевой цикл агентной разработки</div><div class="flowboxes"><div class="node">ИИ-агент<small>собственный Git worktree</small></div><div class="node accent">Нативные Go + Vite<small>HMR · PG per worktree</small></div><div class="node">Тесты затронутых компонентов<small>go test · Vitest · Buf</small></div></div><div class="flowboxes stack"><div style="font-size:19px;color:#64748b">↓ фоновый низкоприоритетный прогон</div><div class="node">Фоновое наблюдение за E2E Playwright<small>скриншоты · трассировки · статус / stale</small></div><div style="font-size:19px;color:#64748b">↓ готовый зафиксированный кандидат</div><div class="node accent">Одна обязательная интеграционная проверка<small>точный commit → проверенная main</small></div><div style="font-size:19px;color:#64748b">↓ отдельный релиз</div><div class="node">Linux OCI + VM Docker Compose<small>Подписание настольных и мобильных приложений — по необходимости</small></div></div></div>

| По умолчанию | Только когда действительно требуется |
|---|---|
| **Модульный монолит на Go**, PostgreSQL, Vite/React, Connect | Отдельный IdP, S3/RustFS, OpenBao, Electric/PowerSync |
| Библиотеки для users/access/audit/jobs/analytics/flags/FSM | Redis, NATS/Kafka, OpenFGA, Umami, внешние workflow engines |
| Worktree, отдельная БД, нативные процессы, прогретые кэши | Docker на локальном Mac; несколько реальных сред |
| Тесты затронутых компонентов + фоновые E2E | Все платформенные E2E и подписание на каждом сохранении |

**Начать с разделов:** [Модульный монолит](02-architecture.md#modular-plugins) · [Local Native 2.0](10-local-native-dev.md#native-iteration) · [Фоновые E2E](10-local-native-dev.md#background-e2e) · [Соло/команда: merge](11-agents-workflow.md#agent-integration-v11) · [Каталог библиотек](06-go-stack.md#library-catalog) · [FSM](08-builtin-capabilities.md#fsm-engine) · [Продуктовая аналитика](08-builtin-capabilities.md#product-analytics).

<a name="decision"></a>

## Решение за одну минуту

| Область | Приоритетный выбор | Альтернативы и условия |
|---|---|---|
| Бизнес-логика | **Общие доменные и прикладные пакеты на чистом Go** | Rust только при подтвержденном техническом преимуществе |
| HTTP серверная часть | **Go `net/http` + Connect-Go** | chi для HTTP-маршрутов; gRPC при интеграции сервисов |
| Контракты | **Protocol Buffers + Buf** | OpenAPI для внешнего REST и интеграций |
| Основной RPC | **Connect + бинарный Protobuf** | Нативный gRPC для отдельных клиентов и сервисов |
| Обмен в реальном времени | **WebSocket + бинарный Protobuf**, если нужен bidirectional | Потоковая передача от сервера Connect для событий только сервер → клиент |
| Web | **React + TypeScript + Vite** | Единая дизайн-система shadcn/ui + Base UI |
| Desktop | **Wails 3 + Go + React** | Native AppKit/SwiftUI для специальных Mac-продуктов |
| iOS/Android | **Wails 3 mobile — после PoC** | SwiftUI + UIKit / Kotlin + Compose — полноценный резервный вариант |
| Серверная БД | **PostgreSQL 18.7**, проверенный базовый вариант | PostgreSQL 19.0 (релиз 19.11.2026) после проверка концепции совместимости |
| Локальные данные | **SQLite** | SQLite на мобильных и desktop-устройствах |
| Offline sync | Собственные очереди записи + Electric / PowerSync по PoC | Не считать read-sync двусторонним sync |
| IAM / S3 / Secrets | **Встроенные адаптеры + shared IdP/S3 при наличии** | OpenBao — по требованиям; SOPS+age для малых VM |
| Локальная разработка | **Нативные Go + Vite + PostgreSQL + worktrees** | Background E2E, Анализ влияния изменений на тесты, прогретые кэши |
| Production | **Linux VM + Docker Compose** | Kubernetes — второй профиль |
| ИИ-агенты | **Vercel AI SDK — опциональный TS Agent Service** | Go выполняет бизнес-команды и контролирует права |
| Контрольные проверки качества | **Local тесты затронутых компонентов + фоновый Playwright** | Один финальную проверку кандидата + отдельный проверка перед выпуском |

<a name="why-go"></a>

### Почему Go-first

Для корпоративных приложений, каталогов, документооборота, редакторов, административных систем и офлайн-клиентов наиболее важны проверяемая логика, низкая сложность и быстрый цикл изменений. Go обычно обеспечивает достаточную серверную производительность при компактной модели конкурентности и понятном коде. Общая реализация правил между Go Server и Wails существенно сокращает дублирование. Rust не исключается, но перестает быть обязательным компонентом каждого продукта.

**Приоритеты:** корректность → простота → проверяемость → производительность по бенчмаркам → минимизация новых зависимостей. Проект не получает микросервисы, CQRS, Kafka или GPU только потому, что их можно добавить.

<a name="architecture-map"></a>

### Карта целевой архитектуры

<div class="diagram">
<div class="diagram-title">Рисунок 1. Go-first platform — компоненты и транспорт</div>
<div class="flowboxes"><div class="node">React Web<small>Connect client · TanStack</small></div><div class="node">Настольное приложение Wails<small>React · Ядро Go · SQLite</small></div><div class="node">Mobile<small>Wails PoC / Native Swift+Kotlin</small></div></div>
<div class="flowboxes stack"><div style="font-size:22px;color:#64748b">↕ Connect RPC · бинарный Protobuf / WebSocket</div><div class="node accent" style="min-width:65%">Go HTTP Server + Connect-Go<small>Authentication · Use Cases · Validation · Transactions</small></div><div style="font-size:20px;color:#64748b">↓ Ports / Adapters</div></div>
<div class="flowboxes"><div class="node">PostgreSQL 18<small>Business data · outbox</small></div><div class="node">RustFS<small>S3 · objects</small></div><div class="node">Rauthy<small>OIDC · MFA</small></div><div class="node">OpenBao<small>Secrets · credentials</small></div></div>
<div class="diagram-note">Ядро Go не зависит от Wails, SQL-драйвера или конкретного способа развертывания. Electric/PowerSync, GPU и Agent Service подключаются по требованию.</div>
</div>

<a name="final"></a>

## Итоговая спецификация

**Рекомендуемый базовый вариант v11:** Серверная часть на Go (`net/http` + Connect-Go), Доменное ядро на чистом Go, PostgreSQL 18.7 (19.0 проверка концепции совместимости), React+TypeScript web, Wails 3 desktop, Protobuf+Buf, native macOS dev без Docker с Git worktrees, фоновые E2E, одна финальная проверка перед слиянием, VM Docker Compose minimal. Rauthy/RustFS/OpenBao опциональны или общие инфраструктурные сервисы, не обязательные контейнеры каждого продукта.

**Mobile:** Wails 3 только после готового end-to-end устройства; при недостигнутом SLA — SwiftUI/UIKit и Kotlin/Compose с теми же Connect/Protobuf контрактами. **Обмен в реальном времени:** WebSocket бинарный Protobuf только для двусторонних сценариев. **Sync:** Electric/PowerSync по PoC, а не как обещание автоматической двусторонней синхронизации. **AI SDK/GPU:** opt-in.

Надежный результат — не только успешная компиляция: платформа должна на чистой VM развернуться, пройти security+smoke, восстановить данные из backup, не потерять offline mutations и выпускать подписанные клиенты, совместимые с API.

**Состояние решения:** Go-first принят как приоритет. Нативные мобильные приложения — полноценная допустимая ветка, а не крайняя мера. Производительность, синхронизация и зрелость Wails Mobile валидируются на реальном продукте с заранее определенными приемочными тестами.

<a name="go-rust-performance"></a>

## Go против Rust: ожидаемая производительность

Это **архитектурный прогноз, а не benchmark**. Сравнивать нужно на одинаковом продукте, данных, UI, версии ОС и профиле сборки. В типичных бизнес-приложениях основная задержка находится в SQL, сетевых вызовах, графическом рендеринге и количестве обновлений UI, а не в нескольких миллисекундах выполнения доменной функции.

| Критерий | Ядро Go + Wails 3 | Rust Core + Tauri 2 | Практическое решение |
|---|---|---|---|
| SQL/CRUD latency | Высокая | Высокая | Сначала SQL план и пул |
| Concurrent I/O | Goroutines, зрелый runtime | Tokio, async | Оба подходят |
| Плотные циклы с нагрузкой на CPU | Обычно несколько больше накладные расходы | Часто ниже накладные расходы | Измерить на реальной геометрии |
| RAM/GC | Go heap + GC | Нет GC у Rust Core | Go memory budgets и pprof |
| Dev build | Обычно быстрый цикл | Часто более тяжелая компиляция | Предпочесть Go при одинаковом SLA |
| Desktop клиентская часть FPS | Зависит от WebView/React | Зависит от WebView/React | Не ожидать ускорения UI от языка |
| Жизненный цикл нативных мобильных приложений | Wails экспериментальный | Tauri mobile поддерживается | В Go-first — native Swift/Kotlin резервный вариант |
| GPU/ML | WebGL/WebGPU, native обработчик задач | wgpu/Metal integration | Отдельный opt-in engine |
| AI development | Один Ядро Go на backend/desktop | Один Rust Core на backend/desktop/mobile | Выбор зависит от mobile-shell стратегии |

**Для Go обязателен memory/performance базовый вариант:** idle RSS, peak memory, GC pause distribution, allocations/op, startup, p95 user action, battery на mobile и производительность 2D/3D сцены. При реальной деградации критичного compute-path можно вынести ровно этот алгоритм в отдельный Rust/native модуль, не меняя все приложение.

---

Навигация: [← Оглавление](README.md) · [02. Архитектура →](02-architecture.md)

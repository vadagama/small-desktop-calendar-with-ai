---
title: "Платформы: веб, настольные и мобильные приложения"
description: "Web (React + TypeScript + Vite), Desktop (Wails 3 + Go + React), Mobile-стратегия с двумя путями и decision gate, UI engineering и дизайн-система, GPU/ML и производительность."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 3
source: "handbook.md §3, §9, §10"
tags: [web, react, vite, desktop, wails, mobile, swiftui, jetpack-compose, ui, design-system, gpu, ml]
up: README.md
prev: 02-architecture.md
next: 04-api-realtime.md
---

# Платформы: веб, настольные и мобильные приложения

**В этом документе:** [Веб: React + TypeScript](#web) · [Настольные приложения: Wails 3](#desktop) · [Мобильные приложения: два пути](#mobile) · [Проверка готовности мобильной платформы](#mobile-gate) · [Разработка интерфейсов и дизайн-система](#ui) · [Процесс проверки качества интерфейса](#ui-pipeline) · [GPU, ML и производительность](#gpu)

<a name="web"></a>

## Веб: React + TypeScript

UI собирается через Vite. Основные компоненты — shadcn/ui + Base UI, Tailwind CSS v4, CSS-переменные и собственные дизайн-токены. `@connectrpc/connect-web` / соответствующий актуальный Connect-transport получает типизированные клиентские методы из Buf. TanStack Query управляет серверное состояние; локальное состояние интерфейса не смешивается с кешем API. React Hook Form + Zod — формы; TanStack Table/Virtual — большие таблицы; Storybook — каталог состояний.

При сложном визуальном редакторе использовать PixiJS для 2D и Three.js для 3D, не создавать десятки тысяч DOM-узлов. Для интерактивных экранов приоритет имеют latency ввода, FPS, объем памяти и понятные UX-состояния.

<a name="desktop"></a>

## Настольные приложения: Wails 3 + Go + React

Wails 3 — основной desktop-shell (macOS, Windows, Linux). JS/TS вызывает Go через генерируемые Wails bindings, а приложение хранит автономные данные в SQLite. Взаимодействие с удаленным сервером — через Connect RPC; локальные вычисления не отправляются через сетевой API без причины.

**Контракт:** UI вызывает `ClientPort`; адаптер выбирает Wails binding для локальной операции и Connect для удаленной. Go domain не импортирует Wails. Это упрощает unit tests без запуска нативного окна.

Desktop продукт проверяется на cold start, idle RAM, input latency, подписывание и notarization macOS, updater/release channels, права к файлам и accessibility. В графических сценариях WebGL/WebGPU обязательно тестировать на реальном GPU и системном WebView.

<a name="mobile"></a>

## Мобильные приложения: стратегия с двумя реальными путями

**Путь A — Wails 3 Mobile:** одно ядро Go и React UI. Это перспективный вариант, но iOS/Android **экспериментальные** на 20 ноября 2026 года; решение об эксплуатации принимается после device PoC. Подтвержденные базовые возможности: bridge JS↔Go, камера, secure storage, геолокация, локальные уведомления и сборка mobile-пакетов. Не переносить автоматически на него гарантии фонового исполнения, APNs/FCM или специализированных SDK.

**Путь B — полностью нативные клиенты:** iOS = SwiftUI/UIKit + Swift Concurrency + SQLite/GRDB; Android = Kotlin + Jetpack Compose + Coroutines + Room. Оба вызывают ту же серверную часть Go Connect и используют общие `.proto` контракты. **Это не компромиссная архитектура**, а самостоятельный production-профиль с лучшей интеграцией в жизненный цикл ОС и нативной навигацией.

Ядро Go при таком резервный вариант остается единым на **сервере и desktop**. На мобильных устройствах общими являются Protobuf-контракты, сценарии, спецификации правил и тестовые тестовые данные, но не обязательно бинарный код Go. `gomobile bind` можно исследовать отдельно, если реальное дублирование критичных offline-правил окажется существенным; не считать безопасную и беспроблемную генерацию Swift/Kotlin binding гарантированной.

| Критерий | Wails 3 Mobile | Native SwiftUI / Kotlin Compose |
|---|---|---|
| Один React UI | Да | Нет |
| Общий Ядро Go | Да | Через binding не требуется |
| Камера, local SQLite | Возможно с Go/adapters | Зрелые native API |
| APNs/FCM, фоновые transfer jobs | Отдельный PoC и native bridge | Стандартные SDK ОС |
| UI и системные жесты | WebView + адаптация | Нативно |
| Статус стабильности | Экспериментальный | Production стандарт |
| Основное решение | После проверки | Допустимый прямой выбор |

<a name="mobile-gate"></a>

### Проверка готовности мобильной платформы

Проверить реальные Android/iOS устройства: установка через TestFlight/Play, съемка фото, 30+ offline-файлов, SQLite outbox, переключение app в background, killed process, восстановление сети, deep link/push, barcode, 1000+ SKU, отзывчивость сцены, память и безопасность WebView. Fail хотя бы по одному обязательному сценарию — переключиться на нативный профиль, не переписывая серверную часть и API.

**Обязательный security test:** недоверенный iframe не должен получать привилегированный JS→Go bridge; проверить конкретную версию Wails, поскольку в официальном changelog документировались риски доступности bound Go методов из фреймов.

<a name="ui"></a>

## Разработка интерфейсов и дизайн-система

**Стандарт:** shadcn/ui + Base UI, Tailwind CSS v4 + tokens, React Hook Form + Zod, TanStack Query, TanStack Table/Virtual, Lucide, Storybook, Vitest, Playwright, axe-core. Визуальные ориентиры — Linear (плотность и клавиатура), Attio (объекты и списки), Apple HIG и Material 3 (платформенные паттерны), Stripe (финансовые операции).

Web и Desktop разделяют большинство компонентов; мобильный Wails — responsive, нативные мобильные приложения — отдельная реализация на SwiftUI/Compose. **Общими являются семантика UI, дизайн-токены и сценарии, но не обязательно один компонент для четырех экранов.** Для мобильных больших таблиц заменить таблицу мобильным списком/карточками; touch targets, back navigation и accessibility тестировать отдельно.

В сложных редакторах React отвечает за панели, формы, инструменты; PixiJS/Three.js — за графическое поле. Нельзя пытаться ускорить сцену добавлением GPU для обычных полей формы.

<a name="ui-pipeline"></a>

### Процесс проверки качества интерфейса

1. `screen-spec.md`: сценарий, состояния (empty/loading/error/success), keyboard/touch flow, desktop/mobile layout.
2. Генерация UI из собственного компонента registry и дизайн-токенов.
3. Проверка компонентов через Storybook и Vitest Browser Mode.
4. Визуальные снимки Playwright + axe-core + реальные платформенные E2E.
5. Независимый critique/polish навык и исправление несоответствий.
6. Проверка производительности на больших fixture-наборах, в том числе real GPU для 2D/3D.

<a name="gpu"></a>

## GPU, ML и производительность

GPU **опционален**. Бизнес CRUD, транзакции, SQL, большинство таблиц и простой UI работают на CPU. Для графических приложений GPU обычно полезен для PixiJS/Three.js рендеринга; для распознавания фото — Core ML / ONNX / ML серверная часть; для массовой независимой численной оценки кандидатов — выделенный compute engine при наличии измеренного выигрыша.

Go не обязан реализовывать GPU-ядро. Возможны: WebGL/WebGPU в клиентской части, отдельный Rust/Metal/CUDA/ONNX обработчик задач по API или платформенный native модуль. CPU резервный вариант, ограничение конкуренции с UI и замеры на реальных устройствах обязательны.

| Метрика | Что измерять |
|---|---|
| UI | p95 input latency, FPS, long tasks, dropped frames |
| Backend | p50/p95/p99 RPC, RPS, CPU, allocations, GC pauses |
| DB | query plans, pool saturation, WAL, replication lag |
| Mobile | startup, пиковое потребление памяти / память в простое, battery, восстановление после фоновой работы |
| ИИ-агенты | time-to-green, tool errors, стоимость, повторные попытки |
| GPU | frame time, memory, throughput, резервный вариант correctness |

<a name="ui-canvas"></a>

## Canvas при настройке UI-проекта

[app-canvas](https://gitlab16.skiftrade.kz/design/app-canvas) — опциональная среда
разработки и просмотра UI. Предлагать её при настройке проекта с фронтэндом.
Агент клонирует источник во временную папку, проверяет установщик и по согласованному
плану запускает официальный `canvas_setup.py` из проверенного клона (порядок —
[canvas-installation.md](../references/canvas-installation.md)). Установщик создаёт
локальный `.canvas/` и отслеживаемый `design/`; для существующего приложения он
подключает его без генерации нового, для нового позволяет выбрать кит.
Дизайн-спецификации связываются с `docs/specs/`, инженерный workflow продукта
остаётся обязательным. После установки выполнить `python3 .canvas/board.py doctor`.

## Общий процесс UI и эксперименты

[UI-набор](../references/prototyping-installation.md) применяется к целевому приложению
и прототипам. Impeccable ведёт дизайн и итерации; kit и инженерные проверки
выбираются по платформе. Целевая дизайн-система и пакеты фич — `docs/ui/`.
Эксперименты размещаются в `prototypes/PROTOTYPE-NNNN-slug` на едином согласованном стеке;
переносятся проверенные идеи, а пригодность кода оценивается отдельно.

---

Навигация: [← 02. Архитектура](02-architecture.md) · [Оглавление](README.md) · [04. API и realtime →](04-api-realtime.md)

---
title: "Совместимость, ADR и история версий"
description: "Правила совместимости и миграций для API, БД, sync, клиентов и UI; реестр ADR с принятыми решениями; переход с руководства v9 на Go-first стандарт."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 16
source: "handbook.md §19, §20, §25"
tags: [compatibility, migrations, adr, decisions, history, v9, go-first]
up: README.md
prev: 15-ade-platform.md
next: 17-roadmap.md
---

# Совместимость, ADR и история версий

**В этом документе:** [Правила совместимости и миграций](#compatibility) · [ADR и принятые решения](#adr) · [Миграция с руководства v9](#migration-v9)

<a name="compatibility"></a>

## Правила совместимости и миграций

- **API:** `.proto` versioned packages (`v1`, `v2`), Buf breaking, период поддержки выпуска; совместимость клиентов без прямого изменения типы данных в протоколе.
- **DB:** расширение и последующее сужение схемы, план отката, отдельно PostgreSQL/SQLite, миграции без потери данных.
- **Sync:** `revision`/`cursor`, повторные команды без дублей, snapshot после истечения период повторного воспроизведения.
- **Desktop/mobile:** подписанные релизы; старый клиент не должен ломаться от серверного deploy; приложение может работать с устаревшим token/session.
- **UI:** versions собственных дизайн-токенов и компонент registry; обновления без лавины визуальных регрессий.
- **AI tools:** версия схемы, область разрешений, тесты инвариантов, одобренные побочные эффекты.

См. также: [правила эволюции схем](04-api-realtime.md#proto-compatibility), [deployment policies](13-deployment-operations.md#deployment-policies).

<a name="adr"></a>

## ADR и принятые решения

| ADR | Решение | Статус |
|---|---|---|
| ADR-021 | Доменное ядро Go + Connect-Go как основной серверная часть | Принято |
| ADR-022 | Wails 3 desktop по умолчанию, mobile через проверяемый PoC | Принято |
| ADR-023 | Полностью native SwiftUI/Compose — нормальный резервный вариант mobile | Принято |
| ADR-024 | Protobuf + Buf, бинарный Connect, WebSocket только при необходимости | Принято |
| ADR-025 | LOCAL-NATIVE macOS dev, PostgreSQL 18, Git worktrees | Принято |
| ADR-026 | Linux VM + Docker Compose в первую очередь, K8s — во вторую | Принято |
| ADR-027 | Rauthy/RustFS/OpenBao — opt-in/shared; Electric/PowerSync опционально | Пересмотрено в v11 |
| ADR-028 | Vercel AI SDK опционально, Go сохраняет полномочия на выполнение | Принято |

`Accepted` здесь означает **выбранный целевой стандарт документа**, а не завершение проверки всех интеграций. Wails Mobile и sync provider имеют явный экспериментальный gate.

<a name="migration-v9"></a>

## Миграция с руководства v9 и контроль изменений

Версия v9 закрепляла Rust + Axum + Tauri как primary и Go/Wails как опционально. Версия v10 **переворачивает приоритеты**, но сохраняет инфраструктурный фундамент и UI-подход.

| Было (v9) | Стало (v10) | Что не меняется |
|---|---|---|
| Rust Axum / SeaORM | Go Connect-Go / pgx / sqlc | PostgreSQL, auth, S3, migration discipline |
| Rust shared crates | Доменное ядро на чистом Go | Доменные инварианты / модульный монолит |
| Tauri 2 desktop | Wails 3 desktop | React shadcn UI, SQLite offline |
| Tauri mobile | Wails Mobile PoC или SwiftUI / Compose | Контракты Connect / проверки безопасности |
| OpenAPI-first | Protobuf+Buf-first | Типизированные generated clients |
| REST primary | Connect с бинарным Protobuf primary | HTTPS + identity + audit |
| Локальные сборки, зависящие от облака/CI | LOCAL-NATIVE + Git worktrees | Контрольные проверки CI перед выпуском |
| Приоритетное развёртывание через Docker Compose | Приоритетное развёртывание через Docker Compose | Приоритет VM / K8s second |
| GPU опционально | GPU опционально | Резервное выполнение на CPU, оптимизация по результатам измерений |
| Vercel AI SDK опционально | Vercel AI SDK опционально | Go владеет доменной логикой и полномочиями на выполнение |

Исторический v9 Markdown лежит в ZIP как `archive/rust-product-platform-v9.md`, чтобы сохранить детали прежнего технического обоснования. Он **не является нормативным источником** для новых Go-first продуктов; при конфликте применять текущий стандарт.

**Совместимость с прошлой редакцией:** предыдущие главы 1–25 сохранены как история и базовые архитектурные решения (протоколы, Go-first, Wails/Native Mobile, UI, GPU, Electric/PowerSync, VM Compose, AI SDK). При различии приоритетов нормативным уточнением v11 являются разделы «Решение и целевая модель», «Архитектура: границы и модульный монолит», «Встроенные возможности», «LOCAL-NATIVE разработка» и «Работа агентов и интеграция»; оригинальный v10 включен в ZIP архивом.

---

Навигация: [← 15. ADE](15-ade-platform.md) · [Оглавление](README.md) · [17. Эталонный путь →](17-roadmap.md)

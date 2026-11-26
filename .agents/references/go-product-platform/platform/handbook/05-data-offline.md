---
title: "Данные и приоритет офлайн-работы"
description: "Разные роли баз данных (PostgreSQL, SQLite), версии PostgreSQL 18.7 и 19.0, драйверы и миграции, offline-first путь чтения и путь записи, Electric и PowerSync."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 5
source: "handbook.md §6, §7"
tags: [postgresql, sqlite, databases, offline-first, sync, electric, powersync, migrations]
up: README.md
prev: 04-api-realtime.md
next: 06-go-stack.md
---

# Данные и приоритет офлайн-работы

**В этом документе:** [Базы данных: разные роли — разные решения](#databases) · [Приоритет офлайн-работы: чтение и запись](#offline)

<a name="databases"></a>

## Базы данных: разные роли — разные решения

| Контекст | Основное решение | Почему |
|---|---|---|
| Локальная разработка серверной части | **PostgreSQL 18.7 нативно на macOS** | Совпадает с СУБД рабочей среды |
| Серверная часть рабочей среды | **PostgreSQL 18.7 на VM** | Транзакции, backup, индексы, операционная зрелость |
| Desktop + Wails | SQLite | Локальные операции и offline |
| iOS / Android native | SQLite через GRDB / Room | Native tooling и жизненный цикл |
| Быстрые JS-тесты | PGlite, выборочно | Не подмена всех PG интеграционные тесты |
| Offline sync | Electric или PowerSync после PoC | Зависит от клиента, конфликтов и лицензии |
| Новая Turso Database | Только исследовательский профиль | Не использовать по умолчанию в рабочей среде без подтверждения зрелости и испытаний |

**Решение по версии на 20.11.2026:** PostgreSQL **19.0 выпущен 19 ноября**. Для новой рабочей среды я оставляю проверенный **18.7 базовый вариант** до проверки совместимости расширений, драйверов, миграций и backup/restore; 19.0 — отдельный compatibility profile и возможный следующий базовый вариант. 17.12 допустима для существующих систем. Локальная PostgreSQL и рабочая среда должны совпадать по major в основном интеграционном контуре; minor держать актуальным.

Для Go API предпочесть `pgx`/`pgxpool` с `sqlc` для сложного SQL; `database/sql` и `goose`/`atlas` подходят как альтернативы. Не обязательно вводить ORM. Для SQLite — подобрать CGO или pure-Go драйвер на основании сборки каждой целевой платформы, скорости и размера пакета. PostgreSQL и SQLite **имеют отдельные миграции** и тесты совместимости. Полный каталог библиотек — в [стеке Go-бэкенда](06-go-stack.md#library-catalog).

<a name="offline"></a>

## Приоритет офлайн-работы: чтение и запись

Offline-first нужен не всем приложениям. Когда он включен, клиент хранит данные, pending mutations и файлы локально; пользователь видит результат быстро, а сервер остается источником истины для опубликованного состояния. Все pending commands идемпотентны и имеют replay policy.

<div class="diagram"><div class="diagram-title">Рисунок 2. Двунаправленная офлайн-синхронизация: два независимых направления</div><div class="flowboxes stack"><div class="node">Клиентская SQLite<small>снимок · очередь исходящих событий · ожидающие файлы</small></div><div style="font-size:20px;color:#64748b">↑ Синхронизация чтения / поток Shape &nbsp;&nbsp;&nbsp; ↓ API изменения данных Connect</div><div class="node accent">Прикладной API Go<small>авторизация · валидация · правила разрешения конфликтов</small></div><div style="font-size:20px;color:#64748b">↓ атомарные транзакции · очередь исходящих событий</div><div class="node">PostgreSQL<small>источник истины · revision</small></div></div><div class="diagram-note">Electric синхронизирует путь чтения и не выполняет автоматические запись в офлайн-режиме. PowerSync поддерживает клиентскую очередь, но серверная часть обязана реализовать применение mutations и права.</div></div>

**Electric:** хорош для reactive browser data и Shapes; требует auth proxy для каждого запроса. Для Go SQLite и нативные мобильные приложения понадобится дополнительная интеграция. **PowerSync:** интересен для SQLite client sync; проверить SDK, схему аутентификации, возможности self-hosted Open Edition и сценарии Wails/native в отдельном PoC. Его write queue не является разрешением конфликтов «под ключ».

**Файлы:** локальное сохранение → запись upload-job в SQLite → presigned URL от Go API → S3 upload → подтверждение checksum/server version → committed state. Если приложение убито ОС, данные сохраняются и отправка повторяется при следующем допустимом запуске; гарантированная фоновая выгрузка требует отдельного native API integration.

---

Навигация: [← 04. API и realtime](04-api-realtime.md) · [Оглавление](README.md) · [06. Стек Go-бэкенда →](06-go-stack.md)

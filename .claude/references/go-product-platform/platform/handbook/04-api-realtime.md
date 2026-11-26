---
title: "API, контракты и realtime"
description: "Protobuf + Buf + Connect/gRPC как единый контракт, правила эволюции схем, Buf как quality gate, события и ревизии для collaboration, realtime без отдельного брокера сообщений."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 4
source: "handbook.md §4, §5, §37"
tags: [protobuf, buf, connect, grpc, api, realtime, websocket, collaboration, outbox]
up: README.md
prev: 03-platforms-ui.md
next: 05-data-offline.md
---

# API, контракты и realtime

**В этом документе:** [API: Protobuf + Buf + Connect/gRPC](#protocols) · [Рекомендованный protobuf-контракт](#proto-example) · [Правила эволюции схем](#proto-compatibility) · [Buf как quality gate](#buf-example) · [Collaboration: события и ревизии](#realtime) · [Обмен в реальном времени без брокера](#realtime-v11)

<a name="protocols"></a>

## API: Protobuf + Buf + Connect/gRPC

Единый машинно-проверяемый контракт — `.proto`. Наличие контрактов важнее того, читает ли разработчик JSON вручную. **Binary Protobuf — основной wire format**, но формат не заменяет проверки авторизации, корректности бизнес-команд и наблюдаемость.

| Задача | Транспорт | Почему |
|---|---|---|
| Web → Go | **Connect unary + Protobuf** | Браузер, типизированный RPC, нормальная HTTP-инфраструктура |
| Wails/Desktop → Go | Connect + Protobuf | Общие схемы; Go/native транспорт |
| Нативные Swift/Kotlin → Go | Connect или gRPC по доступным SDK | Выбор драйвера и платформенной поддержки |
| Go ↔ сервисы | Connect/gRPC | При появлении реальных межсервисных границ |
| Односторонние live-обновления | Потоковая передача от сервера Connect / SSE | Может обойтись без WebSocket |
| Обмен в реальном времени collaboration и presence | **WebSocket + Protobuf** | Двусторонний интерактивный канал |
| Фото, CAD, OBJ, большие файлы | HTTPS + S3 presigned URL | Не пересылать большие объекты через RPC |
| Данные для плотной геометрии | Protobuf/typed arrays → benchmark FlatBuffers | Только после измерения latency/memory |
| Внешний API / вебхук | REST/JSON/OpenAPI при необходимости | Совместимость сторонних интеграций |

**Важные уточнения:** Connect-Go может обслуживать Connect, gRPC и gRPC-Web через общий handler. Поддержка бинарного Protobuf не означает, что все клиенты автоматически отправят бинарный формат: настройка транспорт и `Content-Type` проверяются в контрактных тестах. gRPC потоковая передача из браузера имеет транспортные ограничения; browser-bidi не проектировать как замену WebSocket без проверки. Для web учитывать CORS, preflight, TLS, корпоративные прокси и потоковая передача HTTP-ответа.

<a name="proto-example"></a>

### Рекомендованный protobuf-контракт

```proto
syntax = "proto3";
package resource.v1;

option go_package = "example.com/product/gen/resource/v1;resourcev1";

import "google/protobuf/timestamp.proto";

service ResourceService {
  rpc GetResource(GetResourceRequest) returns (GetResourceResponse);
  rpc MoveElement(MoveElementRequest) returns (MoveElementResponse);
}

message GetResourceRequest { string resource_id = 1; }
message GetResourceResponse {
  string resource_id = 1;
  uint64 revision = 2;
  repeated Element elements = 3;
}
message Element { string id = 1; int32 x_mm = 2; int32 y_mm = 3; }
message MoveElementRequest {
  string resource_id = 1;
  string element_id = 2;
  int32 x_mm = 3;
  int32 y_mm = 4;
  uint64 expected_revision = 5;
  string idempotency_key = 6;
}
message MoveElementResponse {
  uint64 revision = 1;
  google.protobuf.Timestamp committed_at = 2;
}
```

Revision сравнивается атомарно внутри PostgreSQL-транзакции; `idempotency_key` предотвращает повторное применение одной команды. Типы идентификаторов на wire могут быть string, а в Go domain — строгие newtypes. **Бизнес-валидация исполняется на сервере**, даже если клиент уже проверил размещение.

<a name="proto-compatibility"></a>

### Правила эволюции схем

Никогда не переиспользовать удаленные номера и имена полей (`reserved`), не изменять wire тип существующего поля без миграции, использовать новые поля с безопасными значениями по умолчанию, определять наличие значения через `optional` или message-wrappers, сохранять совместимость старых клиентов. Для частичных обновлений использовать явно определенный сообщение частичного обновления / FieldMask, а не неявный merge. Старый клиент и новый сервер должны сосуществовать в течение период поддержки выпуска. См. также [правила совместимости](16-evolution-adrs.md#compatibility).

<a name="buf-example"></a>

### Buf как обязательный quality gate

```yaml
# buf.yaml
version: v2
modules:
  - path: proto
lint:
  use:
    - STANDARD
breaking:
  use:
    - FILE
```

```bash
buf format -w
buf lint
buf breaking --against '.git#branch=main'
buf generate
```

В репозитории закрепить версии генераторов Go/TS/Swift/Kotlin. Проверять воспроизводимость сгенерированных SDK и отсутствие diff после повторной генерации. Генерация мобильных SDK зависит от выбранных официальных плагинов и их поддерживаемых платформ; автоматически объявлять любой target поддерживаемым нельзя.

<a name="realtime"></a>

## Collaboration: события, ревизии и восстановление

WebSocket — транспорт, но **не надёжный журнал событий**. Команды записи идут через Connect; подтвержденные изменения публикуются после commit (транзакционная очередь исходящих событий). Сохраняемое событие имеет `event_id`, `resource_id`, `revision`, `committed_at`, `payload`. Клиент при reconnect запрашивает изменения с revision N либо актуальный snapshot; сервер определяет срок хранения replay-лога и поведение за его пределами.

Для курсоров и presence допустимы потери и coalescing; для MoveElement, Rename, Approve необходима надежная запись и подтверждение, обычно не по WebSocket-команде. Для конкурентных редакторов добавить sequencing, optimistic конкурентность, права на ресурс и явную стратегию конфликтов. CRDT/OT использовать лишь при реальной потребности совместного редактирования одного объекта и после отдельного ADR.

```proto
syntax = "proto3";
package resource.v1;
message RealtimeEvent {
  string resource_id = 1;
  uint64 revision = 2;
  string event_id = 3;
  oneof payload {
    ElementMoved element_moved = 4;
    UserCursor user_cursor = 5;
  }
}
message ElementMoved { string element_id = 1; int32 x_mm = 2; int32 y_mm = 3; }
message UserCursor { string user_id = 1; int32 x_mm = 2; int32 y_mm = 3; }
```

**Проверки:** пропуск событий, reconnect на 60 минут, смена разрешений в открытом сокете, ограничение скорости курсора, 100 одновременно подключенных клиентов и утечка между арендаторами. События WebSocket также должны проходить авторизацию канала и валидацию длины кадра.

<a name="realtime-v11"></a>

## Обмен в реальном времени и совместная работа без отдельного сервера сообщений

Для двунаправленных событий использовать [coder/websocket](https://github.com/coder/websocket) + **бинарный Protobuf**; для обычных request/response — Connect RPC. WebSocket доступен из одного HTTP-сервер Go рядом с обработчики Connect. Никаких Redis/NATS/Kafka ради одного экземпляра на VM не требуется.

| Класс события | Требование доставки | Реализация |
|---|---|---|
| Бизнес-событие | Сохраняемое, важен порядок/повтор | PostgreSQL revision / event log, затем fanout |
| Присутствие пользователя / курсор | Может быть потеряно | Непостоянный WebSocket без retry каждого кадра |
| Ход выполнения фоновой задачи | Восстанавливается по job status | WebSocket как сигнал + Connect query для истины |
| Notifications | Должны переживать offline | Inbox PostgreSQL + WebSocket как push |
| Sync для offline-клиента | Нужна сверка версий/конфликтов | Очередь записи + получение снимка/событий; Electric/PowerSync по PoC |

**WebSocket контракт:** проверять authorization при установке соединения **и каждой подписке**, ограничивать максимальный размер сообщения, иметь ограниченную очередь отправки, ограничения частоты запросов, heartbeat/timeout, backpressure и чистое закрытие. Каждое устойчивое изменение содержит `resource_id`, `revision`, `event_id`; после reconnect клиент получает snapshot+delta с `last_revision`. Смена прав должна отзывать подписку. Нельзя хранить состояние совместного редактирования только в памяти сервера.

На нескольких API-репликах широковещательная рассылка в памяти перестаёт быть общим. В этот момент можно добавить Postgres LISTEN/NOTIFY как **сигнал** (не надёжное хранилище), либо независимый pub/sub — но журнал истины остаётся в PG. Если требуется сложная CRDT-совместная работа, её нужно вводить как отдельный стандарт после сравнения Yjs/Automerge, а не симулировать через произвольные WebSocket-сообщения.

---

Навигация: [← 03. Платформы](03-platforms-ui.md) · [Оглавление](README.md) · [05. Данные и offline →](05-data-offline.md)

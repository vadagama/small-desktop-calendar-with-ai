---
id: "SPEC-0004-design"
kind: "design"
status: "verified"
owner: "oleg"
related: ["SPEC-0004"]
---

# Интеграции

Планировщик Go живёт на уровне приложения. Он опрашивает календарь каждые 30 секунд, обновляется после сна и проверяет аккаунт и свежесть данных. Действующие нормализация Small и алиасы повторяющихся встреч переиспользуются через закрытый канал Go–Node. Настройки и журнал сохраняются в `reminders.json` с прежним форматом. Перед передачей ссылки браузеру Go перепроверяет событие.

Wails использует UserNotifications для доставки и системных действий. Диагностика ищет ID в Центре уведомлений. Кнопка закрытия скрывает окно и завершает активную голосовую сессию. Dock и повторный запуск того же профиля возвращают окно. Cmd+Q завершает планировщик и дочерние процессы. [События Wails](https://v3.wails.io/concepts/lifecycle/) · [UserNotifications](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter).

WebKit проверяет кадр, origin и активную голосовую сессию. Камера и вложенные фреймы заблокированы. Запись идёт через существующий AudioWorklet. Модель и движок проверяются действующими модулями Whisper. Движок входит в DMG, модель загружается в профиль. [Разрешения WebKit](https://developer.apple.com/documentation/webkit/wkuidelegate) · [Доступ к микрофону macOS](https://developer.apple.com/documentation/bundleresources/requesting-authorization-for-media-capture-on-macos).

Стабильная подписанная сборка проверяет `latest-wails-mac.json` и принимает отдельный ZIP Wails для arm64. Go проверяет заявленный размер, SHA-256, Ed25519, Apple Team ID, bundle ID, версию и Gatekeeper. Скачивание выполняется автоматически. Только подтверждение запускает помощник Wails, который заменяет приложение и восстанавливает прежнюю версию при обработанном отказе. [Обновления Wails](https://wails.io/guides/updater/) · [Нотарификация Apple](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

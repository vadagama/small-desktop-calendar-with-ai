---
id: "SPEC-0005-plan"
kind: "plan"
status: "verified"
owner: "oleg"
related: ["SPEC-0005"]
---

# Порядок проверки и перехода

1. Проверить исходный Electron на чистом тестовом профиле. Создать данные двумя синтетическими аккаунтами через штатные хранилища.
2. Импортировать в новый каталог и сверить файлы, состояние Small, данные обоих аккаунтов и повторную попытку импорта. Проверить в скрытом WKWebView вход по сохранённой сессии, настройки, память и поведение при недоступности календаря.
3. Подтвердить защиту от повторных записей при наличии старого журнала. После отказа в доступе перезапустить проверку с недоступным API и убедиться, что прежние данные не выдаются.
4. Собрать локальный DMG из той же рабочей копии. Проверить чистый запуск и повторить импорт с бинарником из образа.
5. Перед рабочим переходом закрыть Electron, завершить сверку неопределённых операций и сохранить исходный профиль для возврата. Запустить импорт в новый каталог и проверять состояние до первой записи. Возврат после записей требует сверки профиля и журналов Wails с состоянием Small.

```sh
npm test
npm run typecheck
npm run package:wails:mac -- --out release/wails-profile-stage
SMALL_WAILS_WEBVIEW_TEST=1 MACOSX_DEPLOYMENT_TARGET=15.1 go -C desktop-wails test -race -count=1 -v ./...
SMALL_E2E_BACKGROUND=1 npm run test:desktop -- tests/desktop/calendar-cache-restart.spec.ts tests/desktop/local-storage.spec.ts tests/desktop/layout.spec.ts tests/desktop/profiles.spec.ts
```

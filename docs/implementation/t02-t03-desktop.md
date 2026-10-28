# T02–T03 — desktop-окно и безопасный диалог

Проверено 28 октября 2026 года на macOS 15.1 (24B2083), arm64.
Electron + React + Dockview Community приняты пользователем в ADR-002.

## Что работает

Electron загружает локально собранный React UI по `small-app://workspace/index.html`.
В dev используется только `http://127.0.0.1:5174/`. Renderer без Node.js,
включены sandbox и context isolation. CSP запрещает сторонние скрипты, фреймы,
объекты и сетевые подключения в собранном renderer. Inline-стили нужны сетке
и размерам панелей; inline-скрипты и eval не разрешены. Новые окна, внешние
переходы и webview блокируются, разрешения по умолчанию отклоняются.
Protocol handler отдаёт файлы только внутри renderer-каталога.

UI переиспользует существующий стенд; через параметр `AssistantPanel` в него
подставляется desktop-чат. Браузерный стенд сохраняет прежнего демо-ассистента.
Dockview пока не интегрирован: это T07. Календарь содержит только демо-данные.

Чат использует `@ai-sdk/react` 4.0.159 и собственный `ChatTransport`:
нативные `UIMessageChunk` передаются через ограниченный IPC, без собственного
формата текстовых/tool-состояний. Каждый запрос имеет UUID; старые события
отбрасываются. Подписки снимаются при завершении, ошибке, отмене и unmount.

Main проверяет URL и основной frame отправителя, схему аргументов и длину
prompt (1–2000 символов); на окно допускается один активный запрос.
Bridge предоставляет только `start`, `cancel`, `subscribe`, без raw IPC.
Модель и SDK-loop работают в отдельном Electron utility process. В T03 он
не наследует переменные окружения main, ключи и профили ещё не подключены.
Сбой процесса и таймаут 30 секунд дают ошибку без автоматического повтора.
Отмена отправляет AbortSignal; зависший процесс завершается через 250 мс.
Utility process изолирует сбои, но не является security sandbox для недоверенного кода.

Тестовая модель локальна и детерминирована. «Сложи 2 и 3» вызывает `addNumbers`
и возвращает 5; «Сложи 1.5 и 3» показывает ошибку схемы; «Ошибка модели» —
ошибку ответа; «Помоги» просит уточнить числа. Это проверка механики SDK,
а не календарный интеллект или fallback для реального профиля.
История хранится в памяти UI; модель T03 получает только последний запрос.

## Команды

```sh
npm ci
npm run dev
npm run build:desktop
npm run test:desktop
npm run package:mac
```

`pretest:desktop` устанавливает бинарник Electron до старта тестового таймера:
Electron 45 загружает его лениво, и первичная загрузка может занять минуты.
`npm start` запускает ранее собранное приложение.
`package:mac` создаёт локальную `.app` через официальный `@electron/packager`
с ASAR, без включения исходников проекта, агентских ресурсов или `.env`.
Release-подпись, notarization, обновления и дистрибуция остаются отдельной задачей.

Проверка упаковки:

```sh
SMALL_APP_EXECUTABLE="$PWD/release/Small Calendar-darwin-arm64/Small Calendar.app/Contents/MacOS/Small Calendar" npm run test:desktop
```

Тестовый launcher передаёт приложению `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.
Node тестового runner остаётся снаружи `.app`; приложению он не нужен.

## Результаты проверки

- 18 тестов ядра/transport: `npm test`.
- Два Electron E2E: dev-сервер и упакованная `.app`. Включают успешный tool,
  неверные аргументы, ошибку модели, отмену и новый запрос, уточнение ввода,
  отказ недоверенной странице, UUID/размер запроса, конкуренцию и чужой cancel.
- Проверены фактический sandbox renderer, изолированный preload, отсутствие
  `process`/`require` в UI, CSP, запрет обхода каталога и внешней навигации.
- Статическая проверка main и renderer: `npm run typecheck`.
- Скриншоты просмотрены: `test-results/desktop/window.png`, `assistant.png`.
- Временная инверсия проверки request ID сломала transport-тест; код восстановлен.
- Проверки исходного UI-стенда ведутся его отдельным манифестом.

Chrome DevTools MCP отсутствует; проверка DOM, консоли и снимков выполнена
через Playwright Electron. После отменённой навигации Playwright может оставить
locator navigation wait незавершённым; тест проверяет URL документа, native URL
Electron и сохранность DOM напрямую. В renderer при проверке нет ошибок консоли.
При сборке остаются предупреждения о `use client` в зависимостях React/SWR/lucide;
renderer собирается как клиентское приложение, RSC здесь нет.

## Источники и границы

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
- [Protocol](https://www.electronjs.org/docs/latest/api/protocol) и
  [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process).
- [electron-vite](https://electron-vite.org/guide/dev) и
  [Electron Packager](https://github.com/electron/packager).
- [SDK transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) и
  [streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text).
- [Playwright Electron](https://playwright.dev/docs/api/class-electron).

Версии зафиксированы в корневом манифесте/lockfile: Electron 45.1.0,
electron-vite 6.0.0, Vite 8.3.5, Packager 20.3.0, Playwright 1.64.1.
Keychain, реальный GLM, вход Small, актуальный календарь и уведомления
не входят в выполненные проверки T02–T03.

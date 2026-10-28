# T02 — локальное desktop-окно

Проверено на macOS 15.1 (24B2083), arm64, 28 октября 2026 года.
Electron + React + Dockview Community приняты пользователем в ADR-002.
Окно загружает локальный React-стенд; модель в UI ещё демонстрационная.
Dockview подключается в T07, подключение SDK-чата — в T03.

Включены sandbox, context isolation и web security; Node и raw IPC в UI нет.
CSP запрещает внешние скрипты, фреймы и сетевые подключения renderer.
В dev разрешены только локальный сервер и его WebSocket на 127.0.0.1:5174.
Новые окна и внешняя навигация блокируются. Protocol handler ограничен
renderer-каталогом. Закрытие окна на macOS оставляет main работающим.

Команды: `npm ci`, `npm run dev`, `npm run build:desktop`, `npm run test:desktop`,
`npm run package:mac`. Последняя создаёт локальную arm64 `.app` с ASAR.
Keychain, уведомления, подпись для распространения и notarization не проверены.

Проверка упакованного приложения:

```sh
SMALL_APP_EXECUTABLE="$PWD/release/Small Calendar-darwin-arm64/Small Calendar.app/Contents/MacOS/Small Calendar" npm run test:desktop
```

Тест передаёт приложению PATH без Node, проверяет фактический sandbox,
изолированный preload, CSP, отсутствие process/require в UI, обход каталога,
переключение представления и запрет навигации. Скриншот — test-results/desktop/window.png.
После отменённого перехода URL и DOM проверяются напрямую: Playwright может
сохранить ожидание отменённой навигации у locator API.

Источники: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[protocol](https://www.electronjs.org/docs/latest/api/protocol),
[electron-vite](https://electron-vite.org/guide/dev),
[Packager](https://github.com/electron/packager),
[Playwright](https://playwright.dev/docs/api/class-electron).

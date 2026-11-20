# Бюджет CSS renderer

`npm run check:size` проверяет production-сборку в `out/renderer/assets`:
не более 225 000 байт CSS и 1 200 000 байт JavaScript.

DockWorkspace использует только `themeLight`. В `electron.vite.config.ts`
Lightning CSS исключает через `unusedSymbols` классы остальных тем Dockview.
Общие правила библиотеки, светлая тема и стили приложения сохраняются.
При добавлении переключения тем нужно удалить используемые темы из списка
исключений и проверить размер сборки и desktop layout E2E.

Механизм: [Lightning CSS — Unused symbols](https://lightningcss.dev/minification.html#unused-symbols),
[настройка минификации Vite](https://vite.dev/config/build-options#build-cssminify).

## Измерение 20 ноября 2026

Одинаковая команда `npm run build:desktop` до и после настройки, Dockview 8.7.1:

| Ресурс | До, байт | После, байт |
| --- | ---: | ---: |
| CSS | 226 121 | 138 533 |
| JS | 1 177 495 | 1 177 495 |

Экономия CSS — 87 588 байт (38,7%), лимит не повышен. Проверки размера,
типов, форматирования, 580 unit-тестов и Electron E2E `layout` / `window`
прошли. В скрытом Electron с новым профилем вычисленные стили всех 419
элементов начального экрана совпали при подстановке CSS до и после оптимизации.

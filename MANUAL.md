# Ordo — рабочее окружение

Стек и маршрутизация навыков зафиксированы в [engineering.yaml](engineering.yaml). Основная среда — Codex. Для семи инженерных ролей используется общее назначение из проектного `.codex/config.toml`. В Claude Code точкой входа служит `CLAUDE.md`.

## Подготовка и запуск

Из корня продукта установите зависимости командой `npm ci`. Для браузерного прототипа выполните `npm ci --prefix prototype` и `npm run dev --prefix prototype`. Сервер останавливается через Ctrl+C. Для сборки и запуска приложения используйте [инструкцию macOS](README.md). Нативный smoke запускается в новом временном профиле.

## Чек-лист готовности

- `npm run typecheck` проверяет основные и renderer-типы.
- `npm test` проверяет сценарии календаря и агента.
- `npm run test:wails` запускает нативные тесты со скрытыми окнами.
- `diff -qr -x .DS_Store .agents/skills .claude/skills` сверяет проектные копии. Аналогично сверяются каталоги references, agents и commands. При работе с файлами навыков сохраняйте включённые ресурсы и лицензии.
- Для большинства сторонних локальных снимков engineering.yaml содержит SHA-256 дерева. Для воспроизведения отсортируйте файлы по относительному пути, исключите .DS_Store, для каждого добавьте в общий SHA-256 путь в UTF-8, нулевой байт и двоичный SHA-256 содержимого.

## Graphify

Проверенная версия CLI — 0.9.111. После клонирования выполните `graphify hook install`, затем `graphify hook status`. Для нового рабочего дерева запустите проектный навык `/graphify .` из его корня. Граф хранится локально в graphify-out. Область включает исходники Go и TypeScript, тесты, README и проектную документацию. Исключения перечислены в .graphifyignore.

Обновление кода вручную — `graphify update .`. Для непрерывной работы запустите `graphify watch .` и остановите через Ctrl+C. Изменения документации обрабатываются навыком `/graphify . --update`. Проверьте наличие ожидаемого символа командой `graphify query desktop_wails_smallservice_calendarcache`.

## Проверка установки 27 ноября 2026

Прошли TypeScript, 472 теста Node и нативный набор Wails. Graphify зарегистрировал post-commit, post-checkout, post-merge и post-rewrite. В отдельном Git-репозитории post-commit добавил новую функцию в граф. Запрос к графу Ordo нашёл SmallService и calendarCache.

Codex CLI в режиме read-only выполнил тестовый запрос в отдельной ephemeral-сессии с моделью gpt-6.2-astra. Общая модель назначена ролям через engineering.yaml.

Установленная Ordo.app прошла фоновый WKWebView smoke в новом профиле. В изолированном репозитории проверены обновления графа после checkout, merge и amend, отдельный граф worktree, обновление функции через watcher и маркер needs_update для нового Markdown. Семантический индекс охватывает README, AGENTS, MANUAL, spec-v1, шесть ADR и docs/ui/DESIGN. Поиск по ADR-006 проверен.

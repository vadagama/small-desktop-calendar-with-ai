# Small Calendar 0.2.0-rc.4

Дата: 10 ноября 2026. Предварительный выпуск для macOS arm64 / Apple Silicon.
Основа: `origin/main` (`4669f7b`) + availability dashboard (`fe41900`, PR #57).
Релизная ветка: `codex/release-0.2.0-rc.4`; неизменяемый tag: `v0.2.0-rc.4`.
Точный commit сборки записан в приложенном к GitHub Release `release-manifest.json`.

## Изменения

- Панель свободных слотов на день/неделю рядом с AI-ассистентом.
- Поиск и удаление участников, закреплённый организатор, синхронизация даты,
  длительность, рабочий диапазон, перерывы и продолжение запроса из чата.
- Общие и личные окна по полному покрытию busy; неизвестное время не свободно.
- Повторная проверка точного интервала перед открытием черновика; запись встречи
  происходит только после сохранения формы.
- Availability E2E фиксирует viewport 1440×960: размер скрытого дисплея CI больше
  не меняет ожидаемую типографику через адаптивный CSS. Код UI не изменён.

## Проверки

- `npm run typecheck`, `npm run format:check`, `git diff --check`: passed.
- `npm test`: 566 passed.
- `npm run check --prefix prototype`, `npm test --prefix prototype`: 15 passed.
- `playwright test -c playwright.desktop.config.ts`: 59 passed, 1 skipped.
  Реальный Whisper E2E пропущен без внешних весов/WAV; синтетические голосовые
  сценарии и сборка нативного runtime проверены.
- `npm run build:desktop`, `npm run check:size`: JS 1 171 452 / 1 200 000 bytes;
  CSS 224 968 / 225 000 bytes, пороги не изменялись.
- `npm audit --audit-level=high` и аналогичная проверка prototype: passed;
  остаются moderate advisories, high/critical не обнаружены.
- Whisper 1.8.3 собран из ревизии `2eeeba56e9edd762b4b38467bab96c2517163158`.
- Пакет: codesign verify deep/strict, ASAR budget/allowlist, production Electron
  fuses, runtime rejection of tampered ASAR и `hdiutil verify`: passed.
- Упакованное приложение проверено через renderer CDP в новом изолированном
  профиле, скрытом режиме: Small signed out; логин, пароль, API-ключ пусты;
  LLM-профилей нет; Mood neutral, инструкции пусты; local-vault не содержит
  записей. Предпочтения, контекст, группы и форматы не предзаполнены; до входа
  память недоступна. Voice model uninstalled, offline help работает; ошибок
  renderer нет. Sandbox/contextIsolation включены, Node в renderer недоступен.
- Состав ASAR ограничен `out/`, runtime dependencies и package.json;
  native voice содержит только CLI, лицензию и version.json. В пакете нет
  профилей, credentials, cookies, данных встреч и весов Whisper.
- Инструкция проверена headless Chromium на 320/768/1024/1440 px: изображения,
  внутренние якоря и история rc.3 работают, нет переполнения и page errors.
- Отдельный review availability и исправления теста: новых подтверждённых
  блокеров correctness/security не найдено.

## Артефакт и ограничения

`Small-Calendar-0.2.0-rc.4-arm64-local.dmg`, 137 881 941 bytes.
SHA-256: `4e94c8f31834dedd86bdb36832f50e2b69902727f5bf8fb9f7d90c177bd71053`.

Developer ID на машине отсутствует. Подпись ad-hoc, нотариализации Apple нет:
это предварительная локально подписанная сборка, не production-пакет с
проверкой Apple. Auto-update отключён, подписанный ZIP/feed не публикуется.
Ручное обновление через DMG сохраняет существующий профиль; пакет не переносит
в него тестовые настройки. Новые профили стартуют пустыми.

По явному поручению пользователя инструкция публикуется на GitHub Pages:
<https://vadagama.github.io/small-desktop-calendar-with-ai/>, ветка
`codex/install-pages`, только index.html, style.css, assets и .nojekyll.

## Откат

Предыдущие релизы и Changelog сохранены. При регрессии закрыть приложение,
установить DMG `v0.2.0-rc.3` вручную с заменой, сохраняя пользовательские данные;
вернуть ссылку загрузки страницы на rc.3 отдельным коммитом Pages. Для ценных
профилей перед сменой версии сделать локальную резервную копию. Новых миграций
формата профиля в этом выпуске нет. Внешние встречи проверками не создавались.

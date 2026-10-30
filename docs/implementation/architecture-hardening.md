# Локальная реализация архитектурного аудита

Дата: 30 октября 2026 года. Основание: [аудит и backlog](../audits/architecture-2026-10-30.md).
Рабочая ветка `codex/architecture-hardening`; исходные незакоммиченные изменения
пользователя сохранены. Коммиты, публикация и production-записи не выполнялись.

## Изменения

- R01: перед отправкой записи создаётся устойчивый маркер dirty вне каталога
  кеша. Начатые записи кеша дожидаются завершения; чтения и сохранения во время
  мутации не возвращают старый снимок. Сбой очистки не подменяет успешный ответ
  сервера или unknown outcome. Диск отключается до безопасного восстановления,
  после перезапуска dirty-кеш очищается. Если маркер создать нельзя, операция
  вообще не отправляется; подтверждённый черновик остаётся доступным для повтора.
  Деградация кеша отражается диагностикой, отдельного UI-баннера пока нет.
- R07: рабочие компоненты, календарная логика и CSS находятся в `src/renderer/ui`;
  prototype использует реэкспорты. Production tsconfig и ресурсы независимы от
  prototype. Сохранены прежние размеры шрифтов и плотность интерфейса.
- R08–R10: исключены кеши из упаковки, добавлена инвентаризация ASAR, включена
  минификация; react-markdown перенесён в devDependencies, поскольку включается
  в renderer bundle. Main/worker сохраняют необходимые AI SDK и Zod.
- R11: история разговора удаляется при уничтожении окна независимо от активной
  задачи; повторные сбросы не размножают обработчики destroyed.
- R12: отдельная hardened-сборка выключает RunAsNode, NODE_OPTIONS, Node inspector
  и дополнительные file-привилегии; включает ASAR integrity и OnlyLoadAppFromAsar.
  Проверка читает fuses из бинарника. Подмена ASAR на копии действительно приводит
  к отказу запуска. Utility process работает без системного Node.
- R13: подготовлен режим Developer ID, hardened runtime, notarization и проверки
  stapler/Gatekeeper. Он не выполнялся: сертификат пока отсутствует.
- R14: добавлен `.github/workflows/quality.yml` с закреплёнными actions, установкой
  lockfiles, проверками, Electron-тестами, упаковкой и тестом подмены ASAR.
  Удалённый запуск и branch protection ещё не проверялись/не настраивались.

## Размер

Сравнение сохранённой прежней локальной сборки с новой arm64 hardened-сборкой.
Старый пакет отражает предыдущий snapshot, поэтому это не контролируемый
бенчмарк единственной правки.

| Метрика                         |            До |    После |
| ------------------------------- | ------------: | -------: |
| `.app`, `du -sk`, KiB           |        300792 |   281068 |
| ASAR, байт                      |      42713971 | 22517397 |
| Renderer JS, байт свежей сборки | около 2506310 |  1085783 |
| Renderer CSS, байт              |  около 249610 |   204622 |

Итоговая `.app`: 274,48 MiB, уменьшение на 19,26 MiB (6,56%). ASAR меньше
на 47,28%, renderer JS — примерно на 56,68%. Старое округлённое значение
«около 299 MiB» в исходном аудите уточнено точным `du -sk`: 293,74 MiB.
DMG заново не собирался. Основной оставшийся объём занимает Electron Framework.
Бюджеты: JS 1 200 000 байт, CSS 225 000 байт, ASAR 32 MiB.

## Запуск и память

`scripts/benchmark-package.mjs`: пять пар запусков новой упакованной версии,
свежий/повторно используемый профиль. Кеш файлов macOS не сбрасывался, поэтому
это **не измерение холодного диска**. Время включает присоединение renderer CDP.
RSS суммируется по дереву процессов и снят сразу после этапа; это базовая точка
для будущих сравнений, не доказательство улучшения относительно старой версии.

| Метрика                      | Свежий профиль, min / median / max | Повторный профиль, min / median / max |
| ---------------------------- | ---------------------------------- | ------------------------------------- |
| Готовность UI, мс            | 344 / 357 / 746                    | 348 / 363 / 385                       |
| Idle RSS, KiB                | 458208 / 460528 / 463552           | 445984 / 447536 / 449824              |
| После чата RSS, KiB          | 353104 / 473792 / 474288           | 459008 / 460432 / 462160              |
| После закрытия окна RSS, KiB | 236144 / 320000 / 321024           | 305520 / 307376 / 308768              |

## Воспроизведение

```sh
npm run typecheck
npm test
npm run format:check
npm run build:desktop
npm run check:size
npm run test:desktop
npm run package:mac:hardened
node scripts/check-package.mjs 'release/hardened/Small Calendar-darwin-arm64/Small Calendar.app/Contents/Resources/app.asar'
node scripts/smoke-package.mjs 'release/hardened/Small Calendar-darwin-arm64/Small Calendar.app/Contents/MacOS/Small Calendar'
node scripts/test-package-integrity.mjs 'release/hardened/Small Calendar-darwin-arm64/Small Calendar.app'
node scripts/benchmark-package.mjs 'release/hardened/Small Calendar-darwin-arm64/Small Calendar.app/Contents/MacOS/Small Calendar'
```

Созданный при реализации экземпляр находится в `release/audit-hardened/`.
Это локально подписанная сборка для проверки, не корпоративный релиз.
Для production настроить вне репозитория `SMALL_SIGN_IDENTITY` (Developer ID
Application) и `SMALL_NOTARY_PROFILE` (существующий профиль notarytool), затем
`npm run package:mac:release`. Не передавать секреты через чат или git.

## Отложено по отсутствию инфраструктуры

R02–R04 требуют тестового backend и аккаунтов с разными правами: клиентский mock
не подтверждает приватность файлов или серверный TTL. Контракт вложений не менялся
наугад. R05 оформлен как [предложенный ADR](../decisions/004-secret-storage.md),
R06 отложен до проверки Keychain без повторных диалогов на стабильной подписи.
Фактические R13 notarization/Gatekeeper требуют Developer ID. Эти ограничения
не позволяют считать весь аудит закрытым или выпуск одобренным.

## Итоговая локальная проверка

- Root unit: **512/512**, Electron integration: **47/47**, prototype unit: **12/12**.
- Root и prototype typecheck, форматирование исходников/скриптов/workflow,
  `git diff --check`, production build и renderer size budget: passed.
- Чистая временная копия без каталога prototype и без исходных node_modules:
  `npm ci --ignore-scripts`, root typecheck, desktop build и 512 unit-тестов прошли.
  Первая попытка этой проверки не включала scripts, нужные тесту series-probe;
  после исправления состава временной копии проверка прошла без изменений кода.
- `npm audit --audit-level=high` для обоих lockfiles: 0 известных уязвимостей.
- ASAR inventory/budget, чтение production fuses, `codesign --verify --deep --strict`,
  smoke упакованного приложения с synthetic worker и отказ при подмене ASAR: passed.
- В Electron проверены типографика, layout, создание/изменение встреч, серии,
  авторизация, локальное хранение, настройки памяти и отмена работы ассистента.
  Сетевые сценарии использовали синтетические сервисы, не production backend.

## Последующее решение о пароле Small

По [ADR-005](../decisions/005-session-without-password.md) вместо отложенной
миграции на Keychain реализован режим session-only: пароль не сохраняется,
логин остаётся после выхода, истечение сессии явно требует ввода пароля.
Версия 2 локальной записи мигрируется в версию 3 до сетевых запросов.
Детали и ограничения: [локальное хранение](local-credential-storage.md).

# T04 — Профили LLM и Keychain

Дата: 28 октября 2026. Реализация готова к проверке; реальный Small endpoint
ещё не проверен с ключом пользователя.

## Поведение

Настройки в панели ассистента сохраняют Small или персональный профиль.
Small defaults: `https://ai.skiftrade.kz/v1`, `vllm/glm-5.3-flash`.
Model ID и поддержка tool calling подтверждены пользовательской
[инструкцией Small](https://app.notion.com/p/2eadb33037c88092847cc2cbf6412502#3b8db33037c880c7827bd1df84032f77).
Без ключа `/v1/models` отвечает 401; это не доказательство работы GLM.

Ключ записывается в macOS Keychain через `@napi-rs/keyring` (N-API), а native
binding распаковывается из ASAR. Сервис Keychain изолирован по app data directory.
JSON содержит URL, model ID, активный профиль и ссылки на credential UUID;
в renderer сохранённый ключ не возвращается. Введённый ключ очищается из формы
после отправки. Смена origin требует нового ключа; HTTP разрешён только для
loopback. Редиректы запрещены, чтобы Authorization не ушёл другому origin.

Новый ключ записывается до атомарной замены метаданных. Старый удаляется после
неё; отказ удаления виден в UI и повторяется при следующем сохранении/удалении.
Отказ чтения Keychain и повреждённый JSON останавливают запрос. Смена профиля
отменяет активный запрос. Локальная модель выбирается явно, fallback отсутствует.
Провайдер вызывается в utility process напрямую, без AI Gateway. Ошибки сервиса
показываются в обезличенном виде, reasoning не передаётся в UI.

## Проверка

- 28 unit/integration tests: schemas, origin/key rotation, отказ и отсутствие
  ключа, повреждённые метаданные, повтор удаления, redirects, HTTP SSE и tool loop,
  SDK runtime и renderer transport.
- Typecheck и Prettier проходят.
- Три Electron E2E проходят в упакованном arm64 приложении с PATH без Node:
  изоляция окна; streaming/ошибка/отмена; настройки + настоящий Keychain +
  локальный HTTP SSE/tool call + отказ 401 без fallback + очистка ключа.
- Используются только синтетические данные. Тестовые Keychain записи удалены.
- Размеры интерфейса сохранены из отдельного PR увеличенного UI.

## Осталось проверить

Пользователю нужно ввести свой ключ в настройках приложения и выполнить
«Сложи 2 и 3» на выбранной GLM. До этого последний acceptance criterion T04
остаётся открытым. Эта локальная проверка не подтверждает production signing,
notarization или поведение Keychain после смены подписи приложения.

Документация зависимостей: [OpenAI-compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers/custom-providers),
[keyring](https://github.com/Brooooooklyn/keyring-node),
[Electron ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives).

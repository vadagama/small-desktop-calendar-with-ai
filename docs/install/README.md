# Установка Ordo

Публичная инструкция Ordo: `index.html`, `style.css` и `assets/`.
По явному поручению пользователя публикуется на GitHub Pages:
<https://vadagama.github.io/small-desktop-calendar-with-ai/>. Источник — корень
ветки `codex/install-pages`. Публикуются только файлы этой папки.

Стабильный выпуск подписан Apple Developer ID и нотариализован. Инструкция
содержит установку DMG, вход в Small, настройку LLM/Voice и обновление в приложении.
Старые шаги обхода Gatekeeper удалены; история выпусков сохранена в Changelog.

Скриншоты снимались из скрытого WKWebView с новым изолированным профилем,
без логина, пароля, API-ключей и реальных встреч. Для повторной съёмки соберите
тестовый capture-host рядом с нативным Whisper, чтобы состояние Voice совпадало
с полной сборкой. Пример из корня репозитория:

```sh
capture_dir="$(mktemp -d /tmp/ordo-docs.XXXXXX)"
mkdir -p "$capture_dir/Contents/MacOS" "$capture_dir/Contents/Resources/voice"
cp native/voice/whisper-cli "$capture_dir/Contents/Resources/voice/"
MACOSX_DEPLOYMENT_TARGET=15.1 go -C desktop-wails test -c -tags docs_capture -o "$capture_dir/Contents/MacOS/capture.test"
SMALL_WAILS_DOCS_DIR="$(pwd)/docs/install/assets" "$capture_dir/Contents/MacOS/capture.test"
```

Локальная проверка: `python3 -m http.server 4180 --bind 127.0.0.1 --directory docs/install`.
Проверить 320/768/1024/1440 px, якоря, изображения, раскрытие архива и ссылки
на DMG и контрольные суммы. После деплоя проверить публичный URL и latest feed
`releases/latest/download/latest-wails-mac.json`.

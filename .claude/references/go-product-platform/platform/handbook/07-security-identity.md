---
title: "Безопасность, идентификация и секреты"
description: "Rauthy, RustFS и OpenBao; identity, сессии и авторизация без отдельного users-service; профили секретов от .env.local до общего OpenBao."
handbook: "Go Product Platform — руководство по архитектуре и разработке с ИИ"
version: "16.0"
updated: "2026-11-21"
order: 7
source: "handbook.md §15, §28, §29"
tags: [security, oidc, rauthy, openbao, rustfs, identity, authorization, secrets, sops, age]
up: README.md
prev: 06-go-stack.md
next: 08-builtin-capabilities.md
---

# Безопасность, идентификация и секреты

**В этом документе:** [Безопасность: Rauthy, OpenBao, RustFS](#security) · [Identity, сессии и авторизация](#identity-access-v11) · [Секреты: минимальный профиль и общий OpenBao](#secrets-v11)

<a name="security"></a>

## Безопасность: Rauthy, OpenBao, RustFS

**Rauthy:** OIDC, MFA/passkeys, идентичность; Go API валидирует issuer/audience/JWKS и исполняет авторизацию `subject × action × resource × tenant`. Для сложных объектных прав добавить OpenFGA/Casbin только если это реально требуется. Не доверять только UI-ролям.

**RustFS:** S3 совместимое object storage; Go API проверяет файл, размер, тип, владельца и выдает короткоживущий presigned URL с ограничением scope. Upload finalize подтверждает checksum и owner. Доступ к административным S3 ключам никогда не дается клиенту. Совместимость конкретного S3 SDK проверить интеграционными тестами.

**OpenBao (опциональный общий сервис):** KV, динамические credentials и policies; Рабочая среда использует mTLS/auth method, доступ по необходимости, audit и ротацию. На локальном Mac можно использовать секреты только для разработки с короткой жизнью; секреты рабочей среды никогда не копировать в worktrees. В VM доставлять секреты через шаблон OpenBao Agent в защищённые файлы или через прямое обращение к SDK там, где нужны динамические операции. Bootstrap/Unseal отдельно от бизнес Compose. Для начальная зашифрованная конфигурация подходит SOPS + age.

**Mobile/desktop:** access/refresh tokens — Keychain / Android Keystore / platform-secure storage; не хранить серверные master keys. Любой Wails bridge метод проверяет permissions. Внешний HTML открывать вне привилегированного WebView; при iframe проводить независимую security review.

<a name="identity-access-v11"></a>

## Идентификация, сессии и авторизация без отдельного сервиса пользователей

**Три разных уровня:** (1) аутентификация устанавливает, кто вошёл; (2) локальная учетная модель хранит членство, роль и профиль; (3) прикладная авторизация разрешает конкретное действие над конкретным ресурсом.

- Внешнюю учетку связывать с локальным пользователем через **пару `issuer + subject`**, а не email. Привязка к исходному IdP допускает смену адреса и несколько провайдеров.
- При наличии корпоративного IdP **не разворачивать собственный Rauthy/Keycloak на каждый продукт**. Для Go-клиента выбирать [go-oidc](https://github.com/coreos/go-oidc) и `golang.org/x/oauth2`; API отдельно проверяет JWT audience, issuer, expiry и права бизнес-операции.
- Для автономного продукта при оправданных требованиях — SCS и PostgreSQL с защищёнными cookie, CSRF и средствами предотвращения brute-force; создание собственного identity provider не становится дефолтом.
- Для authorization — маленький модуль `access.Authorize(ctx, actor, action, resourceScope)`; при настройке сложных ролей добавлять [Casbin](https://casbin.org/docs/overview/) **в процессе**, а [OpenFGA](https://openfga.dev/docs) только при настоящем графе отношений.
- Права необходимо проверять в поиске, списках, статистике, экспорте, файлах, RPC, websocket subscriptions и фоновых действиях. Флаг функции не заменяет authorization — см. [флаги](08-builtin-capabilities.md#flags-v11).

```go
// Проектный контракт, а не функция внешней библиотеки.
type Actor struct {
    UserID, OrganizationID string
}
type ResourceScope struct {
    OrganizationID, ResourceID string
}
func Authorize(ctx context.Context, actor Actor, action string, scope ResourceScope) error {
    if actor.OrganizationID != scope.OrganizationID {
        return ErrForbidden
    }
    // Далее: membership + permission + actual resource ownership.
    return nil
}
```

**Проверка отказов:** один пользователь обращается к ресурсу другой организации; отозванная роль; чужой export/download; попытка подписаться на другую область данных; замена идентификатора через RPC; старый access token после блокировки. Тестирование только успешного сценария недостаточно.

<a name="secrets-v11"></a>

## Секреты: минимальный профиль и общий OpenBao при необходимости

**Минимальный профиль:** в DEV — `.env.local` вне Git (только тестовые значения), в PROD на VM — root-owned файлы / Compose secrets, шифрованные в Git через SOPS+age и расшифрованные при deployment. Compose secrets монтируются в контейнер как файлы; исходный файл на VM всё равно надо защищать. Шифрованные пользовательские токены хранятся в PostgreSQL вместе с `key_version`, а ключ шифрования приходит **извне этой БД**.

**Общий OpenBao** предпочтителен там, где нужны политики, аудит чтения секретов, PKI, динамические PG credentials и отзыв. Он может существовать как общий сервис компании, но **не входит в локальный dev loop и не требуется каждому продукту**. Если OpenBao используется, секреты поставляются через agent/файл либо явный Rust/Go vault-compatible клиент; приложение отвечает за обновление/перечитывание и сбои доставки.

| Среда | Предпочтение | Обязательный контроль |
|---|---|---|
| Worktree | Отдельные фейковые credentials, низкие права | Никаких учётных данных рабочей среды в агенте |
| Local integration | DEV OIDC/PG и тестовые ключи | Выделенная DB role, ограниченная область |
| VM Compose small | SOPS+age → защищённые файловые secrets | Права файлов, ротация, backup ключей |
| VM Compose enterprise | Shared OpenBao + short-lived auth | Machine identity, TLS, audit, recovery |
| Kubernetes опционально | OpenBao + workload identity/CSI/ESO | Ограниченные service accounts |

**Безопасность:** не выводить секреты в трассировки, снимки экрана, prompt logs и отчеты агента. Продакшен мастер-ключи никогда не встраиваются в web/Wails/mobile приложения.

---

Навигация: [← 06. Стек Go-бэкенда](06-go-stack.md) · [Оглавление](README.md) · [08. Встроенные возможности →](08-builtin-capabilities.md)

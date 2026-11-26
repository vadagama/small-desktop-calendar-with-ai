---
schema_version: 1
id: STD-UPSTREAM
type: standard
title: "Переиспользование upstream skills"
status: draft
language: ru
owner: "Сопровождающие репозитория"
created: "2026-11-21"
updated: "2026-11-21"
related: []
---

# Переиспользование upstream skills

Основание: [README upstream](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/README.md), commit `8c99fa36d90068c82d547f7c12a9d67a3e95f4ee` (редакция upstream 0.6.17). Версия закреплена в [lock](../upstream.lock.yaml). Таблица связывает все 26 skills с расширением документации; это не замена их инструкций и не требование запускать все навыки для каждой задачи.

| Skill (оригинальный источник) | Переиспользование | Наше дополнение |
| --- | --- | --- |
| [using-agent-skills](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/using-agent-skills/SKILL.md) | Выбор применимых навыков | Учитывать профиль и capabilities |
| [interview-me](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/interview-me/SKILL.md) | Уточнение намерения | Русские требования и открытые вопросы |
| [idea-refine](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/idea-refine/SKILL.md) | Развитие идеи | Инициатива при нескольких связанных изменениях |
| [spec-driven-development](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/spec-driven-development/SKILL.md) | Спецификация и её gates | Русская SPEC + frontmatter; карта возможностей |
| [constraint-driven-development](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/constraint-driven-development/SKILL.md) | Измеримые ограничения | CONSTRAINTS с владельцами исключений |
| [planning-and-task-breakdown](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/planning-and-task-breakdown/SKILL.md) | План и задачи | Русский план; один источник задач |
| [incremental-implementation](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/incremental-implementation/SKILL.md) | Вертикальные срезы | Обновлять затронутые документы вместе с кодом |
| [test-driven-development](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/test-driven-development/SKILL.md) | Проверка изменения поведения | Связь результатов с критериями |
| [context-engineering](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/context-engineering/SKILL.md) | Рабочий контекст | Загружать выбранные версии, HLD и актуальные ADR |
| [source-driven-development](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/source-driven-development/SKILL.md) | Первичные технические источники | Ссылки sources; стек определяет платформа |
| [doubt-driven-development](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/doubt-driven-development/SKILL.md) | Проверка решений при применимости | Выводы связывать с артефактами и доказательствами |
| [frontend-ui-engineering](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/frontend-ui-engineering/SKILL.md) | Интерфейс пользователя | UI-контракты и требования в SPEC/LLD |
| [api-and-interface-design](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/api-and-interface-design/SKILL.md) | Границы и контракты | API/Event/Data документы со ссылкой на первоисточник |
| [browser-testing-with-devtools](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/browser-testing-with-devtools/SKILL.md) | Проверка браузерного поведения | Результаты в разделе проверки плана или задачи |
| [debugging-and-error-recovery](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/debugging-and-error-recovery/SKILL.md) | Диагностика и восстановление | Подтверждённые причины и регрессионная проверка |
| [code-review-and-quality](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/code-review-and-quality/SKILL.md) | Review перед merge | Проверка влияния на документацию |
| [code-simplification](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/code-simplification/SKILL.md) | Упрощение реализации | LLD обновляется при изменении устройства |
| [security-and-hardening](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/security-and-hardening/SKILL.md) | Безопасность | Анализ угроз и принятых рисков |
| [performance-optimization](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/performance-optimization/SKILL.md) | Измерение производительности | NFR и доказательства результата |
| [accessibility-engineering](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/accessibility-engineering/SKILL.md) | Доступность UI | Критерии и результаты проверки в SPEC |
| [git-workflow-and-versioning](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/git-workflow-and-versioning/SKILL.md) | История изменений | Документы в Git продукта |
| [ci-cd-and-automation](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/ci-cd-and-automation/SKILL.md) | Проверки и доставка | Проверки артефактов наряду с командами платформы |
| [deprecation-and-migration](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/deprecation-and-migration/SKILL.md) | Вывод из эксплуатации и миграции | История ADR, карта перехода и rollback |
| [documentation-and-adrs](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/documentation-and-adrs/SKILL.md) | Документация и решения | HLD/LLD, русский язык, метаданные, каталог артефактов |
| [observability-and-instrumentation](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/observability-and-instrumentation/SKILL.md) | Наблюдаемость | Эксплуатация и измеримые NFR |
| [shipping-and-launch](https://github.com/addyosmani/agent-skills/blob/8c99fa36d90068c82d547f7c12a9d67a3e95f4ee/skills/shipping-and-launch/SKILL.md) | Готовность выпуска | CHANGELOG, эксплуатационные разделы HLD/LLD и проверка фактического состояния |

Порядок предпочтений: оригинальный skill → соглашения продукта → минимальное расширение только для непокрытой обязанности. HLD/LLD, метаданные, долг и инициативы здесь определены как артефакты существующего процесса, поэтому отдельные дублирующие skills пока не создаются.

Примеры upstream не являются требованиями к стеку продукта. Проектные соглашения меняют представление и пути в поддерживаемых местах, но не убирают инженерную проверку и согласования. Оригинальные файлы skills и их supporting references устанавливаются штатным способом; их содержание в этот репозиторий не включено.

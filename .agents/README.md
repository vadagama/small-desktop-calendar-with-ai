# Project agent skills

All 25 skills from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) are installed locally in `skills/` for this project. Codex discovers these skills automatically; use them by name or describe the task. They are available from the next turn after installation.

The repository's root [`AGENTS.md`](../AGENTS.md) is the shared instruction entry point for Codex and Zed Agent. It requires reading `skills/using-agent-skills/SKILL.md` on **every user request**, then reading and applying the relevant local skills. This uses agent instructions, not an IDE request hook; it does not require a network request to GitHub for every prompt.

Zed Agent supports `AGENTS.md` directly, so no duplicate `.rules` file is needed. External agents started inside Zed follow their own loaders. Start a fresh chat after changing project instructions and verify skill loading with: “Какие инструкции проекта и skills ты применяешь к этому запросу?” See the official [Codex instructions](https://developers.openai.com/codex/guides/agents-md) and [Zed instructions](https://zed.dev/docs/ai/instructions).

Shared checklists are in `references/`; upstream reviewer personas are in `agents/` as supporting material. Skill files are kept unchanged. The upstream MIT license is preserved in `LICENSE.agent-skills`.

Source revision: `aeac41d4d005999432bb7312f7ff06383a91d59d` (installed 2026-10-28).

To update, compare against upstream and replace the skill directories and supporting material together, then update the revision above. Preserve project-specific changes if any have been made.

## Additional project skills

Installed locally on 2026-10-28, including each skill's references and supporting files:

| Skill | Source | Verified source revision |
| --- | --- | --- |
| `typescript-pro` | [jeffallan/claude-skills](https://github.com/jeffallan/claude-skills/tree/main/skills/typescript-pro) | `190e05a380b624187f5770451e1f41b9187cb63c` |

The TypeScript source repository's MIT license is preserved in `LICENSE.typescript-pro`.

The TypeScript skill extends the 25 Addy Osmani workflows. The root `AGENTS.md` specifies how to select them.

## Project-owned workflows

`skills/build-release/SKILL.md` — проектный навык для команды «собери релиз»:
production-приложение с чистыми настройками, GitHub Release, Changelog и
GitLab Pages с актуальным DMG. Создан по требованиям пользователя; не является
частью vendored upstream-коллекций выше и не меняет их ревизии и лицензии.

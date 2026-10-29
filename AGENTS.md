# Small Desktop Calendar — agent instructions

These project instructions apply to Codex (desktop, CLI and IDE integrations),
Zed Agent, and compatible external agents working in this repository.
Resolve paths below relative to the repository root.

## Required on every user request

Before answering, planning, researching, editing, or running task commands:

1. Open and read `.agents/skills/using-agent-skills/SKILL.md`. Repeat this for
   **every user message**, including follow-ups, questions, reviews, and small
   changes. Do not rely only on skill descriptions or a previous turn's memory.
2. Select the relevant workflows from the local `.agents/skills/` collection
   from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills).
   Read each selected `SKILL.md` before doing the work it governs. Prefer this
   project's local copy over a globally installed duplicate.
3. Briefly tell the user, in Russian, which skills you are applying and why.
   For a simple question, the discovery skill alone can be sufficient; do not
   force an implementation workflow onto an informational request.
4. Follow the selected workflows and load their referenced checklists only as
   needed. Re-evaluate skill selection if the task changes during the turn.
5. If a required skill is missing or unreadable, report the exact path and
   limitation. Do not claim it was applied or silently substitute remembered
   instructions. Continue only work that does not depend on the missing skill.

This is a per-request instruction workflow, not an IDE event hook. Use local
files for routine skill consultation; do not download or update upstream on
every request. Update the vendored collection only as an intentional task,
preserving its source revision, references, and license in `.agents/README.md`.

## Workflow selection

All skill paths use `.agents/skills/<name>/SKILL.md`.

| Work | Skills to consider |
| --- | --- |
| Clarify intent or explore alternatives | `interview-me`, `idea-refine` |
| Define a feature and quality requirements | `spec-driven-development`, `constraint-driven-development` |
| Plan implementation | `planning-and-task-breakdown` |
| Configure agent context or instructions | `context-engineering` |
| Implement a change | `incremental-implementation`, `git-workflow-and-versioning` |
| Implement or change behavior | `test-driven-development` |
| Build UI | `frontend-ui-engineering`, `browser-testing-with-devtools` |
| Build, package, secure, or test Electron | `electron-best-practices` |
| Write or review TypeScript contracts and configuration | `typescript-pro` |
| Define APIs or module contracts | `api-and-interface-design` |
| Verify approaches against official docs | `source-driven-development` |
| Debug failures | `debugging-and-error-recovery` |
| Review or simplify code | `code-review-and-quality`, `code-simplification` |
| Assess consequential design assumptions | `doubt-driven-development` |
| Handle security boundaries | `security-and-hardening` |
| Measure and improve performance | `performance-optimization` |
| Add runtime diagnostics | `observability-and-instrumentation` |
| Document decisions | `documentation-and-adrs` |
| Configure delivery or release | `ci-cd-and-automation`, `shipping-and-launch` |
| Migrate or retire behavior | `deprecation-and-migration` |

## Project context

- Goal: a desktop client for the Small team calendar with an AI assistant.
- Calendar: <https://team.small.kz/calendar>.
- Existing frontend: <https://gitlab16.skiftrade.kz/staff/team-small-kz-frontend>.
- Existing backend: <https://gitlab16.skiftrade.kz/staff/team-small-kz-backend>.
- This repository currently contains a README and agent resources; application
  code, dependency manifests, and build/test commands have not been added yet.
- Pake/Tauri versus Electron and Pi Durable versus Hermes are under evaluation.
  Earlier recommendations are not an approved technology decision. Verify
  current repository state and accepted decisions before scaffolding an app.

## Working conventions

- Respond in Russian unless the user requests another language.
- Inspect the actual files and `git status` before edits. Preserve existing user
  changes, including untracked files. Prefer `rg` for discovery.
- Keep changes scoped and incremental. State material assumptions; ask only
  when missing information blocks a meaningful decision or required permission.
- Explicit user instructions take precedence over workflow defaults. Skills do
  not independently authorize commits, pushes, deployments, or production writes.
- For new branches use `codex/<short-description>` unless directed otherwise.
- Reuse existing calendar APIs and business rules where practical; verify their
  contracts and authorization instead of assuming behavior from route names.
- Treat time zones, recurring-event instances versus whole series, participant
  permissions, and duplicate prevention on retries as explicit calendar cases.
- Keep agent credentials and privileged operations outside remote web content.
  Give calendar tools narrow permissions; do not expose arbitrary shell access
  or bypass scheduling conflicts automatically.
- Do not store secrets, access tokens, real meeting payloads, or personal data
  in repository files or test fixtures.
- Discover verification commands from real manifests and CI configuration.
  Do not invent `npm`, Rust, or Electron commands before those tools exist here.
- Run checks appropriate to the change. Report what passed, what could not be
  checked, and remaining limitations; never claim a check that was not run.

## Codex and Zed loading

- Codex uses the root `AGENTS.md` and discovers repository skills in
  `.agents/skills/`.
- Zed Agent supports project `AGENTS.md`. Other supported rules filenames can
  take precedence, so avoid adding a competing `.rules`, `.cursorrules`,
  `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, or `AGENT.md`
  without intentionally reconciling the instructions.
- External agents launched from Zed use their own instruction-loading behavior.
  Open this repository as the working project and verify that the selected agent
  reads this file; Zed's loader does not control every external agent.
- For a smoke check in a fresh chat, ask which project rules and skills were
  loaded. The agent should read the discovery skill and report actual paths.

## References

- Local skills and provenance: `.agents/README.md`.
- Shared quality criteria: `.agents/references/definition-of-done.md`.
- Codex: <https://developers.openai.com/codex/guides/agents-md>.
- Zed: <https://zed.dev/docs/ai/instructions>.

## UI typography and density

For every UI change, read `docs/design/typography.md` and use the shared
`--font-*` tokens in `prototype/src/styles.css`. Menus use 12 CSS px, compact
content 13 px, form/body text 14 px, dialog titles 18 px. Do not derive CSS
font sizes from screenshot pixels: screenshots may be Retina or zoomed.
Preserve the compact desktop density; do not increase font sizes or spacing
unless the user requests it. Verify computed font sizes in Electron.

## Why

Website QA today is manual. A developer opens a browser, clicks through features, signs in to each test account in turn, and writes up problems by hand. This is slow, differs from person to person, and is not repeatable across the several sites and accounts the team maintains (for example four TuberStudio and FoodGPT front ends with six niche accounts). A drop-in testing agent for Claude Code lets any team member say "test checkout" or "test all" and get the same checks and a consistent written report.

## What Changes

- Add a Claude Code testing agent (a skill plus a `/test` command) that drives a real browser through `playwright-cli` and reports problems.
- Add a user-editable `instructions.md` that declares browser, targets (sites), accounts, and per-feature steps and expectations. The agent acts only on what this file says.
- Support two run modes: a single named feature, or `all` (every feature on every applicable account, run in parallel with one browser session per account).
- Produce one self-contained HTML report per run. Each issue has a title, severity, reproduction steps, expected versus actual result, console and network evidence where relevant, a short text-only fix suggestion (no code), and an embedded screenshot.
- Take screenshots while testing, keep only those tied to an issue, embed them in the report, and delete every other image so a clean run leaves no loose files.
- Add a one-command installer that runs from a GitHub repo (`npx github:<org>/<repo> init`). It creates the instructions file, installs the skill and command into `.claude/`, installs `playwright-cli` skills and its own Chromium, and adds a short pointer in the project's `CLAUDE.md`.
- Use Playwright's bundled Chromium by default. Allow Chrome, Edge, or an attached Brave through a `browser` setting in `instructions.md`.
- Allow `agent-desktop` as an optional desktop-control switch, off by default, with a setup check for accessibility permission and for whether the browser window is visible to it. Desktop control is verified with the bundled Chromium. Other browsers, such as an attached Brave, may or may not be visible to it, so the check runs every time and stops with guidance when the browser window cannot be seen.
- Run payment steps only when the target uses a Stripe sandbox key (`pk_test_` prefix). Sign-up and real-payment steps are never run unless the user's instructions explicitly define them for a sandbox.
- Write a machine-readable pass/fail result next to the report so a run can later be checked in CI.

Non-goals for this version: filing issues in GitHub or other trackers, editing application code, writing code samples in fix suggestions, supporting agents other than Claude Code, and supporting Firefox or WebKit.

## Capabilities

### New Capabilities
- `project-install`: One-command install and attach of the agent, skill, command, instructions template, and browser into a host project.
- `instructions-file`: Format and meaning of `instructions.md`, covering setup, targets, accounts, features, steps, and expectations.
- `test-run`: Selecting a single feature or `all`, session handling per account, parallel execution, and preflight checks.
- `browser-setup`: Browser choice (bundled Chromium, Chrome, Edge, attached Brave) and the optional `agent-desktop` switch with its permission check.
- `test-report`: The HTML report, issue content, screenshot retention and cleanup, fix suggestions, and the pass/fail result file.

### Modified Capabilities
<!-- None. The project has no existing specs. -->

## Impact

- New distributable GitHub repo (installer CLI, skill, command, templates, report generator).
- Host projects gain `.testing-agent/` (instructions and git-ignored reports), `.claude/skills/` and `.claude/commands/` entries, and a short `CLAUDE.md` pointer.
- Depends on Node.js 18 or newer, `@playwright/cli`, and Playwright's Chromium download. `agent-desktop` is an optional dependency.
- Test accounts and credentials live in `instructions.md`, so the template must warn against use in public repos.
- Pilot host project: TuberStudio (`front/tuber-live`), which already uses `playwright-cli`, Brave attach, and per-niche accounts.

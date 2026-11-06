## Context

See proposal.md - Why. This repo (`agentic-desktop`) is empty apart from OpenSpec, so the design is greenfield.

Findings from the research that shape the approach:
- `@playwright/cli` is built for coding agents. It gives text snapshots with element refs, `find`, named sessions (`-s=name`), tabs, screenshots, console and network capture, `attach --cdp`, and `install --skills`. Tab switching and `eval` cover cross-site flows such as reading text on youtube.com and filling it into the app, so the system clipboard is not needed.
- `agent-desktop` drives native apps through the OS accessibility tree (AT-SPI on Linux, AX on macOS, UI Automation on Windows). It is not needed for web content. It is kept as an optional extra.
- The pilot project (TuberStudio front end) already uses `playwright-cli`, attaches to Brave over a debug port, uses six per-niche accounts, switches accounts by clearing cookies and storage, and deletes screenshots after QA. The design reuses these habits.
- The agent is Claude Code only for now, so the "agent" is a skill and a slash command, not a standalone program.

## Goals / Non-Goals

**Goals:**
- Fast runs: decisions come from text snapshots, and screenshots are taken only as evidence.
- Zero-config attach for a host project through one command.
- Deterministic parts (install, preflight, report building, result file) are plain scripts. Judgement parts (following steps, comparing with expectations) belong to the agent.

**Non-Goals:**
- A custom test runner or a replacement for scripted Playwright tests.
- Hosting, dashboards, or history across runs.
- Supporting Firefox, WebKit, or agents other than Claude Code.

## Decisions

**1. Skill plus command, backed by small scripts.**
The skill holds the run rules, the report rules, and how to use `playwright-cli`. `/test <feature|all>` is the entry point. Scripts handle what must not vary: parsing `instructions.md`, preflight, building the HTML report, writing the result file, and cleanup.
Alternative: a standalone Node program that calls an LLM API. Rejected: it duplicates what Claude Code already does and adds key handling.

**2. `playwright-cli` as the only browser driver.**
`agent-desktop` is a switch (`desktop_control: on`), off by default, with a permission check and a window-visibility check.
Verified on Linux (Wayland): with a headed bundled Chromium window, `agent-desktop snapshot --app chrome` returned 86 element refs. With an attached snap-installed Brave the result varied: one session returned `WINDOW_NOT_FOUND` even with `--force-renderer-accessibility`, and a later session listed the Brave window normally (cause unknown). So desktop control is verified with the bundled Chromium, and visibility is checked at run time by matching the window to the title of the page the run opened. Matching by app name alone is wrong, because it matched the user's own browser window.
Alternative: always include `agent-desktop`. Rejected: nothing in the web scope needs it, and it adds a Rust binary and OS permission setup for every user.

**3. Bundled Chromium by default, others by setting.**
The installer downloads Playwright's Chromium. `browser:` accepts `chromium`, `chrome`, `msedge`, or `brave` with attach mode and a debug port. This removes machine differences (snap profile paths, missing debug ports).
Alternative: attach to the user's own browser by default. Rejected: more setup and it varies across the team. Brave attach is verified. Chrome and Edge are still untested.
Verified during implementation: `playwright-cli open` with no `--browser` flag falls back to the Google Chrome channel when headed. Bundled Chromium therefore always opens with a config (`browserName: chromium`, `channel: chromium`) plus `--headed` when visible. See `docs/browser-notes.md`.

**4. `instructions.md` is Markdown with a small front-matter-style setup block.**
A setup block (browser, mode, port, desktop control), a targets list, an accounts list, and one `## Feature:` section per feature (target, accounts, steps, expect, extra checks). Plain Markdown keeps it editable by non-developers, and the parser tolerates extra prose. Credentials sit inline, per the team's decision, with a warning in the template.
Alternative: YAML or JSON. Rejected: harder for non-developers to write steps in.

**5. Parallelism is one session per account.**
For `all`, the agent starts one named `playwright-cli` session per account and runs that account's features in order. Different accounts never share a session, so sign-ins cannot clash. Single-feature runs use a visible browser and run one account at a time so the user can watch. `all` runs headless, at most `max_parallel` sessions at once (default 3, set in the setup block), and a free slot starts the next account. An attached browser is one shared browser, so its accounts run one at a time and the agent clears cookies and storage before each sign-in.
Alternative: one session, switching accounts by clearing storage (the current TuberStudio habit). Rejected for `all` because it is serial and slow. It stays acceptable for a single feature with one account.

**6. Evidence handling: capture freely, keep only failures.**
During a feature, screenshots are written to a temporary folder. When a check fails, the matching screenshot, the console messages, and the failed requests are attached to the issue record. The report builder base64-embeds screenshots into one HTML file, then deletes the temporary folder.
Alternative: link to image files beside the report. Rejected: breaks when the file is moved, and it conflicts with the delete-screenshots rule.

**7. Result file and check command for CI.**
Each run writes `result.json` (overall status and counts) beside the report. A `check` command in the installed package reads it and exits non-zero on failure. A run fails when it has any issue or any feature that was not run, so an unreachable site cannot pass CI by accident. Skipped steps (a payment on a live key) do not fail a run. Actually running tests in CI needs headless Claude Code and is not designed here.

**8. Stripe sandbox guard by key prefix.**
Before a payment step, the agent reads the target's publishable key from the page or network and runs the step only if it starts with the test-mode prefix. Unknown means skip.

**9. Install from GitHub through `npx github:<org>/<repo> init`.**
The repo has a `bin` entry that copies the skill, command, and templates, appends to `CLAUDE.md` and the ignore file, then runs the browser installs. The install is idempotent: it never overwrites an existing `instructions.md`.
`npx` leaves no command on the PATH, so the install also copies the run tools into `.testing-agent/runtime`, and the skill runs that copy with `node`. After installing the browser, the install opens it once. Found in a clean Node 22 container: on a bare Linux machine Chromium downloads but cannot start without system libraries. In that case the install warns with the fix (`playwright-cli install-browser chromium --with-deps`) and exits 1, and a second run after the fix passes.

## Risks / Trade-offs

- [Agent runs are slower and less repeatable than scripted tests] → Precise steps and expectations in `instructions.md`, text snapshots instead of images, and scripted preflight and reporting.
- [False issue reports] → The skill requires re-checking a failure once before recording it, and records the retry result.
- [Parallel sessions overload a machine or hit rate limits] → Cap parallel sessions (default 3, `max_parallel` 1 to 16) and queue the rest.
- [Credentials in a committed file] → Template warning, test-only accounts, and reports and temporary files excluded from version control.
- [Prompt injection from tested pages, including youtube.com] → The skill states that page text is data, and the spec requires ignoring and reporting it.
- [Third-party sites add consent pop-ups or bot checks] → Steps may declare dismissal actions. Unhandled blocks are reported as issues, not silent failures.
- [Alternative browsers behave differently from Chromium] → Verify Chrome, Edge, and Brave attach early, and document known limits.
- [`agent-desktop` visibility of a snap-installed Brave window varies between sessions (cause unconfirmed)] → A window-visibility check runs every time and stops the run with guidance. Desktop control is documented as verified with the bundled Chromium only.

## Migration Plan

New project with no existing users. Pilot on TuberStudio (`front/tuber-live`): run `init`, port the existing niche accounts and a few features into `instructions.md`, compare results with a manual run. Rollback is removing `.testing-agent/`, the skill and command files, and the `CLAUDE.md` pointer.

## Open Questions

None.

Resolved during implementation: the default session limit is 3, each run keeps its own dated report folder so history is kept, and `check` fails on not-run features.

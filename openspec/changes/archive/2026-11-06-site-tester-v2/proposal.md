## Why

The first real run (TuberStudio, Stepgen feature, `recipe` account) worked and found three issues, but it showed where v1 is hard to use. Each feature hard-codes its target and accounts, so the same steps cannot be reused on another site or account without editing the file. The user's own `instructions.md` had four mistakes that the agent had to repair silently. Findings sit only in an HTML file on one machine, with no task list and no way to share it. Team members who are not developers need to say what to test in plain words.

## What Changes

- **Run request in plain words.** `/test <feature|all> <free words>`. The feature name comes first. The free words are the user's own input and can name the target, the accounts, and run-only extra checks, for example `/test stepgen on beta using the recipe account and the free account`.
- **Ask when missing.** If the target or accounts are not given, the agent asks. If they are given, it uses them. In a run where nobody can answer, it stops with a message that lists what is missing, and never guesses.
- **Features hold only instructions.** A feature has steps, expected results and checks, with paths relative to the target. **BREAKING:** `target:` and `accounts:` lines inside a feature are no longer used. They are ignored with a warning. Existing v1 files keep parsing.
- **Account labels.** Accounts carry free labels such as `niche` and `plan`, so words like "the recipe account" or "the free account" can be matched. Differences between plans are written as plain words in the expected results.
- **Task list in the report.** The HTML report opens with a task list ordered by severity, and a `tasks.md` is written beside it. Features that could not run appear as tasks too.
- **`/test share`.** Publishes the latest report as a shareable page, only when the user types it. If no publishing tool exists, it prints the file path instead.
- **Instructions checker.** A plain-words check of `instructions.md`. The agent may repair only one mechanical mistake, a target address with no `http://` or `https://`, and must say what it changed. Anything else it asks about.
- **Smaller plan for `all`.** The run plan describes each feature once, however many accounts run it.
- **Desktop control claim reduced.** The spec stops promising that the agent drives windows with `agent-desktop`. It only checks permission and window visibility, which is all the skill does.

Assumptions, confirmed by the user:
- Old `target:` and `accounts:` lines in a feature are ignored with a warning, not kept as defaults. One way of doing things, at the cost of editing the one existing pilot file.
- Free words may add extra checks for that run only. They are read-only, they are shown in the report, and they never override the safety rules (no sign-up, payments only on a Stripe test key).

Non-goals: speed and token cost (deferred by the user), filing issues in trackers, building or managing a free-plan account (the project adds it to its own instructions), and agents other than Claude Code.

## Capabilities

### New Capabilities
- `run-request`: Turning `/test <feature|all> <free words>` into a validated run: choosing target and accounts from the words, asking when they are missing, stopping when nobody can answer, and recording the request in the report.
- `report-sharing`: `/test share` publishing the latest report only on request, with a file-path fallback.
- `instructions-check`: A plain-words check of `instructions.md` and the limits on what the agent may repair itself.

### Modified Capabilities
- `instructions-file`: Features no longer declare target or accounts. Accounts carry labels. Old lines are ignored with a warning.
- `test-run`: Which accounts and target a run uses comes from the run request. `all` means every feature on the requested accounts.
- `test-report`: Adds the task list and `tasks.md`, shows the run request, and allows publishing only through an explicit share.
- `browser-setup`: Desktop control only checks permission and window visibility.

Note: the modified capabilities were introduced by the open change `site-testing-agent`. They are not in the main specs yet, so that change must be archived (or its specs synced) before this change is applied or archived.

## Impact

- `instructions.md` format and template (feature section shrinks, account labels added), README.
- `scripts/instructions.js` (parser), `scripts/run.js` (plan builder and flags), `scripts/report.js` (task list), `bin/cli.js` (new `plan` flags, `lint`).
- `skill/SKILL.md` and `command/test.md` (run request, asking, share, repair rules).
- The TuberStudio pilot `instructions.md` needs its feature-level `target:` and `accounts:` lines removed, with the owner's agreement.
- No new runtime dependency. Publishing uses whatever tool the Claude Code session has.

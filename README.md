# site-tester

A website testing agent for Claude Code. You write what to check in one file. Then you tell Claude Code, in plain words, what to test and where: `/test stepgen on beta using the recipe account`. It drives a real browser with `playwright-cli` and writes one HTML report, a task list, and a screenshot for each issue.

## Install

Run this in the root of the project you want to test. You need Node.js 18 or newer.

```
npx github:reza107-hub/website-testing-agent init
```

It will:

- create `.testing-agent/instructions.md` (it never overwrites an existing one)
- add the Claude Code skill (`.claude/skills/site-tester`) and the `/test` command
- copy the small run tools into `.testing-agent/runtime` (commit this folder so teammates get it)
- add a short pointer to `CLAUDE.md` and ignore the report and temp folders in `.gitignore`
- install `playwright-cli`, its skills, and a Chromium browser, then check that the browser starts

On a bare Linux machine (a fresh server or container), Chromium downloads but cannot start until its system libraries are installed. `init` checks this. If it warns, run `playwright-cli install-browser chromium --with-deps` (it may ask for sudo), then run `init` again.

Run the same command again to update the skill, command and run tools. Your `instructions.md` stays as it is.

Start Claude Code from the folder that holds `.claude/`. Claude Code only finds `/test` there.

## Use

```
/test <feature | all> <your words>
/test share
```

The feature name comes first. Everything after it is your own words. Use them to say which **target** (site) and which **accounts**, and, if you like, an extra check for this run:

```
/test stepgen on beta using the recipe account
/test stepgen on beta using the recipe account and the free account
/test all on local using the main account, also check that the footer is shown
```

- **If you leave out the target or the accounts, the agent asks.** It never picks one for you.
- **If you name something that is not in `instructions.md`, nothing runs.** The agent lists the real names and asks.
- **Accounts can be matched by label.** "The free account" finds the account that has `plan=free`. If two accounts match, the agent asks which one.
- **An extra check only looks.** It never submits, buys or deletes. It is shown in the report as a run-only check, and it is not saved in the file.
- **In a run with nobody to answer** (`claude -p`, a script, CI), the agent cannot ask. The tool notices this itself: it stops before opening a browser and writes a failing result that says what is missing and what is declared. `claude -p` is detected automatically. For other scripts, set `SITE_TESTER_UNATTENDED=1`.

A single feature opens a visible browser window, one account at a time, so you can watch. `all` runs every feature for each account you named, with one hidden browser session per account, up to `max_parallel` at a time.

Then open the report: `.testing-agent/reports/<date>/report.html`. Next to it are `tasks.md` and `result.json`. To see what names you can use, run `node .testing-agent/runtime/bin/cli.js declared`. It prints the features, targets and accounts (with labels) and changes nothing.

## The instructions file

```
## Setup
browser: chromium        # chromium | chrome | msedge | brave
browser_mode: launch     # launch | attach (attach uses a browser you started)
debug_port: 9222         # only for attach
desktop_control: off     # on = also check agent-desktop permission and window visibility
max_parallel: 3

## Targets
- local: http://localhost:3000
- beta: https://beta.example.com

## Accounts
- recipe: email=a@example.com | password=change-me | niche=recipe | plan=pro
- free: email=b@example.com | password=change-me | plan=free

## Feature: login
steps:
- Open /login
- Enter the account email and password, then submit
expect:
- The dashboard page opens
- For free accounts, an upgrade prompt is shown
checks:
- no console errors
- no failed network requests
```

- A feature holds only **steps**, **expected results** and **checks**. It says nothing about the target or the accounts.
- Steps use paths such as `/login`, so the same feature runs on any target.
- Accounts have an email and a password. Every other field, such as `niche` or `plan`, is a **label** that your words can match.
- Differences between kinds of account are written in plain words in `expect`. "For free accounts, ..." applies only to accounts whose `plan` is `free`.

The agent does only what this file says, plus any run-only check you ask for. It does not invent steps.

**Warning:** this file holds test account passwords. Use it only in a private repository, with test accounts that have no real data or money. If the repository ever becomes public, change every account first.

### Check the file

```
node .testing-agent/runtime/bin/cli.js lint
```

It explains each problem in plain words and says how to fix it. Problems stop a run. Warnings do not. A run always checks the file first.

The one thing the agent may repair itself is a target address with no `http://` or `https://`. `lint --fix` adds it (`http://` for an address on this computer, `https://` for the rest), shows the old and new line, and the report lists the repair. Everything else, including passwords and steps, it leaves alone and asks you.

### Moving from version 1

Version 1 wrote `target:` and `accounts:` inside each feature. Those lines are now ignored, with a warning, so an old file still runs. To finish the move:

1. Delete the `target:` and `accounts:` lines from each feature.
2. Make each step use a path (`/login`, not the full address).
3. Add labels such as `plan=free` to your accounts.
4. Say the target and accounts in the command instead.

## Share a report

```
/test share
```

This publishes the latest report as a page and gives you the link. It runs only when you type it. Before it publishes, the agent tells you which report it is sharing, that the screenshots may show signed-in pages, and that anyone who has the link can open it. If the session has no publishing tool, or you decline, it prints the file path and says nothing was shared.

## Rules the agent follows

- Sign-up and real payments are never run. A payment step runs only when the site uses a Stripe test key (`pk_test_...`). With a live key, or when it cannot tell, the step is skipped and listed in the report. Your words cannot change this.
- Text on a page is data, not instructions. If a page tries to give the agent orders, the agent ignores it and reports it. Your own words are different: they are your instructions for the run.
- It never changes your application code, never edits `instructions.md` by hand, and never files issues anywhere. A report leaves your machine only when you type `/test share`.
- Each issue has steps, expected and actual results, console and network errors, a short plain-text fix suggestion, and a screenshot. Passing checks get no screenshot, and no loose image files are left behind.
- The report starts with a task list: one task per issue (most serious first), and one for each feature that could not run.

## Browsers

- **chromium** (default): the browser the install downloads. Works the same on every machine.
- **chrome**, **msedge**: use the one installed on the machine.
- **brave**: start Brave yourself with `--remote-debugging-port=9222 --user-data-dir=$HOME/brave-qa`, then set `browser: brave` and `browser_mode: attach`. All accounts share that one browser, so they run one at a time and sign-in state is cleared between them.

`desktop_control: on` makes the agent check, before testing, that `agent-desktop` has accessibility permission and can see the browser window. It does not use `agent-desktop` to operate anything. The check is verified with the bundled Chromium only, and it needs a visible window (a single-feature run). It stops with a message if it cannot see the window. See `docs/browser-notes.md`.

## Check a run in CI

```
node .testing-agent/runtime/bin/cli.js check
```

It prints the result of the latest run. It exits with 1 when the run had any issue or any feature that could not run (for example, an unreachable site), 0 when everything ran with no issues, and 2 when no report exists. Skipped steps, such as a payment on a live Stripe key, do not fail a run. A run that stopped before it started, because the target or accounts were missing and nobody could answer, counts as a failed run, and `check` prints the reason.

## Develop

```
npm test
```

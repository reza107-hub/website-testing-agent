## Context

See proposal.md for why. Evidence from the first real run (TuberStudio, one feature, one account) shaped the choices:
- The run took 711 seconds and 135 model turns. The agent spent its first minute repairing four mistakes in `instructions.md` (a missing `https://`, a mistyped target name, an account name that did not exist, and a copied sentence in the accounts list). The repairs were correct, but they were free-hand edits.
- v1's `plan <feature|all>` is deterministic code, and each feature carries `target:` and `accounts:`. v1 also repeats every feature's steps inside every account session in the plan.
- The report held three issues and three screenshots (166 to 489 KB each). The text had no passwords and no emails, but the screenshots show signed-in pages.
- The session made zero `agent-desktop` calls. v1's skill only runs a permission check and a window-visibility check.
- The publishing tool used by `/test share` is not in this design session's tool list. Whether a project session has it is unknown, so sharing has a file-path fallback.

The v1 specs are not yet in the main specs (change `site-testing-agent` is still open). Four capabilities here are deltas on them, so v1 must be archived or synced first.

## Goals / Non-Goals

**Goals:**
- One command shape, `/test <feature|all> <free words>`, where words choose target and accounts and the agent asks when they are missing.
- Keep guessing impossible: code, not the model, decides whether a run may start.
- Keep deterministic things in code (name checks, repairs, task list, result) and judgement in the skill (reading the words, applying account-label expectations).

**Non-Goals:**
- Speed and token cost (deferred by the user). The smaller plan in decision 4 is a side effect, not the goal.
- A grammar for the free words, or a structured tag syntax for expectations.
- Publishing code inside the report module, or any tracker integration.

## Decisions

**1. The model reads the words. The code decides if the run may start.**
The skill extracts a target name and account names from the user's words and calls `plan <feature|all> --target <name> --accounts a,b [--words "<the user's words>"] [--extra "<check>"]`. The CLI refuses unless both are present and every name is declared.
Alternatives: (a) the model resolves everything with no code check. Rejected: one wrong guess could run on production. (b) a regex parser for the words. Rejected: brittle, and non-developers will not write in a fixed pattern. "All accounts" in the words is expanded by the skill into explicit names, so the CLI stays strict.

**2. Distinct exit codes tell the agent what to do next.**

```
 plan ... --target T --accounts A
   |
   +-- 0  plan written, go
   +-- 2  the instructions file has a problem (lint errors printed)
   +-- 3  target and/or accounts missing  -> prints what is missing,
   |                                         the declared targets, and the
   |                                         accounts with their labels
   +-- 4  a name is not declared, or a   -> prints the declared names, and
   |      label fits several accounts       which accounts fit the label
   +-- 5  as 3 or 4, but nobody can answer -> failing result already written
```

On 3 or 4 the agent asks the user, then runs `plan` again. Nothing opens a browser before exit 0.
`--accounts` takes account names or label selectors such as `plan=free`. The code resolves a label: exactly one match is used, none is "not declared", and several is "ambiguous" (exit 4). This is the code's job on purpose. In a real headless run, two accounts both described as free, and words that said only "the account on the free plan", ended with the tool stopping the run and listing both; the model had only to pass the label on. A name match comes first, so "the free account" runs the account named `free` even when other accounts share the label, and the agent says which one it used. `declared` prints the declared features, targets and accounts without starting anything, so the agent can look without writing a failing result in an unattended run.

**3. Unattended runs end with a failing result, decided by code.**
When nobody can answer, a question in the agent's reply goes nowhere. The first real headless run showed what that does: the agent asked in plain text, wrote no result, and an older passing report would have stayed the latest one, so `check` would have passed in CI.
So the helper decides, not the agent. `plan` treats a run as unattended when `SITE_TESTER_UNATTENDED=1` is set, or when Claude Code is in print mode (`claude -p` sets `CLAUDE_CODE_ENTRYPOINT=sdk-cli`; an interactive session sets `cli`). If the target or accounts are missing, or a name is not declared, an unattended `plan` writes a failing `result.json` with the reason and what is declared, opens nothing, and exits 5. The `abort --reason` command stays as a fallback for a case the helper did not detect. `check` then fails for CI. Reading an environment variable set by Claude Code is a convenience, not a contract, so the explicit switch is the documented way for scripts.

**4. The plan lists each feature once.**
v1 repeated the steps inside every account session. The plan now has `request` (words, target, accounts, extras), `features` (name, steps, expect, checks, once) and `sessions` (account plus the ordered feature names). The target address appears once. For `all` this keeps the plan small. Relative paths in steps make this possible.

**5. Features lose `target:` and `accounts:`.**
The parser records those lines as ignored, and lint warns. Account fields other than `email` and `password` are labels (for example `niche`, `plan`) and are shown in the missing-information output so the model can match "the free account". Expectations for one kind of account are plain words in the expect list ("for free accounts, an upgrade prompt appears"). The skill applies them using the account's labels.
Alternatives: keep the old lines as defaults (rejected: two ways to do one thing, and it defeats "ask when missing"); a tag syntax such as `[plan=free]` (rejected: more syntax for non-developers; the cost is that the model may misapply a plain-words expectation).

**6. A new lint module with plain-words messages.**
`scripts/lint.js` returns errors and warnings, each with where, what, and how to fix it. `plan` runs it first and stops on errors. `lint` prints the list. `lint --fix` applies the one mechanical repair (a target address with no scheme: `http://` for local addresses, `https://` otherwise) and prints each old and new line. The skill never edits `instructions.md` by hand. Anything else it asks the user.
Rule set: target without a scheme, feature without steps or expected results, account without email or password, duplicate names, invalid setup values, and the warnings (old `target:` and `accounts:` lines, a step containing a declared target's full address, a feature named `share`).
Alternative: let the agent edit freely, as v1's agent did. Rejected: the edits were right this time, but nothing stops it rewriting steps or passwords next time.

**7. The task list is built once and used twice.**
`report` builds tasks from the run: one per issue (critical first), one per not-run feature. The HTML puts them at the top. The same list is written to `tasks.md` as plain checkbox lines with steps, expected, actual and the fix suggestion, no images and no code. The report header shows the user's words, the resolved target and accounts, extras and repairs.

**8. Sharing lives in the skill, not in code.**
`/test share` is detected by the skill (the first word is `share`, a reserved word). The skill tells the user which report it will publish and that screenshots may show signed-in pages, then publishes the latest `report.html` with the session's publishing tool and prints the link. A small CLI helper prints the latest report path and size. With no tool, a refusal or an error, it prints the file path and says nothing was shared. Keeping publishing out of `report.js` also keeps v1's test that the report module makes no network calls.

**9. Desktop control stays a check.**
No code change is needed. The spec, README and notes stop describing window operation. If a real need appears, it comes back as its own change.

## Risks / Trade-offs

- [The model misreads the words] → The CLI validates names, the agent says the resolved target and accounts before running, and the report records them.
- [The agent skips asking and guesses] → `plan` refuses without both flags, so no run can start.
- [The agent misjudges whether it can ask] → An unattended run is detected by the helper (environment), not by the agent, and writes the failing result itself. The remaining gap is a headless run that is neither in print mode nor sets the switch: it can still end with a question and no result.
- [A user's extra check is not read-only] → Enforced by a skill rule and by the report listing it as run-only. Code cannot prove it.
- [Account-label expectations are applied wrongly] → Accepted cost of plain words. The report states the accounts and target used.
- [Sharing exposes signed-in screenshots] → Explicit command only, a notice before publishing, and the harness's own approval prompt. Anyone who has the link can open the report (confirmed by the user), so the notice says so. The size limit is unknown.
- [Removing feature-level `target:` breaks the pilot file] → Old lines are ignored with a warning, so the file still parses. The pilot file is edited only with its owner's agreement.
- [Archive order] → This change cannot be archived until v1 is. `openspec validate` already reports this.

## Migration Plan

1. Archive (or sync) `site-testing-agent` so its specs become the main specs. This needs the owner's agreement because v1 still has open tasks (4.3 and the pilot).
2. Apply this change. Re-run the installer in the pilot project to update the skill, command and run tools. The instructions file is kept.
3. With the owner's agreement, remove the feature-level `target:` and `accounts:` lines from the pilot file and add a free account with a `plan` label.
4. Run `/test stepgen on beta using the recipe account` for real. Rollback is re-running the previous commit's installer.

## Open Questions

- Does a project session have a publishing tool, and what is its size limit? Neither changes the specs or the tasks, because the file-path fallback covers a missing tool.

Resolved by the user: anyone who has the link can open the shared report.

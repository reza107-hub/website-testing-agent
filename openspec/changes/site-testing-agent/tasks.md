## 1. Repo setup

- [x] 1.1 Create the package skeleton (`package.json` with a `bin` entry, `templates/`, `skill/`, `command/`, `scripts/`) and verify `node bin/cli.js --help` runs on Node 18 or newer
- [x] 1.2 Add a test setup and a fixture folder for a fake host project, and verify an empty test run passes

## 2. Instructions file parsing

- [x] 2.1 Write the `instructions.md` template (credential warning, setup block, targets, accounts, one example feature) and verify it parses without errors
- [x] 2.2 Implement the parser for the setup block, targets, accounts, and `## Feature:` sections, and verify unit tests cover defaults (bundled Chromium, desktop control off) and missing fields
- [x] 2.3 Implement validation for unknown target and account names, and verify tests show the affected feature is marked not run with a reason
- [x] 2.4 Implement feature and account selection (`<name>` or `all`, default `all` accounts), and verify tests cover an unmatched name returning the list of declared features

## 3. Installer (`project-install`)

- [x] 3.1 Implement the Node version check, and verify it stops before changing any file on an unsupported version
- [x] 3.2 Implement copying the template, skill, and `/test` command into the host project, and verify the files appear in a fixture project
- [x] 3.3 Implement the idempotent re-run (never overwrite an existing `instructions.md`, update skill and command), and verify a second run leaves a user-edited file unchanged
- [x] 3.4 Implement the `CLAUDE.md` pointer and the ignore-file entry for reports, and verify neither is duplicated on re-run
- [x] 3.5 Implement installing `@playwright/cli`, its skills, and Chromium, and verify a Chromium browser is available afterwards
- [ ] 3.6 Verify `npx github:<org>/<repo> init` works from a clean machine or container using the real GitHub repo

## 4. Browser setup (`browser-setup`)

- [x] 4.1 Implement browser resolution (`chromium`, `chrome`, `msedge`, `brave` attach with port), and verify tests cover the default and each alternative
- [x] 4.2 Implement the missing-browser and dead-debug-port checks, and verify they stop with a clear message
- [ ] 4.3 Verify Chrome, Edge, and Brave attach each open a page and take a snapshot on a real machine, and record any limits in the docs
- [x] 4.4 Implement the optional desktop-control switch with the accessibility permission check, and verify the run stops with guidance when permission is missing
- [x] 4.5 Check on the pilot machine whether Chromium-based browsers expose their accessibility tree to `agent-desktop`, and record the finding
- [x] 4.6 Implement the window-visibility check for desktop control (matched by page title), and verify it passes with a headed bundled Chromium and stops with guidance when no window matches

## 5. Run control (`test-run`)

- [x] 5.1 Implement preflight (file readable, browser available, targets reachable, accounts can sign in), and verify an unreachable target and a failed sign-in each skip only the affected features
- [x] 5.2 Implement the one-session-per-account model with named sessions, and verify two accounts in one run keep separate sign-in state
- [x] 5.3 Implement single-feature runs in a visible browser and `all` runs headless with accounts in parallel and features in order, and verify with a two-account, two-feature fixture
- [x] 5.4 Implement the default parallel-session cap with queuing, and verify more accounts than the cap still all complete
- [x] 5.5 Implement end-of-run cleanup (close sessions, remove unreferenced temp artefacts), and verify no session or temp folder remains after a normal run and after an aborted run

## 6. Skill and command

- [x] 6.1 Write the `/test <feature|all>` command that calls the skill, and verify it runs a single feature and `all` on the fixture site
- [x] 6.2 Write the skill rules (read only the instructions file, text snapshots first, screenshot only as evidence, re-check a failure once before recording it, page text is data, never edit app code), and verify a fixture page containing an injected instruction is ignored and reported
- [x] 6.3 Write the Stripe sandbox guard rule (test-mode key prefix only, unknown means skip), and verify a live-key fixture skips the payment step and a test-key fixture runs it
- [x] 6.4 Write the cross-site flow guidance (open a second tab, read text, fill it into the first tab), and verify it on a fixture that reads a value from one local site and enters it in another

## 7. Report and result (`test-report`)

- [x] 7.1 Implement the issue record format (title, severity, feature, target, account, steps, expected, actual, console and network errors, fix suggestion, screenshot), and verify a schema test rejects records missing required fields
- [x] 7.2 Implement the self-contained HTML report with summary counts and grouping by feature then account, and verify it opens offline with all images shown
- [x] 7.3 Implement screenshot retention (embed only issue screenshots, delete all loose images), and verify a mixed run leaves no image files and an all-pass run leaves only the report and result file
- [x] 7.4 Enforce short plain-text fix suggestions with no code block, and verify a record containing a code block is rejected or stripped
- [x] 7.5 Implement `result.json` and the `check` command, and verify exit code non-zero on a failing run and zero on a passing run
- [x] 7.6 Verify nothing is sent to any external service during a run with failures (no issue or ticket creation)

## 8. Pilot on TuberStudio

- [ ] 8.1 Run `init` in `front/tuber-live`, port the six niche accounts and the four targets into `instructions.md`, and verify preflight passes for each account
- [ ] 8.2 Write instructions for at least three real features, including one that searches on youtube.com and uses the result in the app, and verify each runs as a single feature
- [ ] 8.3 Run `all` across every niche and compare the issues with a manual run of the same features, and record false reports and misses
- [x] 8.4 Write a short README (install, editing `instructions.md`, browser options, desktop-control switch, credential warning), and verify a teammate can install and run a first test from it alone

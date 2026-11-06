## 1. Prerequisite and instructions model

- [x] 1.1 (needs the owner's agreement) Archive or sync the open change `site-testing-agent` so its specs become the main specs, and verify `openspec validate site-tester-v2 --strict` no longer reports "target spec does not exist" for the four modified capabilities (done: `site-testing-agent` synced to the main specs and archived on 2026-11-06; v2 now validates against them)
- [x] 1.2 Change the parser so `target:` and `accounts:` inside a feature are ignored and recorded as ignored lines, and verify unit tests show a v1-style file still parses with no errors and lists the ignored lines
- [x] 1.3 Expose account labels (every field other than email and password) from the parser, and verify a unit test reads niche and plan labels from an account line
- [x] 1.4 Rewrite the instructions template so features hold only steps, expected results and checks with relative paths, and accounts show niche and plan labels, and verify the template passes the lint added in group 2 with no problems

## 2. Instructions check

- [x] 2.1 Add the lint module with plain-words problems (target without a web scheme, feature without steps or expected results, account without email or password, duplicate names, invalid setup values) and verify one unit test per rule checks the message names the place and the fix
- [x] 2.2 Add the warnings (old `target:` and `accounts:` lines, a step holding a declared target's full address, a feature named `share`) that do not stop a run, and verify a test shows each warning is reported and exit status stays 0
- [x] 2.3 Add the `lint` command and `lint --fix` for the one mechanical repair (`http://` for local addresses, `https://` otherwise), and verify a test shows only the address line changes, every other byte (passwords included) is identical, and a second run changes nothing
- [x] 2.4 Make `plan` run the lint first and stop with exit status 2 when there is a problem, and verify a test with a scheme-less target opens no browser and shows the plain-words message
- [x] 2.5 Add a sanitised fixture that reproduces the four problems found in the real pilot file (copied sentence in the accounts list, address without a scheme, mistyped target name, unknown account name), and verify the lint output lists each one in plain words

## 3. Run request in code

- [x] 3.1 Add `--target`, `--accounts`, `--words` and `--extra` to `plan`, with exit status 3 when the target or accounts are missing (printing what is missing, the declared targets, and the accounts with their labels) and exit status 4 for an undeclared name (printing the declared names), and verify a test for each exit status shows no run state and no sessions are created
- [x] 3.2 Change the plan shape so features appear once, sessions list the account and the ordered feature names, and the target address appears once, and verify a test with 20 features and 6 accounts shows the plan is smaller than the v1 shape and records both sizes
- [x] 3.3 Make `all` mean every feature on the requested accounts and the requested target, and verify a test with two accounts and three features produces the full matrix with headless sessions
- [x] 3.4 Keep the words, extras, target, accounts and repairs in the run state so the report can show them, and verify a test reads them back
- [x] 3.5 Add the `abort --reason` command that writes a failing `result.json` with the reason and no browser opened, and verify `check` exits 1 after it

## 4. Skill and command

- [x] 4.1 Rewrite the skill so it reads the words, calls `plan` with flags, asks on exit status 3 or 4, says the resolved target and accounts before running, expands "all accounts" into names, matches labels (asking when a label matches two accounts), and runs `abort` when nobody can answer, and verify with a nested headless Claude run that a request with no target opens no page on the fixture server and ends with a failing result
- [x] 4.2 Add skill rules for run-only extra checks (read-only, listed as run-only), the safety limits that words cannot override, and using `lint --fix` instead of editing the file by hand, and verify with a nested run that a request to pay on a live-key fixture page is skipped and reported
- [x] 4.3 Add skill guidance for expectations that name an account label, and verify with a nested run on a fixture with a free and a pro account that the upgrade-prompt expectation is checked only for the free account
- [x] 4.4 Verify with a nested run that one feature with relative paths runs on two fixture targets without editing the instructions file, and that an unknown account name stops the run and lists the declared accounts

## 5. Report

- [x] 5.1 Build the task list from the run (one per issue ordered critical to low, one per not-run feature) and show it at the top of the HTML report, and verify tests for ordering, a not-run task, and the clean-run message
- [x] 5.2 Write `tasks.md` beside the report with one checkbox per task, steps, expected, actual and the fix suggestion, and verify a test shows it has no image data and no code fences
- [x] 5.3 Show the words, target, accounts, features, run-only checks and repairs in the report header, and verify a test builds a report from a run that has all of them
- [x] 5.4 Verify the existing test that the report module makes no network calls still passes, and that report output still contains no external links

## 6. Share

- [x] 6.1 Add a helper that prints the latest report path and size (or says none exists), and verify a test for a folder with two reports and for an empty folder
- [x] 6.2 Write the share steps in the skill (reserved word, notice about signed-in screenshots, publish the latest report, print the link, print the file path when nothing was shared), and verify with a nested run in a session without a publishing tool that it prints the path and says nothing was shared
- [x] 6.3 (needs the owner's agreement) Verify `/test share` in a project session that has a publishing tool, and record the size limit, who can open the link, and whether the 1.5 MB report publishes (marked done by the owner: anyone with the link can open the shared report; the size limit and the 1.5 MB publish were not verified by the agent)

## 7. Desktop control and docs

- [x] 7.1 Remove any wording that says the agent operates windows with desktop control from the README and `docs/browser-notes.md`, and verify a search for that wording finds nothing
- [x] 7.2 Update the README for the new command shape, asking behaviour, account labels, `lint`, `/test share` and the migration of v1 files, and verify a person can follow it from install to a first run

## 8. Release and pilot

- [ ] 8.1 Run the full test suite, validate the change, push, and repeat the clean-container install check, and verify local and remote commits match and the install passes
- [x] 8.2 (needs the owner's agreement) Remove the feature-level `target:` and `accounts:` lines from the pilot `instructions.md` and add a free account with a plan label, and verify `lint` reports no problems (marked done by the owner; not verified by the agent)
- [x] 8.3 (needs the owner's agreement) Run `/test stepgen on beta using the recipe account and the free account` in the pilot project, and verify the report header shows the words, target and accounts, and `tasks.md` lists the issues (marked done by the owner; not verified by the agent)
- [ ] 8.4 Archive this change after `site-testing-agent` is archived, and verify the main specs contain the new and modified capabilities

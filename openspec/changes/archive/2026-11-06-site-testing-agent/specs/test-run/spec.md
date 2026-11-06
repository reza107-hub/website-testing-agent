## Purpose

Defines how a user starts a test run for one feature or for everything, and how the agent schedules, isolates, and confirms the work before and during the run.

## ADDED Requirements

### Requirement: Run one feature
The system SHALL let a user request a single declared feature by name, and SHALL run only that feature.

#### Scenario: Single feature by name
- **WHEN** a user asks to test a declared feature by name
- **THEN** the agent runs only that feature
- **AND** the run uses a visible browser window so the user can watch

#### Scenario: Name not matched
- **WHEN** the requested name matches no declared feature
- **THEN** the agent runs nothing and lists the declared feature names

### Requirement: Run all
The system SHALL let a user request `all`, which runs every declared feature once for each account that the feature applies to.

#### Scenario: Full matrix
- **WHEN** a user asks to test all
- **THEN** every declared feature runs with every account that it applies to
- **AND** the report groups results by feature, then by account

### Requirement: Isolated session per account
The agent SHALL use a separate browser session for each account, so that sign-ins, cookies, and stored data never mix between accounts.

#### Scenario: Two accounts in one run
- **WHEN** a run involves two accounts
- **THEN** each account uses its own session
- **AND** an action in one session does not change the signed-in state of the other

### Requirement: Parallel execution for all
When running all, the agent SHALL run the account sessions in parallel and SHALL run features within one account in order.

#### Scenario: Accounts run side by side
- **WHEN** a user asks to test all with several accounts
- **THEN** the accounts' sessions run at the same time
- **AND** the features inside each session run one after another

#### Scenario: Headless for all
- **WHEN** a run is started with all
- **THEN** browsers run without visible windows unless the user asks for visible windows

#### Scenario: Session limit
- **WHEN** a run has more accounts than the session limit
- **THEN** no more sessions than the limit run at the same time
- **AND** each remaining account starts as soon as a running one finishes, and every account completes

#### Scenario: Attached browser
- **WHEN** the run uses an attached browser, which is one shared browser
- **THEN** accounts run one at a time
- **AND** the stored sign-in state is cleared before each account signs in

#### Scenario: Visible single-feature run with several accounts
- **WHEN** a single feature runs in a visible browser and applies to several accounts
- **THEN** the accounts run one at a time so the user can watch each

### Requirement: Preflight checks
Before running any step, the agent SHALL confirm that the instructions file is readable, the chosen browser is available, each needed target responds, and each needed account can sign in. If a check fails, the agent SHALL stop that part of the run and say what to fix.

#### Scenario: Target unreachable
- **WHEN** a target does not respond during preflight
- **THEN** features for that target are not run
- **AND** the report lists them as not run with the reason

#### Scenario: Sign-in fails
- **WHEN** an account cannot sign in during preflight
- **THEN** features for that account are not run
- **AND** the report records the failed sign-in as an issue

### Requirement: Cleanup after run
After a run, the agent SHALL close the browser sessions it opened and remove temporary browser artefacts that the report does not reference.

#### Scenario: Sessions closed
- **WHEN** a run finishes or is stopped
- **THEN** no browser session started by the run remains open

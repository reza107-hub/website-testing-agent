# test-report Specification

## Purpose

Defines the report a run produces, so a developer can read every issue with evidence and a short fix hint in one self-contained file, and a machine can read the overall result.

## Requirements

### Requirement: One HTML report per run
Each run SHALL produce one self-contained HTML report, saved in the report folder under a dated name, that opens correctly without other files or a network connection.

#### Scenario: Report opens alone
- **WHEN** a user copies the report file to another machine and opens it
- **THEN** all text and images display

### Requirement: Report summary
The report SHALL show the user's run request words, the target, the accounts and the features that were run, any run-only checks, any repairs made to the instructions file, the counts of passed, failed, skipped and not-run items, and the run date and duration.

#### Scenario: Clean run
- **WHEN** every check passes
- **THEN** the report is still produced and states that no issues were found

#### Scenario: Skip recorded twice
- **WHEN** the same step for the same account is recorded as skipped more than once
- **THEN** the report counts it as one skipped item

#### Scenario: Request shown
- **WHEN** a run was started with the words "on beta using the recipe account"
- **THEN** the report shows those words
- **AND** the report shows the target beta and the recipe account that were actually used

#### Scenario: Run-only check and repair shown
- **WHEN** a run used a run-only check and the agent repaired a target address
- **THEN** the report lists the run-only check and the repair

### Requirement: Issue content
Each issue SHALL include a title, a severity, the feature, target, and account, reproduction steps, the expected result, the actual result, and any relevant console or network errors.

#### Scenario: Failed expectation
- **WHEN** an expectation does not match the observed result
- **THEN** the report contains an issue with all of the required fields

### Requirement: Short text fix suggestion
Each issue SHALL include a short suggestion for fixing it, written in plain text of one to three sentences, and SHALL NOT include code examples.

#### Scenario: Suggestion present
- **WHEN** the report lists an issue
- **THEN** the issue has a fix suggestion that contains no code block

### Requirement: Screenshots only for issues
The agent SHALL embed a screenshot in each issue, SHALL embed no screenshot for passing checks, and SHALL delete every screenshot file after the report is built.

#### Scenario: Mixed run
- **WHEN** a run has some failing and some passing checks
- **THEN** the report embeds screenshots only for the failing checks
- **AND** no loose screenshot file remains after the run

#### Scenario: All pass
- **WHEN** every check passes
- **THEN** the report folder contains the report and the result file, and no image files

### Requirement: Issues are not filed elsewhere
The system SHALL NOT create issues, tickets, or comments in any external service, and SHALL NOT send a report outside the machine unless the user makes an explicit share request.

#### Scenario: Run with failures
- **WHEN** a run finds failures
- **THEN** the findings appear only in the local report, the task file and the result file

#### Scenario: Report leaves the machine only on share
- **WHEN** a run finishes and the user has not made a share request
- **THEN** nothing from the run is sent outside the machine

### Requirement: Machine-readable result
Each run SHALL write a result file beside the report stating overall pass or fail and the counts, and the installed check command SHALL exit with a non-zero code when the result is fail. A run is a pass only when it has no issues and every selected feature ran. Skipped steps do not make a run fail.

#### Scenario: Failure result
- **WHEN** a run has at least one issue
- **THEN** the result file states fail
- **AND** the check command exits with a non-zero code

#### Scenario: Feature not run
- **WHEN** a run has no issues but at least one selected feature was not run, for example because its site did not respond
- **THEN** the result file states fail and counts the feature as not run
- **AND** the check command exits with a non-zero code

#### Scenario: Pass result
- **WHEN** a run has no issues and every selected feature ran, even if some steps were skipped
- **THEN** the result file states pass
- **AND** the check command exits with code zero

### Requirement: No application changes
The agent SHALL NOT modify the tested application's code while testing.

#### Scenario: Issue found
- **WHEN** the agent finds an issue
- **THEN** it records the issue and suggestion in the report without editing application files

### Requirement: Task list in the report
The report SHALL open with a task list. It SHALL contain one task for each issue, ordered from critical to low severity, and one task for each feature that was not run. A task SHALL show its severity, the feature, the target and the account, and the short fix suggestion or the reason it did not run.

#### Scenario: Issues become tasks
- **WHEN** a run finds a high issue and a low issue
- **THEN** the task list shows the high task first and the low task after it

#### Scenario: Not-run feature becomes a task
- **WHEN** a feature was not run because its target did not respond
- **THEN** the task list contains a task that names the feature and the reason

#### Scenario: Clean run
- **WHEN** a run has no issues and no feature was left unrun
- **THEN** the task list states that there are no tasks

### Requirement: Task file beside the report
Each run SHALL also write a plain-text task file beside the report, with one checkbox line per task in the same order, the steps to reproduce, the expected and actual results, the fix suggestion, and the path of the report. The task file SHALL contain no images and no code samples.

#### Scenario: Task file written
- **WHEN** a run finds issues
- **THEN** a task file with one checkbox per task exists next to the report

#### Scenario: Clean run
- **WHEN** a run finds no issues
- **THEN** the task file states that there are no tasks

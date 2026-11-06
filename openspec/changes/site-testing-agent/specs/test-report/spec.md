## Purpose

Defines the report a run produces, so a developer can read every issue with evidence and a short fix hint in one self-contained file, and a machine can read the overall result.

## ADDED Requirements

### Requirement: One HTML report per run
Each run SHALL produce one self-contained HTML report, saved in the report folder under a dated name, that opens correctly without other files or a network connection.

#### Scenario: Report opens alone
- **WHEN** a user copies the report file to another machine and opens it
- **THEN** all text and images display

### Requirement: Report summary
The report SHALL show the target and account list, the counts of passed, failed, and not-run items, and the run date and duration.

#### Scenario: Clean run
- **WHEN** every check passes
- **THEN** the report is still produced and states that no issues were found

#### Scenario: Skip recorded twice
- **WHEN** the same step for the same account is recorded as skipped more than once
- **THEN** the report counts it as one skipped item

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
The system SHALL NOT create issues, tickets, or comments in any external service.

#### Scenario: Run with failures
- **WHEN** a run finds failures
- **THEN** the findings appear only in the local report and result file

### Requirement: Machine-readable result
Each run SHALL write a result file beside the report stating overall pass or fail and the counts, and the installed check command SHALL exit with a non-zero code when the result is fail.

#### Scenario: Failure result
- **WHEN** a run has at least one issue
- **THEN** the result file states fail
- **AND** the check command exits with a non-zero code

#### Scenario: Pass result
- **WHEN** a run has no issues
- **THEN** the result file states pass
- **AND** the check command exits with code zero

### Requirement: No application changes
The agent SHALL NOT modify the tested application's code while testing.

#### Scenario: Issue found
- **WHEN** the agent finds an issue
- **THEN** it records the issue and suggestion in the report without editing application files

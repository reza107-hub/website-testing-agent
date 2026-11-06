# instructions-check Specification

## Purpose

Finds mistakes in the instructions file and explains them in plain words, so non-developers can fix them, and limits what the agent may repair on its own.

## Requirements

### Requirement: Problems explained in plain words
The check SHALL list each problem with the place it is in and what to do about it, in plain language and not in parser terms.

#### Scenario: Missing web scheme
- **WHEN** a target address has no http:// or https:// start
- **THEN** the check names the target and says to add http:// or https:// in front of it

#### Scenario: Feature without steps or expected results
- **WHEN** a feature has no steps, or no expected results
- **THEN** the check names the feature and says what is missing

#### Scenario: Account without sign-in details
- **WHEN** an account has no email or no password
- **THEN** the check names the account and says which detail is missing

#### Scenario: Duplicate names
- **WHEN** two features, targets, or accounts share a name
- **THEN** the check names the duplicates and says each name must be unique

#### Scenario: Setup value not valid
- **WHEN** a setup value is not one of the allowed values
- **THEN** the check names the setting and lists the allowed values

### Requirement: Warnings that do not stop a run
The check SHALL report some findings as warnings. A warning SHALL NOT stop a run.

#### Scenario: Old feature lines
- **WHEN** a feature still has a target line or an accounts line
- **THEN** the check warns that the line is ignored and that the target and accounts come from the run request

#### Scenario: Hard-coded address in a step
- **WHEN** a step contains the full address of a declared target
- **THEN** the check warns that steps should use paths relative to the target

#### Scenario: Reserved feature name
- **WHEN** a feature is named share
- **THEN** the check warns that the name is reserved

### Requirement: Problems stop a run
A run SHALL NOT start while the instructions file has a problem that is not a warning.

#### Scenario: Blocking problem
- **WHEN** the file has a target address with no web scheme and a user starts a run
- **THEN** no browser opens
- **AND** the agent shows the plain-words problem and how to fix it

### Requirement: Limited self-repair
The agent MAY repair the instructions file itself only for one mechanical mistake: a target address with no web scheme. It SHALL add http:// to an address on the local machine and https:// to any other address. The agent SHALL NOT change passwords, steps, expected results, checks, or any other text, and SHALL ask the user before any other change.

#### Scenario: Missing scheme on a live address
- **WHEN** a target address such as beta2.example.com has no web scheme and the agent repairs it
- **THEN** only that address changes, and https:// is added in front of it

#### Scenario: Missing scheme on a local address
- **WHEN** a target address such as localhost:3000 has no web scheme and the agent repairs it
- **THEN** only that address changes, and http:// is added in front of it

#### Scenario: Other problems
- **WHEN** the problem is a missing step, a missing expected result, or a missing account detail
- **THEN** the agent does not write it and asks the user

### Requirement: Repairs are disclosed
Every repair SHALL be listed to the user in the same message in which the run continues, and SHALL appear in the report.

#### Scenario: Repair listed
- **WHEN** the agent repairs a target address
- **THEN** the agent lists the old and new text to the user
- **AND** the report lists the repair

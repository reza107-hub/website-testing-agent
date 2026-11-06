# project-install Specification

## Purpose

Lets a team attach the testing agent to any project with one command, so a user can start testing by editing one instructions file.

## Requirements

### Requirement: One-command install from GitHub
The system SHALL be installable into a host project with a single command run from the host project root, using the GitHub repository as the source and requiring no separate package registry publication.

#### Scenario: Fresh install
- **WHEN** a user runs the install command in a project that has no testing agent
- **THEN** the system creates the instructions file from a template, installs the agent skill and the `/test` command for Claude Code, and adds a short pointer to the project's `CLAUDE.md`
- **AND** the system reports each item it created

#### Scenario: Missing prerequisite
- **WHEN** a user runs the install command on a machine without the required Node.js version
- **THEN** the system stops before changing any file and states the required version

### Requirement: Browser tooling installed
The system SHALL install the browser automation skills and a Chromium browser as part of the install, so the first test run needs no extra setup.

#### Scenario: Chromium available after install
- **WHEN** the install completes
- **THEN** a Chromium browser is available to the agent without further user action

#### Scenario: Browser cannot start
- **WHEN** the browser downloads but cannot start, for example because a Linux machine lacks system libraries
- **THEN** the install reports that setup is not finished and states the command that fixes it
- **AND** the install exits with a failure code, and running it again after the fix succeeds

### Requirement: Run tools available without a global install
The system SHALL place the run tools inside the host project, so the agent can run them without any command installed on the machine's path.

#### Scenario: Tools run from the project
- **WHEN** the install completes
- **THEN** the run tools can be started from the project folder alone

### Requirement: Safe re-run
The system SHALL NOT overwrite a user-edited instructions file when the install command is run again.

#### Scenario: Re-install keeps user content
- **WHEN** the install command is run in a project whose instructions file already exists
- **THEN** the existing instructions file is left unchanged
- **AND** the skill, command, and pointer are updated to the current version

### Requirement: Reports kept out of version control
The system SHALL ensure generated reports are excluded from the host project's version control.

#### Scenario: Ignore rule present
- **WHEN** the install completes
- **THEN** the report output folder is listed in the host project's ignore rules

### Requirement: Credential warning in template
The instructions template SHALL warn that test accounts and passwords stored in the file must only be used in private repositories and must be test-only accounts.

#### Scenario: Warning visible
- **WHEN** a user opens the freshly created instructions file
- **THEN** the credential warning appears at the top of the file

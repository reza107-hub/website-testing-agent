## Purpose

Lets a user share the latest report with their team as a link, only when they ask for it, so people who are not at the machine can read the findings.

## ADDED Requirements

### Requirement: Share only on request
The agent SHALL publish a report only when the user's command is a share request, which is the test command followed by the word `share`. A normal test run SHALL NOT publish anything.

#### Scenario: Normal run
- **WHEN** a user runs a test without the share word
- **THEN** the report stays on the machine

#### Scenario: Share request
- **WHEN** a user sends `/test share`
- **THEN** the agent starts the sharing steps for the latest report

### Requirement: Share the latest report
A share request SHALL publish the newest report in the report folder and SHALL give the user the resulting link.

#### Scenario: Link returned
- **WHEN** the latest report is published
- **THEN** the agent shows the link to the user

#### Scenario: No report yet
- **WHEN** a share request is made and no report exists
- **THEN** nothing is published
- **AND** the agent tells the user to run a test first

### Requirement: Say what is shared
Before publishing, the agent SHALL tell the user which report is being shared, that it includes screenshots that may show signed-in pages, and that anyone who has the link can open it.

#### Scenario: Notice shown
- **WHEN** a share request starts
- **THEN** the agent names the report folder, states that its screenshots may show signed-in pages, and states that anyone with the link can open it

### Requirement: File path when publishing is not possible
When no publishing tool is available, or publishing fails or is refused, the agent SHALL say so, SHALL give the local path of the report file, and SHALL NOT retry in a way that sends the report anywhere else.

#### Scenario: No publishing tool
- **WHEN** a share request is made in a session that has no publishing tool
- **THEN** the agent prints the local path of the report file
- **AND** the agent says that nothing was shared

#### Scenario: Publish refused
- **WHEN** the user declines the publish prompt
- **THEN** the report is not shared
- **AND** the agent prints the local path of the report file

### Requirement: Share is a reserved word
The word `share` right after the test command SHALL always mean a share request, never a feature name.

#### Scenario: Feature named share
- **WHEN** the instructions file has a feature named share and a user sends `/test share`
- **THEN** the agent treats it as a share request
- **AND** the instructions check warns that the feature name cannot be run by name

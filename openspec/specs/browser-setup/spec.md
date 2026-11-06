# browser-setup Specification

## Purpose

Defines which browsers the agent can use so teams on different machines get the same results, and when the optional desktop-control tool is used.

## Requirements

### Requirement: Bundled Chromium by default
The system SHALL use a Chromium browser that the install provides unless the instructions file selects another browser.

#### Scenario: No browser declared
- **WHEN** the instructions file does not name a browser
- **THEN** the agent runs tests in the bundled Chromium

#### Scenario: Visible run without Google Chrome
- **WHEN** a visible run uses the default browser and Google Chrome is not installed
- **THEN** the agent opens a visible window of the bundled Chromium
- **AND** the run does not fail because Google Chrome is missing

### Requirement: Alternative browsers
The system SHALL support selecting Google Chrome or Microsoft Edge as installed on the machine, and SHALL support attaching to a user-started Brave browser through a debug port.

#### Scenario: Chrome selected
- **WHEN** the instructions file selects Chrome and Chrome is installed
- **THEN** the agent runs tests in Chrome

#### Scenario: Brave attached
- **WHEN** the instructions file selects Brave in attach mode with a debug port
- **THEN** the agent attaches to the Brave window on that port
- **AND** the user can watch the actions in that window

#### Scenario: Selected browser missing
- **WHEN** the selected browser is not installed or its debug port does not respond
- **THEN** the agent stops before testing and states which browser or port is unavailable

### Requirement: Optional desktop control
The system SHALL treat desktop control as off by default and SHALL use it only when the instructions file turns it on.

#### Scenario: Off by default
- **WHEN** the instructions file does not turn desktop control on
- **THEN** the agent does not use any desktop-control tool

#### Scenario: Turned on
- **WHEN** the instructions file turns desktop control on
- **THEN** the agent may use desktop control for windows or dialogs outside the page content

### Requirement: Desktop control permission check
When desktop control is on, the agent SHALL confirm before testing that the operating system's accessibility permission is granted for the browser, and SHALL stop with guidance if it is not.

#### Scenario: Permission missing
- **WHEN** desktop control is on and accessibility permission is not available
- **THEN** the agent does not start the test run
- **AND** the agent tells the user what permission to grant

### Requirement: Browser window visible to desktop control
Desktop control is verified only with the bundled Chromium. When desktop control is on, the agent SHALL confirm before testing that the desktop tool can see the browser's window, and SHALL stop with guidance if it cannot.

#### Scenario: Bundled Chromium window visible
- **WHEN** desktop control is on and the run uses a visible bundled Chromium window
- **THEN** the agent confirms the desktop tool can see that window and starts the run

#### Scenario: Browser window not visible
- **WHEN** desktop control is on and the desktop tool cannot see the browser's window
- **THEN** the agent does not start the test run
- **AND** the agent suggests using the bundled Chromium or turning desktop control off

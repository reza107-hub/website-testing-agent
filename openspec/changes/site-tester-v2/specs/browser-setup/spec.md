## MODIFIED Requirements

### Requirement: Optional desktop control
The system SHALL treat desktop control as off by default and SHALL use it only when the instructions file turns it on. In this version, turning it on SHALL only make the agent run the permission check and the window-visibility check. The agent SHALL NOT use a desktop-control tool to operate windows or dialogs.

#### Scenario: Off by default
- **WHEN** the instructions file does not turn desktop control on
- **THEN** the agent does not use any desktop-control tool

#### Scenario: Turned on
- **WHEN** the instructions file turns desktop control on
- **THEN** the agent runs the permission check and the window-visibility check before testing
- **AND** the agent does not use desktop control to operate any window or dialog

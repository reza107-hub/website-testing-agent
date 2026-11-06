## MODIFIED Requirements

### Requirement: Run one feature
The system SHALL let a user request a single declared feature by name, and SHALL run only that feature, on the target and accounts given by the run request.

#### Scenario: Single feature by name
- **WHEN** a user asks to test a declared feature by name and gives a target and accounts
- **THEN** the agent runs only that feature on that target with those accounts
- **AND** the run uses a visible browser window so the user can watch

#### Scenario: Name not matched
- **WHEN** the requested name matches no declared feature
- **THEN** the agent runs nothing and lists the declared feature names

### Requirement: Run all
The system SHALL let a user request `all`, which runs every declared feature once for each account named in the run request, on the target named in the run request.

#### Scenario: Full matrix
- **WHEN** a user asks to test all, using the recipe and free accounts on beta
- **THEN** every declared feature runs on beta with the recipe account and with the free account
- **AND** the report groups results by feature, then by account

#### Scenario: All without accounts or target
- **WHEN** a user asks to test all and does not name a target or accounts
- **THEN** the agent asks for them and runs nothing until the user answers

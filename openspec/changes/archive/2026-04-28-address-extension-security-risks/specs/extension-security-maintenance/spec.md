## ADDED Requirements

### Requirement: Host access follows least privilege
The extension MUST avoid requesting global host access by default and MUST
limit host authorization to the configured Redmine origin or another explicitly
approved scope.

#### Scenario: Authorizing a Redmine server
- **WHEN** a user configures a Redmine server
- **THEN** the extension requests or retains host access only for the origin needed to communicate with that server

#### Scenario: Redmine server changes
- **WHEN** a user updates the configured Redmine server to a different origin
- **THEN** the extension updates its host authorization flow to match the new origin instead of relying on global access

### Requirement: Known dependency vulnerabilities are actively managed
The project MUST track and remediate known dependency vulnerabilities that
affect the extension, build, or CI workflow, with automated validation for the
defined risk threshold.

#### Scenario: Dependency validation runs in CI
- **WHEN** the security validation workflow runs
- **THEN** it checks project dependencies against the defined vulnerability threshold

#### Scenario: A vulnerability cannot be remediated immediately
- **WHEN** a dependency issue remains temporarily unresolved
- **THEN** the project records the rationale, scope, and follow-up action instead of silently accepting the risk

### Requirement: Security documentation matches implementation
Project documentation MUST describe only the security protections that are
actually implemented in the extension.

#### Scenario: Security behavior changes
- **WHEN** credential handling, transport rules, or permission behavior changes
- **THEN** the related README or security-facing documentation is updated in the same change

## MODIFIED Requirements

### Requirement: Known dependency vulnerabilities are actively managed
The project MUST minimize direct dependencies, use supported CI runtimes, pin GitHub Actions to immutable full commit SHAs, and block changes or releases that exceed the defined vulnerability threshold. Any temporary exception MUST record owner, scope, rationale, compensating controls, and expiry.

#### Scenario: Dependency validation runs in CI
- **WHEN** the security validation workflow runs
- **THEN** it checks the lockfile against the defined threshold and fails on high or critical findings without an unexpired documented exception

#### Scenario: Runtime dependency validation runs
- **WHEN** the extension package is prepared
- **THEN** the project verifies that no npm runtime dependency or node_modules content is required or included

#### Scenario: CI runtime reaches end of life
- **WHEN** a configured Node version is no longer supported upstream
- **THEN** the security gate fails until the matrix is updated to supported versions

#### Scenario: Workflow action is mutable
- **WHEN** a workflow `uses:` reference is not pinned to a full commit SHA
- **THEN** workflow policy validation fails

#### Scenario: A vulnerability cannot be remediated immediately
- **WHEN** a dependency issue remains temporarily unresolved
- **THEN** the project records the owner, rationale, impact, compensating controls and expiry instead of silently accepting the risk

## MODIFIED Requirements

### Requirement: Known dependency vulnerabilities are actively managed
The project MUST track and remediate known dependency vulnerabilities that affect the extension, build, or CI workflow, and automated validation MUST fail for unresolved moderate, high, or critical findings.

#### Scenario: Dependency validation runs in CI
- **WHEN** the security validation workflow runs
- **THEN** it executes the package audit at the moderate severity threshold and fails for any unresolved moderate-or-higher finding

#### Scenario: A vulnerability cannot be remediated immediately
- **WHEN** a future dependency issue cannot be fixed without unacceptable breakage
- **THEN** the project records a time-bounded exception containing the rationale, affected scope, compensating controls, owner, and follow-up deadline

## ADDED Requirements

### Requirement: Declared extension permissions are necessary
The extension MUST declare only permissions used by current packaged functionality and MUST validate the expected permission set before release.

#### Scenario: Runtime does not use active-tab access
- **WHEN** the extension only opens validated URLs in new tabs and does not inspect or modify the active tab
- **THEN** the manifest omits the `activeTab` permission and issue-opening behavior continues to work

#### Scenario: Package validation inspects permissions
- **WHEN** the release package is validated
- **THEN** unexpected required permissions cause validation to fail

### Requirement: Canonical specifications cover shipped capabilities
Every capability implemented in the released extension MUST have a canonical specification under `openspec/specs/`; archived change artifacts MUST NOT be the only source of its requirements.

#### Scenario: OpenSpec baseline is validated
- **WHEN** strict repository validation runs
- **THEN** all shipped capabilities are present in the canonical specification set and completed changes no longer remain active

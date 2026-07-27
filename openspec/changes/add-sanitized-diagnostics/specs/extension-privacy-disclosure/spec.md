## ADDED Requirements

### Requirement: Privacy disclosures cover optional diagnostics
The public privacy policy and in-product disclosure MUST state that detailed diagnostics is disabled by default, stores only sanitized events locally for at most seven days and 100 records, can be cleared or disabled by the user, and leaves the device only through an explicit user-created export.

#### Scenario: User considers enabling diagnostics
- **WHEN** the diagnostic control is displayed
- **THEN** the user can review what is retained, the limits, how to clear it, and that no automatic upload occurs before opting in

#### Scenario: Privacy policy is validated
- **WHEN** release documentation is checked after diagnostics is added
- **THEN** it accurately describes the snapshot categories, prohibited data, local retention, user-controlled export, and absence of telemetry

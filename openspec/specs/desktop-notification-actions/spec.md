# desktop-notification-actions Specification

## Purpose
TBD - created by archiving change formalize-and-verify-desktop-notification-actions. Update Purpose after archive.
## Requirements
### Requirement: Desktop notification mappings are profile scoped and bounded
Every actionable desktop notification MUST use an opaque ID mapped in local storage to its profile, retained notification record, type, validated issue URL and expiry, and the mapping collection MUST be bounded.

#### Scenario: Single notification is created
- **WHEN** one eligible issue is delivered as a desktop notification
- **THEN** the extension creates a bounded Profile-scoped mapping without embedding credentials or issue content in the notification ID

#### Scenario: Mapping expires
- **WHEN** a mapping passes its retention period or its notification closes
- **THEN** the extension removes it without changing another profile's mappings

### Requirement: Single notification click opens the mapped issue safely
Clicking a valid single-item desktop notification MUST open its mapped issue only after the mapping, active profile and URL base are validated.

#### Scenario: Valid single notification is clicked
- **WHEN** the mapping belongs to the active profile and its URL matches the active Redmine base
- **THEN** the extension opens that issue in a new tab

#### Scenario: Mapping belongs to another profile
- **WHEN** a stale notification from profile A is clicked while profile B is active
- **THEN** the extension opens no issue URL and performs no state mutation

### Requirement: Batch and unknown notifications use a safe inbox fallback
Batch notifications MUST open the Popup inbox, and unknown or legacy notification IDs MUST NOT open an unvalidated URL or mutate notification state.

#### Scenario: Batch notification is clicked
- **WHEN** a multi-issue notification is clicked
- **THEN** the extension opens the Popup inbox for its valid active profile

#### Scenario: Unknown notification ID is clicked
- **WHEN** no valid mapping exists
- **THEN** the extension safely ignores the action or opens the Popup without issuing a Redmine request

### Requirement: Desktop buttons provide open and mark-read actions
When platform buttons are supported, a single-item notification MUST provide Open issue and Mark read actions; mark-read MUST be idempotent and keep history and badge state consistent.

#### Scenario: Mark read button is clicked twice
- **WHEN** the same valid notification receives repeated mark-read events
- **THEN** the retained record remains read, the badge is correct, and no duplicate state entry is created

#### Scenario: Mark read persistence fails
- **WHEN** storage rejects the desktop mark-read update
- **THEN** the extension retains the mapping, records a safe error, and does not claim the record is read

#### Scenario: Platform omits buttons
- **WHEN** the operating system does not present notification buttons
- **THEN** primary click and Popup inbox remain available without unsafe fallback behavior

### Requirement: Failed desktop notification creation removes its mapping
When the browser rejects creation of a mapped desktop notification, the extension MUST remove the mapping created for that notification without removing unrelated Profile mappings.

#### Scenario: Single notification creation fails
- **WHEN** Chrome reports a runtime error while creating a mapped single-item notification
- **THEN** the extension removes that single notification mapping and retains other mappings

#### Scenario: Batch notification creation fails
- **WHEN** Chrome reports a runtime error while creating a mapped batch notification
- **THEN** the extension removes that batch notification mapping and retains other mappings

## ADDED Requirements

### Requirement: Detailed diagnostic retention is explicit opt-in
The extension MUST keep detailed diagnostics disabled by default and MUST retain diagnostic events only after the user enables the localized diagnostic control.

#### Scenario: Diagnostics has never been configured
- **WHEN** `diagnosticsEnabledV1` is absent
- **THEN** the extension treats diagnostics as disabled and stores no diagnostic events

#### Scenario: User enables diagnostics
- **WHEN** the user turns on detailed diagnostics
- **THEN** the extension stores `diagnosticsEnabledV1` as true locally and begins accepting sanitized events from `SafeLogger`

#### Scenario: User disables diagnostics
- **WHEN** the user turns off detailed diagnostics
- **THEN** the extension stores the disabled state, immediately deletes retained events, and stops accepting new events

### Requirement: Diagnostic event retention is bounded
The extension MUST store `DiagnosticEventV1` records only in local extension storage, MUST retain no more than the newest 100 events, and MUST remove events older than seven days.

#### Scenario: Event limit is exceeded
- **WHEN** a sanitized event is appended after 100 current events are retained
- **THEN** the oldest event is removed and at most 100 events are persisted

#### Scenario: Event expires
- **WHEN** retained events are initialized, appended, inspected, or exported
- **THEN** every event older than seven days is removed before the resulting collection is used

#### Scenario: User clears diagnostic events
- **WHEN** the user selects the clear-diagnostics action
- **THEN** retained events are deleted without changing the enabled setting

### Requirement: DiagnosticSnapshotV1 uses a closed safe schema
The internal diagnostic action MUST construct `DiagnosticSnapshotV1` only from allowlisted extension identity, configuration booleans, transport scheme, permissions, alarm state, sync health, schema versions, locally bound fingerprint, aggregate counts, diagnostic settings, and sanitized events.

#### Scenario: Snapshot is created
- **WHEN** an authorized caller requests diagnostics
- **THEN** the response contains schema version 1, an ISO UTC generation time, and every required allowlisted section with bounded values

#### Scenario: Diagnostics is disabled
- **WHEN** an authorized caller requests a snapshot while detailed diagnostics is disabled
- **THEN** current health and aggregate fields remain available but the events array is empty

### Requirement: Diagnostic output excludes sensitive and identifying data
Diagnostic snapshots and exports MUST NOT contain API keys, token values, full URLs, hostnames, normalized server scopes, binding IDs, full profile IDs, issue IDs or titles, comments, project or user names, request headers, response bodies, or raw errors and stacks.

#### Scenario: Runtime state contains sensitive values
- **WHEN** the snapshot is built from a configured profile with Redmine content and errors
- **THEN** only booleans, safe codes, counts, timestamps, transport scheme, and the locally bound fingerprint represent that state

#### Scenario: Final validation detects prohibited content
- **WHEN** a prohibited key, type, value pattern, or oversized collection reaches final validation
- **THEN** `getDiagnostics` returns `diagnosticsUnsafe`, creates no export, and does not log the rejected content

### Requirement: Server correlation uses an irreversible local fingerprint
The snapshot MUST represent an active server only with a versioned SHA-256 fingerprint bound to the local credential generation and truncated to 16 lowercase hexadecimal characters.

#### Scenario: Active profile exists
- **WHEN** a diagnostic snapshot is created for an active profile
- **THEN** `serverFingerprint` is stable for that local credential generation and reveals neither the binding ID nor server scope

#### Scenario: No active profile exists
- **WHEN** no active profile is available
- **THEN** `serverFingerprint` is null

### Requirement: Diagnostic runtime access is internal and fixed
The runtime MUST expose `getDiagnostics` only to a sender whose extension ID equals the current runtime ID and MUST NOT accept caller-selected keys, domains, or record identifiers.

#### Scenario: Options requests diagnostics
- **WHEN** the packaged Options page sends `getDiagnostics`
- **THEN** the router returns `{ success: true, diagnostics: DiagnosticSnapshotV1 }`

#### Scenario: Unauthorized sender requests diagnostics
- **WHEN** the sender ID does not match the current extension
- **THEN** the router returns the safe `unauthorizedDiagnostics` error without reading diagnostic state

### Requirement: Users can export without additional permissions
Options MUST export a validated snapshot as pretty-printed JSON using Blob and a temporary download anchor and MUST revoke the object URL after use.

#### Scenario: Export succeeds
- **WHEN** the user selects export and the snapshot passes validation
- **THEN** the browser downloads `mewmew-diagnostics-YYYYMMDD-HHmmss.json` with MIME type `application/json`

#### Scenario: Manifest is validated
- **WHEN** diagnostic functionality is packaged
- **THEN** no downloads, clipboard, or additional host permission is declared for export

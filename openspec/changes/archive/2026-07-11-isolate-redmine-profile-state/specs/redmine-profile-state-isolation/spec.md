## ADDED Requirements

### Requirement: Profile identity is bound to server user and credential generation
The extension MUST derive a non-secret `profileId` from the normalized Redmine origin/path, the verified current-user ID, and a local credential binding generation that changes whenever the configured API key changes.

#### Scenario: Same issue ID on different servers
- **WHEN** server A and server B both contain issue ID 1
- **THEN** the extension stores and evaluates their notification state under different profile IDs

#### Scenario: API key changes on the same server
- **WHEN** the API key changes while the normalized server and current-user ID remain the same
- **THEN** the extension creates a new profile ID and does not inherit the prior credential generation's notification state

### Requirement: Notification and sync state is profile scoped
The extension MUST store history, issue states, read IDs, seen IDs, sync cursor, project metadata cache, and sync health under a versioned profile namespace in local storage.

#### Scenario: Loading active profile history
- **WHEN** the popup requests notifications for the active profile
- **THEN** only records belonging to that exact profile are returned

#### Scenario: Profile initialization fails
- **WHEN** the current user cannot be verified or profile storage initialization fails
- **THEN** the extension keeps the previous active profile unchanged and does not expose its records as belonging to the new configuration

### Requirement: Issue actions enforce active profile ownership
Every retained notification and issue-action request MUST carry a profile ID, and the background MUST reject an action unless the request, record, and active profile IDs match.

#### Scenario: Stale card attempts an update
- **WHEN** a card from profile A sends an issue update after profile B becomes active
- **THEN** the background returns `profileMismatch` and sends no Redmine request

#### Scenario: Active profile performs an update
- **WHEN** the request and notification record both belong to the active profile
- **THEN** the background may validate and execute the requested Redmine action

### Requirement: Legacy global state is migrated without guessing ownership
The extension MUST migrate legacy global notification state only after the configured credentials resolve to a verified profile, and MUST clear malformed or unassignable legacy state instead of merging it heuristically.

#### Scenario: Legacy state has a verified owner
- **WHEN** legacy state exists and the current configuration successfully resolves to a profile
- **THEN** the extension migrates the state once, writes a migration marker, and removes the legacy keys after successful persistence

#### Scenario: Legacy state cannot be assigned safely
- **WHEN** credentials cannot be verified or legacy data is malformed
- **THEN** the extension clears the unassignable notification state without exposing it through the new profile

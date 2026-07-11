## MODIFIED Requirements

### Requirement: API key storage is local-only
The extension MUST store the Redmine API key and its credential binding metadata in local extension storage, MUST NOT persist either value in synchronized storage, and MUST create a new credential binding whenever the API key changes.

#### Scenario: Saving Redmine credentials
- **WHEN** a user saves a valid Redmine URL and API key
- **THEN** the API key and binding metadata are stored only in local extension storage

#### Scenario: Replacing an API key
- **WHEN** a saved API key differs from the currently stored key
- **THEN** the extension creates a new credential binding before resolving the new active profile

#### Scenario: Loading synchronized preferences
- **WHEN** the extension loads synchronized settings
- **THEN** it reads non-sensitive preferences without expecting an API key or credential binding to exist there

### Requirement: Existing synchronized API keys are migrated safely
The extension MUST detect legacy API keys in synchronized storage, migrate them to local storage with a new credential binding, and remove the synchronized copy only after the local write succeeds.

#### Scenario: First run after the storage model changes
- **WHEN** the extension finds an API key in synchronized storage and no local replacement exists
- **THEN** it copies the API key and new binding metadata into local storage before removing the synchronized copy

#### Scenario: Local credential already exists
- **WHEN** both local and synchronized API keys exist
- **THEN** the extension preserves the local credential and removes the synchronized copy without merging profile state

### Requirement: Secrets are redacted in UI and diagnostics
The extension MUST avoid exposing API keys, credential binding values, or secret-derived material in profile IDs, status messages, logs, and user-visible diagnostics.

#### Scenario: Credential-related failure occurs
- **WHEN** the extension reports an error related to Redmine configuration, profile resolution, or connectivity
- **THEN** the message omits or redacts the API key and credential binding

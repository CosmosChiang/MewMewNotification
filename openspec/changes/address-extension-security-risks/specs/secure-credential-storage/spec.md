## ADDED Requirements

### Requirement: API key storage is local-only
The extension MUST store the Redmine API key in local extension storage and
MUST NOT persist it in synchronized storage.

#### Scenario: Saving Redmine credentials
- **WHEN** a user saves a valid Redmine URL and API key
- **THEN** the API key is stored only in local extension storage

#### Scenario: Loading synchronized preferences
- **WHEN** the extension loads synchronized settings
- **THEN** it reads non-sensitive preferences without expecting the API key to exist there

### Requirement: Existing synchronized API keys are migrated safely
The extension MUST detect legacy API keys in synchronized storage, migrate them
to local storage, and remove the synchronized copy after a successful transfer.

#### Scenario: First run after the storage model changes
- **WHEN** the extension finds an API key in synchronized storage and no local replacement exists
- **THEN** it copies the API key into local storage and removes the synchronized copy

### Requirement: Secrets are redacted in UI and diagnostics
The extension MUST avoid exposing API keys in status messages, logs, and error
surfaces shown to the user.

#### Scenario: Credential-related failure occurs
- **WHEN** the extension reports an error related to Redmine configuration or connectivity
- **THEN** the message omits or redacts any API key value

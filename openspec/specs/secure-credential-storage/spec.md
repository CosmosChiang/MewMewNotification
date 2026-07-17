## Purpose
Ensure Redmine credentials remain in local-only extension storage and are never exposed through synchronized storage, logs, or user-visible diagnostics.
## Requirements
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

### Requirement: Issue state changes are persisted in a single batched write per check cycle
The extension MUST accumulate all issue state updates for a notification check cycle
in memory and write them to `chrome.storage.local` in a single call after the cycle
completes. Per-issue individual writes inside the processing loop are NOT permitted.

#### Scenario: Multiple issues updated in one cycle
- **WHEN** a notification check cycle finds state changes in multiple issues
- **THEN** all updated issue states are written in one `chrome.storage.local.set()` call

### Requirement: Synchronized read-notification list is bounded
The list of read notification IDs stored in `chrome.storage.sync` SHALL NOT exceed
1000 entries. Oldest entries are removed first when the limit is reached.

#### Scenario: Read list grows to the limit
- **WHEN** the number of stored read notification IDs reaches 1000 and a new one is added
- **THEN** the oldest ID is discarded and the new ID is appended before writing

### Requirement: Public listing describes credential storage accurately
Chrome Web Store copy and screenshots MUST state that the Redmine API key is stored only in local extension storage and is not synchronized across devices.

#### Scenario: Credential storage copy is validated
- **WHEN** localized listing metadata is prepared for publication
- **THEN** every locale describes local-only credential storage and contains no claim that the API key is stored in synchronized storage

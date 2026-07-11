## MODIFIED Requirements

### Requirement: Read notifications array is capped at a maximum size
Each profile's `readNotifications` collection stored in `chrome.storage.local` SHALL be isolated from every other profile and MUST remain within a byte-safe configured maximum. When adding an ID would exceed the entry or serialized-byte limit, the oldest entries MUST be removed before persistence.

#### Scenario: Marking read within profile limit
- **WHEN** a notification is marked read and its profile's collection remains within both limits
- **THEN** the ID is appended only to that profile's local read collection

#### Scenario: Marking read at profile limit
- **WHEN** adding a notification ID would exceed the profile's entry or serialized-byte limit
- **THEN** the oldest IDs are removed until the persisted collection is within both limits

#### Scenario: Read state does not cross profiles
- **WHEN** the same notification ID exists in profiles A and B and it is marked read in profile A
- **THEN** profile B's read state remains unchanged

### Requirement: Read status check is unaffected by the cleanup
Checking read status MUST use the current active profile's in-memory collection after cleanup and MUST NOT consult another profile or the legacy global synchronized array.

#### Scenario: Recently read notification is still recognized
- **WHEN** a notification was marked read in the active profile and remains inside its retention window
- **THEN** checking that notification returns true

#### Scenario: Legacy synchronized read IDs remain
- **WHEN** migration completes successfully
- **THEN** the legacy synchronized `readNotifications` item is removed and no longer used for read checks

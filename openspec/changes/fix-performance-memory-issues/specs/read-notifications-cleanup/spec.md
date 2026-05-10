## ADDED Requirements

### Requirement: Read notifications array is capped at a maximum size
The `readNotifications` array stored in `chrome.storage.sync` SHALL NOT exceed `MAX_READ_NOTIFICATIONS` entries (1000). When marking a notification as read would cause the array to exceed this limit, the oldest entries (from the beginning of the array) MUST be removed to bring the count back to the limit.

#### Scenario: Marking read within limit
- **WHEN** a notification is marked as read and the current array length is below 1000
- **THEN** the notification ID is appended and the full array is written to `chrome.storage.sync`

#### Scenario: Marking read at limit
- **WHEN** a notification is marked as read and the current array length is already 1000
- **THEN** the oldest entry is removed from the front and the new ID is appended before writing

#### Scenario: Array never exceeds the maximum
- **WHEN** the read-notifications array is written to `chrome.storage.sync`
- **THEN** its length SHALL always be ≤ 1000

### Requirement: Read status check is unaffected by the cleanup
Checking whether a notification is already read MUST use the current in-memory array after cleanup has been applied, ensuring no false negatives for recently read items.

#### Scenario: Recently read notification is still recognized
- **WHEN** a notification was marked read in the current session (within the 1000-entry window)
- **THEN** checking its read status returns true

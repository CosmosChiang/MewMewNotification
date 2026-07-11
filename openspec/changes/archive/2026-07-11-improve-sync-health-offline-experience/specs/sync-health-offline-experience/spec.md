## ADDED Requirements

### Requirement: Retained notifications render before live synchronization
The Popup MUST load and display retained notifications and their freshness state without waiting for a Redmine request, then MUST start background revalidation.

#### Scenario: Cached history exists while online
- **WHEN** the Popup opens with retained history
- **THEN** it renders the history first and updates it after background synchronization completes

#### Scenario: Cached history exists while offline
- **WHEN** the Popup opens and Redmine is unreachable
- **THEN** it keeps the retained history visible and marks it stale with a localized error

### Requirement: Synchronization health is visible and safe
The Popup MUST present syncing, last-success, stale, error-code and scheduled-retry states from SyncResult without exposing raw server responses or secrets.

#### Scenario: Synchronization succeeds
- **WHEN** background synchronization completes successfully
- **THEN** the UI clears stale/error state and displays the updated last-success time

#### Scenario: Retry is scheduled
- **WHEN** SyncResult reports `retryScheduled`
- **THEN** the UI shows a localized retry state while retaining cached notifications

### Requirement: User actions expose failure and recovery
Mark-read, mark-all, open, refresh and issue actions MUST show a visible localized failure when their background operation fails and MUST preserve a safe retry path.

#### Scenario: Mark-read persistence fails
- **WHEN** storage rejects a mark-read operation
- **THEN** the card remains unread and the Popup announces the failure

#### Scenario: Refresh fails with cached data
- **WHEN** refresh fails while history is visible
- **THEN** the UI preserves the list, marks it stale and enables retry

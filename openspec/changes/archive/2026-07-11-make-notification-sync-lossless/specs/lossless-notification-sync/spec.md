## ADDED Requirements

### Requirement: Fetch limits are independent from presentation limits
The extension MUST paginate Redmine issue queries until all results in the synchronization window are processed, regardless of the Popup display limit or history retention count.

#### Scenario: More updates than display limit
- **WHEN** the display limit is 10 and 25 eligible issues are updated in one synchronization window
- **THEN** all 25 updates are processed while the Popup still applies its display limit

#### Scenario: Multiple Redmine pages
- **WHEN** `total_count` exceeds the API page size
- **THEN** the extension requests subsequent offsets until every page is consumed

### Requirement: Incremental synchronization uses a replay-safe overlap cursor
After a baseline, the extension MUST query issues updated from an overlap before the committed cursor and MUST deduplicate replayed results by profile, issue ID, and update identity.

#### Scenario: Two updates share a timestamp
- **WHEN** multiple issues have the same updated timestamp at a page or cursor boundary
- **THEN** every issue is processed without loss and previously committed updates are not delivered twice

#### Scenario: Synchronization is interrupted
- **WHEN** a run stops before commit
- **THEN** the next run replays the overlap from the prior cursor without losing updates

### Requirement: Cursor advances only after durable state commit
The extension MUST persist the new cursor only after issue state, notification history, read effects, and reconciliation results for the run are successfully stored.

#### Scenario: History persistence fails
- **WHEN** issue processing succeeds but notification history persistence fails
- **THEN** the cursor remains unchanged and the run reports failure

#### Scenario: All run data persists
- **WHEN** every required state write succeeds
- **THEN** the extension commits the run cursor as the final persistence step

### Requirement: Closed and missing tracked issues are reconciled
The extension MUST include closed issues in incremental discovery and MUST reconcile a bounded set of previously tracked issues that disappear from assigned or watched results.

#### Scenario: Assigned issue is closed
- **WHEN** a tracked open issue becomes closed
- **THEN** the extension records and classifies the status transition exactly once

#### Scenario: Issue is reassigned away
- **WHEN** a tracked issue is assigned to another user and leaves the primary assigned query
- **THEN** bounded reconciliation records the assignee transition exactly once

#### Scenario: Issue becomes unavailable
- **WHEN** reconciliation returns not-found or forbidden
- **THEN** the extension stores a stable unavailable tombstone and does not repeatedly alert on every run

### Requirement: Periodic full reconciliation repairs drift
The extension MUST perform a bounded periodic full reconciliation in addition to incremental synchronization.

#### Scenario: Incremental data drift exists
- **WHEN** a tracked record differs from the full reconciliation result
- **THEN** the extension repairs local state using the same idempotent event and focus-policy pipeline

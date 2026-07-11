## Why

At the moment, `maxNotifications` limits both the UI and the API query, pagination does not exist, and the so-called incremental sync does not include `updated_on` in the query. During high-volume periods, issues that are closed or reassigned away from the user may be permanently missed, so sync must become replayable, paginated, and lossless.

## What Changes

- Separate the UI display limit, API page size, history retention, and state retention.
- Use an `updated_on` overlap cursor to fetch every page, and deduplicate idempotently by issue ID, updated timestamp, and Profile scope.
- Include closed issues in the query, and run bounded reconciliation for issues that are still tracked but no longer appear in the main query to identify closure, reassignment, deletion, or lack of access.
- Advance the cursor only after all issue state, history, and notification results are successfully committed.
- Add periodic full reconciliation to correct clock skew, API sort changes, or gaps caused by interruptions.

## Capabilities

### New Capabilities

- `lossless-notification-sync`: Defines pagination, overlap cursors, commit watermarks, idempotent replay, closed/reassigned reconciliation, and full reconciliation.

### Modified Capabilities

- `notification-focus-controls`: Project and change-type rules must apply equally to pagination, closed/reassigned reconciliation, and replay results without being bypassed because the data source is different.

## Impact

This primarily affects the Redmine issue queries in `background.js`, the sync state machine, storage commit order, notification classification, and test data. It requires new fake Redmine pagination and clock-skew fixtures, and it depends on Profile state isolation and a stable sync lifecycle.

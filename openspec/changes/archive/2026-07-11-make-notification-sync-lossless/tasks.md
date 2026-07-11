## 1. Prerequisites and Data Model

- [x] 1.1 Confirm Profile state isolation and stable single-flight SyncResult changes are implemented and validated
- [x] 1.2 Separate API page size, Popup display limit, history retention, and issue-state retention constants/settings
- [x] 1.3 Define versioned overlap cursor, event identity, reconciliation queue, and unavailable tombstone schemas

## 2. Paginated Incremental Fetch

- [x] 2.1 Implement deterministic Redmine pagination using total_count, offset, and page size
- [x] 2.2 Add `updated_on` overlap filtering and include closed issues with compatible fallback behavior
- [x] 2.3 Deduplicate replayed results by Profile, issue ID, and update identity while preserving all boundary timestamps

## 3. Missing-Issue Reconciliation

- [x] 3.1 Track previously relevant issue IDs and enqueue bounded reconciliation when they disappear from primary queries
- [x] 3.2 Detect and classify closed and reassigned-away transitions exactly once
- [x] 3.3 Persist stable unavailable tombstones for not-found/forbidden results without repeated alerts
- [x] 3.4 Add bounded periodic full reconciliation and persist unfinished reconciliation work

## 4. Commit and Focus Policy

- [x] 4.1 Build the complete next run state in memory and persist issue/history/read/reconciliation effects before cursor
- [x] 4.2 Commit cursor as the final write and preserve the old cursor on any earlier persistence failure
- [x] 4.3 Route baseline, paginated, replayed, and reconciled events through the same project/change/quiet/bundling policy

## 5. Verification and Documentation

- [x] 5.1 Add fake Redmine fixtures for 25 updates with display limit 10 and multi-page boundaries
- [x] 5.2 Test equal timestamps, clock skew, interrupted commit, replay idempotency, and storage failure
- [x] 5.3 Test open-to-closed, assigned-to-other, 404, 403, and focus-rule behavior
- [x] 5.4 Document cursor/reconciliation semantics and run integration, unit, and strict OpenSpec validation

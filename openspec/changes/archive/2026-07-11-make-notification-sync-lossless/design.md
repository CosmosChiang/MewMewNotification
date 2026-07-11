## Context

The current issue list query returns at most the UI notification limit, does not paginate, and never applies the stored lastSyncTime to `updated_on`. Open-only and currently-assigned filters also make closed or reassigned issues disappear before their final transition is observed.

## Goals / Non-Goals

**Goals:**

- Process every issue update in the synchronization window regardless of UI limits.
- Make replay safe and advance the cursor only after durable state commit.
- Detect closed, reassigned, deleted and inaccessible transitions for previously tracked issues.

**Non-Goals:**

- This change does not allow unlimited history retention.
- It does not provide real-time webhooks or a server-side component.
- It does not replace Profile isolation or single-flight lifecycle work.

## Decisions

### D1: Separate fetch, display and retention limits

Use independent constants/settings for API page size, Popup display count, history retention and issue-state retention. Fetch loops follow Redmine `total_count`, `offset` and `limit` until every page in the query window is consumed.

### D2: Use an overlap cursor and deterministic deduplication

The query window starts before the committed cursor by a fixed overlap. Results use deterministic ordering and deduplicate by profile ID, issue ID and updated timestamp. The overlap makes equal timestamps, clock skew and interrupted runs replay-safe.

### D3: Commit cursor last

Build a complete next state in memory, persist issue state/history/read effects, then persist the new cursor as the final write. If any prior write fails, the old cursor remains and the overlap replays the window. Notification IDs and state comparison prevent duplicate delivery.

### D4: Reconcile previously tracked issues

Primary incremental queries include `status_id=*`. IDs previously tracked but missing from the assigned/watched result enter a bounded reconciliation queue. Direct issue fetch identifies closed/reassigned state; 404 or permission failure produces a stable removed/inaccessible tombstone without repeated alerts. A periodic full reconciliation repairs long-lived drift.

### D5: Focus rules are applied after canonical event creation

All paginated, replayed and reconciled records pass through the same project/change/quiet/bundling policy. Data-source-specific branches cannot bypass notification focus controls.

## Risks / Trade-offs

- [Risk] More API calls on busy servers → page with the maximum supported size, bound reconciliation per run, respect rate limits, and persist the remaining queue.
- [Risk] Redmine versions differ in filters → keep capability fallback and record when a full reconciliation path is used.
- [Risk] A 404 may mean deleted or unauthorized → expose only a generic unavailable classification and never claim deletion without evidence.

## Migration Plan

1. Introduce versioned cursor and independent limits without enabling incremental filtering.
2. Add paginated full sync and replay-safe notification IDs.
3. Enable overlap cursor after successful baseline commit.
4. Add missing-ID reconciliation and periodic full repair.
5. Rollback clears the new cursor so the previous version performs a full baseline.

## Open Questions

- The exact reconciliation cadence and per-run budget will be constants backed by load tests, not user-facing settings in this change.

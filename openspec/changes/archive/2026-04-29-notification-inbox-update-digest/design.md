## Context

The extension currently keeps notification objects in `NotificationManager.notifications` and tracks read notification ids separately. The popup immediately refreshes notifications and then filters out read items before rendering, so read notifications are not available as an inbox history even though the user-facing documentation describes mark-as-read as preserving records. Issue update detection already compares `updated_on` and stores previous issue state, but the rendered notification does not explain which meaningful fields changed.

This change introduces a local notification inbox with persisted history, read/read-all/all views, search, and field-level update digests. The history is local-only because it is derived work state and can include issue metadata from a configured Redmine instance.

## Goals / Non-Goals

**Goals:**
- Preserve recent notification history across popup reloads, service worker restarts, and browser restarts.
- Keep unread as the default popup view and keep the badge unread-only.
- Let users switch between unread, read, and all retained notifications.
- Let users search the selected inbox view by issue id, title, project, and assignee.
- Generate understandable update digests from comparable issue fields.
- Bound local history storage so it cannot grow indefinitely.
- Clarify clear actions so read history is not deleted accidentally.

**Non-Goals:**
- Multi-Redmine or multi-account support.
- Cloud sync for notification history.
- Full Redmine journal timeline rendering.
- Complex rule-based notification filtering.
- New external dependencies or database storage.

## Decisions

### Store inbox history in `chrome.storage.local`

Use a new local storage key, for example `notificationHistory`, containing normalized notification records. API credentials already live in local storage, and notification history is device-local work context rather than a preference that should sync across browsers.

Alternative considered: continue using in-memory notifications plus `readNotifications` in sync storage. That keeps the current shape smaller, but it cannot survive service worker restarts and keeps read state separate from the retained notification record.

### Normalize notification history records

Each record should include stable fields needed by both background and popup:

```js
{
  id: "issue_123",
  issueId: 123,
  title: "#123: Fix login bug",
  project: "Project A",
  status: "In Progress",
  priority: "High",
  assigneeId: 7,
  assigneeName: "Alice",
  projectId: 4,
  sourceType: "assigned",
  updatedOn: "2026-04-29T10:15:00.000Z",
  url: "https://redmine.example.com/issues/123",
  read: false,
  isUpdated: true,
  changeSummary: [
    { field: "status", from: "New", to: "In Progress" }
  ],
  lastSeenState: {
    subject: "Fix login bug",
    status: "In Progress",
    priority: "High",
    assigneeId: 7,
    assigneeName: "Alice",
    updatedOn: 1770000000000
  }
}
```

The popup should treat missing optional fields defensively so older records and partial Redmine responses still render.

### Generate digests from issue field snapshots

The first implementation should compare locally available issue fields: subject, status, priority, and assignee. These fields are already available from the Redmine issues endpoint. If prior state is unavailable, the notification can still be marked updated without claiming exact field-level changes.

Alternative considered: request Redmine journals for each changed issue. That would provide richer detail, but it increases API calls, permission variability, latency, and rate-limit risk. Journal support can be added later as a separate enhancement.

### Keep read state on history records

Marking a notification read should update the matching history record's `read` flag and refresh the badge from retained unread records. The existing `readNotifications` sync list can be kept temporarily for compatibility, but the new inbox should treat the local history record as the primary source of display state.

### Retention is fixed for the first implementation

Use a fixed retention policy such as the most recent 100 records or 30 days, whichever is simpler to implement consistently with current tests. A user-configurable retention setting can be added later if users need it.

### Popup filters client-side

The popup should request retained notifications from the background script and apply inbox view filtering and text search client-side. This keeps the message API simple and avoids adding several background query variants before there is evidence of performance pressure.

## Risks / Trade-offs

- History schema drift -> Store records defensively and normalize on read so older records do not break rendering.
- Storage growth -> Apply retention every time history is saved or refreshed.
- Duplicate read state during migration -> Prefer local history `read` while still honoring existing `readNotifications` when creating or reconciling records.
- Digest incompleteness -> Clearly show field-level changes only when comparable values exist; otherwise show a generic updated state.
- Popup complexity -> Keep first version to three views and one search input; postpone project/priority/tracker filters.

## Migration Plan

1. Add local history loading with empty-history fallback.
2. When notifications are built from current Redmine issues, merge them into local history and copy read state from existing `readNotifications` when present.
3. Continue writing `readNotifications` during the transition if needed by existing tests or compatibility paths.
4. Apply retention after every history merge and after clear-history actions.
5. Update README behavior descriptions after implementation so mark-as-read, clear, and clear-history semantics match the UI.

Rollback is straightforward because the new history key is additive. If the feature is disabled or reverted, existing unread notification behavior can continue from in-memory notifications and `readNotifications`; leftover local history can be ignored or cleared by reset.

## Open Questions

- Should the first retention policy be count-based only, time-based only, or both?
- Should the existing clear-all button become "clear current view" or should history clearing be a separate action from the start?
- Should read history include notifications no longer returned by the current Redmine query, or only issues still present in the latest fetched set?

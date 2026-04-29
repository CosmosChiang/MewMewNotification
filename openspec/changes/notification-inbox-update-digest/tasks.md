## 1. Data Model and Storage

- [x] 1.1 Define the local notification history record shape and storage key.
- [x] 1.2 Add helpers to load, normalize, save, and retain notification history in `chrome.storage.local`.
- [x] 1.3 Apply a fixed bounded retention policy when saving history.
- [x] 1.4 Reconcile existing `readNotifications` state with local history records during history merge.

## 2. Background Notification Flow

- [x] 2.1 Merge newly fetched Redmine issue notifications into local notification history.
- [x] 2.2 Generate issue field snapshots for subject, status, priority, assignee, and update timestamp.
- [x] 2.3 Compare previous and current issue snapshots to produce `changeSummary` entries.
- [x] 2.4 Preserve generic updated indicators when no comparable field changes are available.
- [x] 2.5 Update mark-as-read and mark-all-read flows to preserve local history and recalculate unread badge count.
- [x] 2.6 Add or update runtime message responses so popup can retrieve retained notification history.

## 3. Popup Inbox UI

- [x] 3.1 Add unread, read, and all inbox view controls to `popup.html`.
- [x] 3.2 Add a lightweight search input to `popup.html`.
- [x] 3.3 Update `scripts/popup.js` to keep inbox view and search state.
- [x] 3.4 Remove the fixed unread-only render filter and filter notifications by selected inbox view.
- [x] 3.5 Implement client-side search by issue id, title, project, and assignee.
- [x] 3.6 Render change digest rows on notification cards when `changeSummary` is present.
- [x] 3.7 Keep unread as the default popup view and keep empty states accurate for each view.

## 4. Clear and History Semantics

- [ ] 4.1 Define clear active notifications behavior without silently deleting retained history.
- [ ] 4.2 Add explicit clear-history behavior with confirmation.
- [ ] 4.3 Ensure clearing retained history resets the unread badge to zero.

## 5. Localization and Styling

- [ ] 5.1 Add inbox, search, read/all/unread, digest, no-history, and clear-history strings to all locale files.
- [ ] 5.2 Style inbox tabs, search field, digest rows, and history empty states in `styles/popup.css`.
- [ ] 5.3 Verify popup layout remains usable with long localized labels.

## 6. Tests and Documentation

- [ ] 6.1 Add background tests for history persistence, retention, read state preservation, and digest generation.
- [ ] 6.2 Add popup tests for unread/read/all view filtering and search behavior.
- [ ] 6.3 Add popup tests for digest rendering and view-specific empty states.
- [ ] 6.4 Update README documentation for inbox history, update digest, mark-as-read, clear, and clear-history behavior.
- [ ] 6.5 Run the relevant local test suite and fix regressions.

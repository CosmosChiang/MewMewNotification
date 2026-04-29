## Why

MewMewNotification currently behaves like an unread-only alert list: once a notification is marked read, users cannot easily return to it from the popup, even though the documentation frames mark-as-read as preserving notification history. Users also see that an issue changed, but not what changed, which forces unnecessary Redmine page opens and makes notification priority hard to judge.

## What Changes

- Add a notification inbox model that keeps recent notification history in local extension storage.
- Add popup views for unread, read, and all notifications while preserving the current unread-first default.
- Add lightweight notification search across issue id, subject/title, project, and assignee.
- Add update digest data to issue notifications so cards can show field-level changes such as status, priority, assignee, and subject.
- Keep the toolbar badge based on unread notifications only.
- Clarify clear/read behavior so marking as read preserves history, while clearing can remove active notifications and history according to explicit UI action semantics.
- Add bounded retention for local notification history to prevent unbounded storage growth.

## Capabilities

### New Capabilities
- `notification-inbox`: Notification history, read/unread/all inbox views, lightweight search, update digest summaries, and bounded local retention.

### Modified Capabilities

## Impact

- Affected runtime code:
  - `background.js` notification persistence, issue state comparison, read state handling, and message responses.
  - `scripts/popup.js` inbox state, filtering, search, rendering, and card digest display.
  - `popup.html` inbox controls and search input.
  - `styles/popup.css` inbox tabs, search, and digest presentation.
  - `_locales/*/messages.json` strings for inbox views, search, history, digest labels, and clear-history actions.
- Affected tests:
  - `scripts/background.test.js` for history persistence, retention, read state, and digest generation.
  - `scripts/popup.test.js` for inbox filtering, read/all views, search, and digest rendering.
- Storage impact:
  - Adds a local storage key for notification history and may migrate or reconcile existing read notification state.
- No new external dependencies are expected.

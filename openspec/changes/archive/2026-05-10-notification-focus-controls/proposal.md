## Why

MewMewNotification already helps users read, search, and act on Redmine updates after those notifications arrive, but it still offers only coarse global notification controls before alerts are created. As the inbox and quick-action flows become more capable, the next urgent gap is reducing alert fatigue so users can stay focused without disabling the extension entirely.

## What Changes

- Add user-configurable notification focus controls that reduce low-value interruptions before they reach the popup inbox or desktop alerts.
- Add per-project notification rules so users can include or exclude specific projects from extension-driven notifications.
- Add change-type filters so users can choose which issue updates are important enough to surface, starting with status changes, assignee changes, priority changes, and comment/journal activity.
- Add quiet hours so desktop and popup-facing alerts can be suppressed during configured focus windows without removing stored notification history.
- Add short-window notification bundling for repeated updates on the same issue so bursty activity becomes a single surfaced notification instead of a rapid stream.
- Preserve existing inbox history, search, digest, and quick-action capabilities; this change only improves how notifications are admitted and surfaced.

## Capabilities

### New Capabilities
- `notification-focus-controls`: Per-project rules, change-type filtering, quiet hours, and short-window per-issue bundling for Redmine notifications.

### Modified Capabilities

## Impact

- Affected runtime code:
  - `background.js` notification fetch filtering, change classification, bundling, and quiet-hours handling.
  - `scripts/options.js` and `options.html` for new focus-control settings UI.
  - `scripts/shared/config-manager.js` for validating and sanitizing the new settings shape.
  - `scripts/popup.js` and `popup.html` only where bundled notifications or suppressed states need to be represented consistently with the inbox.
  - `_locales/*/messages.json` for project-rule, change-filter, quiet-hours, and bundling labels.
- Affected tests:
  - `scripts/background.test.js` for project-rule evaluation, quiet-hours suppression, change-type filtering, and bundling behavior.
  - `scripts/options.test.js` and `scripts/popup.test.js` for settings persistence, validation, and bundled notification rendering.
- Storage impact:
  - Adds new sync-stored notification focus preferences and may add local metadata for bundling windows or suppressed notification bookkeeping.
- No new external dependencies are expected.

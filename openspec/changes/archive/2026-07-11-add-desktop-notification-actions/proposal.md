## Why

At the moment, clicking a single desktop notification only opens the Popup, and users cannot jump directly to the corresponding issue or quickly mark it read. Existing notification history and Profile isolation can provide a safe mapping, so the path from notification to issue handling can be shortened.

## What Changes

- Create a persistent and safe mapping between desktop notification IDs and Profile-scoped notification records.
- The primary click on a single notification opens its Redmine issue directly; batch notifications still open the inbox.
- Single notifications provide `Open issue` and `Mark as read` actions, and the platform limit of at most two buttons must be handled.
- Unknown, expired, or non-current-Profile notification IDs must be ignored safely or open the inbox, and must not operate on another Profile.
- Click and button actions must be idempotent, logged on error, and consistent with local history and badge state.

## Capabilities

### New Capabilities

- `desktop-notification-actions`: Defines notification mapping, direct open, mark-as-read, batch fallback, Profile protection, and platform fallback behavior.

### Modified Capabilities

None.

## Impact

This primarily affects the notification creation, click, and button listeners in `background.js`, notification history storage, Popup read state, locales, and Chrome notification tests. This change should be implemented after Profile state isolation is complete.

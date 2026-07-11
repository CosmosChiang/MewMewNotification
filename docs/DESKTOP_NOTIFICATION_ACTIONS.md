# Desktop Notification Actions

Single-issue desktop notifications use opaque `issue:<token>` IDs. A bounded local Profile mapping stores only the active profile ID, retained record ID, validated issue URL, notification type, and expiry. Mappings expire after seven days, are capped at 100 entries, and are removed when the system notification closes or the explicit mark-read action succeeds.

Primary click on a valid single notification opens its mapped Redmine issue. The two optional platform buttons are Open issue and Mark read. Mark read updates local retained history and badge state idempotently; it does not issue a Redmine mutation. If persistence fails, the mapping remains and sync health records the safe `desktopMarkReadFailed` code.

Batch notifications open the popup inbox. Unknown and legacy IDs may open the inbox but never an unvalidated URL. Expired, malformed, cross-Profile, record-mismatched, or wrong-origin mappings open no issue and change no read state.

## Manual platform checklist

1. Verify a single notification shows Open issue and Mark read where the operating system supports buttons.
2. Verify primary click and Open issue open the expected active-profile Redmine URL.
3. Verify Mark read updates the popup and badge, including when clicked repeatedly.
4. Verify a batch notification opens the popup rather than an arbitrary issue.
5. Switch credentials before clicking an old notification and verify no issue opens.
6. Verify platforms that omit buttons retain safe primary-click and popup behavior.

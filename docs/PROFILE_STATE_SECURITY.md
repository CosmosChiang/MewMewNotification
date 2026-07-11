# Redmine Profile State Isolation

MewMewNotification stores credentials and notification state locally. A profile is activated only after Redmine verifies the current user.

## Profile identity

`profileId` is a SHA-256 digest of the normalized Redmine origin/path, verified Redmine user ID, and a random local credential binding. It never contains the API key. Changing the API key rotates the credential binding, so the new credential starts with an isolated profile even when the server and user are unchanged.

## Local storage schema

Profile state uses `profileStateV1:<profileId>:<domain>` keys. Domains include history, issue snapshots, read and seen IDs, sync cursor, project cache, and sync health. API keys, credential bindings, profile state, and migration outcomes remain in `chrome.storage.local`; only non-sensitive preferences use sync storage.

At most five recent profile namespaces are retained. Cleanup never removes the active profile. Read IDs are bounded by both entry count and serialized byte size.

## Action boundary

Notification records and issue-action messages carry their `profileId`. Background handlers compare the request profile with the active profile before contacting Redmine. A stale card receives `profileMismatch`; no GET or PUT request is sent for that action.

## Legacy migration

Legacy global notification state is migrated only after credentials resolve to a verified profile. Valid records receive that profile ID. Malformed data is cleared, and legacy keys are removed only after the profile write succeeds. Interrupted migrations retain a retry marker and do not replace the active profile.

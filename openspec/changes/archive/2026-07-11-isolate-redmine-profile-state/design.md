## Context

Existing storage keys and notification IDs are all global, so switching the Redmine URL or API Key does not clear or isolate old data. A Profile must represent the server, the Redmine user, and the local credential generation at the same time, because current user ID alone cannot distinguish the case where the same user rotates an API Key.

## Goals / Non-Goals

**Goals:**

- Establish a stable Profile identity that does not expose the API Key.
- Isolate all notification and sync state, and verify the Profile before actions run.
- Provide a legacy migration that can be interrupted, replayed, and does not guess data ownership.

**Non-Goals:**

- This change does not provide a multi-Profile switching UI.
- It does not sync the API Key or sync Profile state across devices.
- It does not redesign the lossless query or desktop notification buttons.

## Decisions

### D1：Profile identity 包含 credential binding generation

The canonical server scope uses the normalized origin with the trailing slash removed, plus the pathname. After the current user is successfully obtained, `profileId` is generated from `serverScope + userId + credentialBindingId` using SHA-256; `credentialBindingId` is a local-only UUID that must be regenerated when the API Key changes. This satisfies the requirement that a same-site, same-user key rotation should not inherit state, without placing the API Key or a reversible derivative into the key.

The alternatives are to hash the API Key directly, which creates an unnecessary secret fingerprint, or to use only the user ID, which cannot meet the isolation requirement for credential rotation.

### D2：每個 Profile 使用 versioned local storage namespace

Use key names such as `profileStateV1:<profileId>:<domain>`, where the domain at minimum includes history, issueStates, readIds, seenIds, cursor, projectCache, and syncHealth. `activeProfileV1` is updated only after current user verification and namespace initialization succeed. Preferences may remain in sync storage, but notification and sync state all live in local storage.

### D3：所有 notification record 與 action request 攜帶 profileId

Records read from history by the Popup must include `profileId`. Before get, mark-read, issue action, and desktop action flows, Background validates the record, the request, and the active profile together; any mismatch returns a stable `profileMismatch` and must not execute a Redmine PUT.

### D4：Legacy migration 採安全歸屬或清除

Only when the current URL/API Key successfully obtains the current user, a new Profile is created, and the migration marker is still incomplete should legacy global state be assigned to that Profile. If verification fails, the data structure is invalid, or ownership is ambiguous, clear the legacy state and keep a migration outcome that does not contain sensitive content. Remove the old keys only after migration completes.

## Risks / Trade-offs

- [Risk] Changing the API Key loses old read/history state -> this is an explicit security isolation trade-off; a later multi-Profile UI can let users keep old Profiles, but this change does not merge them automatically.
- [Risk] Multiple domain keys are not a database transaction -> write the namespace first, then update the active profile and migration marker last; if the operation fails, the old Profile remains active.
- [Risk] Local storage growth -> each domain keeps its existing retention policy, and the tasks add tests for Profile deletion and orphan cleanup.

## Migration Plan

1. Add Profile identity, versioned key helpers, and credential binding metadata.
2. Switch the read path to the new namespace and run a one-time legacy migration before migration is complete.
3. Add `profileId` validation to write paths and message/action paths.
4. Remove legacy global notification keys after verification succeeds; keep the API Key local-only migration.
5. If a rollback is needed after release, the old version will not read the new namespace; users must be clearly told that notification state will be rebuilt.

## Open Questions

- Whether a future multi-Profile UI should keep disabled Profiles is left for a separate change.

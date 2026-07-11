## 1. Profile Identity and Schema

- [x] 1.1 Add normalized server-scope and local credential-binding helpers with deterministic unit tests
- [x] 1.2 Generate a non-secret SHA-256 profileId from server scope, verified user ID, and credential binding
- [x] 1.3 Define versioned Profile storage keys and active-profile metadata for every scoped domain

## 2. Profile-Scoped Persistence

- [x] 2.1 Route history, issueStates, read/seen IDs, cursor, project cache, and sync health reads/writes through Profile-aware helpers
- [x] 2.2 Move read-notification state from the legacy sync item to byte-safe bounded local Profile storage
- [x] 2.3 Add Profile retention and orphan cleanup without deleting the active Profile

## 3. Runtime and Action Isolation

- [x] 3.1 Resolve and activate a Profile only after current-user verification and namespace initialization succeed
- [x] 3.2 Add profileId to notification records, Popup/background messages, and issue-action context
- [x] 3.3 Reject get/read/issue actions with `profileMismatch` before any Redmine mutation or cross-Profile state access

## 4. Migration

- [x] 4.1 Implement idempotent migration of safely attributable legacy global state into the verified Profile
- [x] 4.2 Clear malformed or unassignable legacy notification state and persist a non-sensitive migration outcome
- [x] 4.3 Regenerate credential binding and activate a clean Profile whenever API Key changes, including same server/same user

## 5. Verification and Documentation

- [x] 5.1 Add A/B server fixtures proving identical issue IDs have isolated state
- [x] 5.2 Add same-server API-Key rotation and stale-card PUT rejection tests
- [x] 5.3 Test migration interruption, retry, storage failure, byte limits, and removal of legacy sync read IDs
- [x] 5.4 Update storage/security documentation and run unit tests plus strict OpenSpec validation

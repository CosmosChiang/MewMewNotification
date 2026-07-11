## Why

At the moment, all Redmine sites and accounts share notification history, issueStates, read/seen IDs, sync cursors, and project caches. After switching site or API Key, the same issue ID may inherit old state, and old cards may even send PUT operations to issues in the new account, so a verifiable Profile isolation boundary must be established first.

## What Changes

- Generate a stable `profileId` from the normalized Redmine origin/path and the verified current user ID.
- Move history, issueStates, read/seen IDs, sync cursor, project cache, and sync health data to Profile-scoped storage.
- Carry `profileId` in notification records, Popup action requests, and background action context, and reject reads or writes when they do not match the current Profile.
- Provide a one-time migration for legacy global state; data that cannot be safely attributed must be cleared rather than guessed.
- **BREAKING**: The old global `readNotifications` and notification state are no longer shared across Redmine sites.

## Capabilities

### New Capabilities

- `redmine-profile-state-isolation`: Defines Profile identity, Profile-scoped storage, switching and migration, and cross-Profile action protection.

### Modified Capabilities

- `read-notifications-cleanup`: Read state moves from a global synced array to bounded data isolated by Profile.
- `secure-credential-storage`: Switching API Key or current user on the same site must create a new Profile boundary, and migration must not leak credentials or account state across Profiles.

## Impact

This primarily affects `background.js`, `scripts/options.js`, `scripts/popup.js`, `scripts/shared/config-manager.js`, the Chrome storage schema, message payloads, existing migration tests, and notification action tests. This change is a prerequisite for lossless sync, direct desktop notification actions, and multi-Profile support.

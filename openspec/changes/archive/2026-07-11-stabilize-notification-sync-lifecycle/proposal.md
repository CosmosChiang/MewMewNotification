## Why

At the moment, service worker startup, alarms, the Popup, and manual refresh can all enter `checkNotifications()` at the same time, and the startup flow also creates an immediate alarm while triggering sync directly. This causes duplicate requests, duplicate notifications, storage races, and fetches that keep running after timeout.

## What Changes

- Use a single-flight `checkPromise` to coalesce sync requests made at the same time so every caller shares the same result.
- Make alarm management idempotent: rebuild only when the alarm does not exist or the interval changes, and stop using `delay=0` plus direct checks as a double trigger.
- Use `AbortController` to truly cancel timed-out fetches, and clear timers on every completion path.
- Introduce an explicit `SyncResult` that distinguishes success, failure, stale, last success, error code, and retry state.
- Move Retry-After waits that are not suitable for long-lived service worker timers into persistent backoff/alarm scheduling.

## Capabilities

### New Capabilities

- `notification-sync-lifecycle`: Defines single-flight behavior, alarm lifecycle, abortable requests, sync result contracts, and resumable backoff.

### Modified Capabilities

- `bounded-retry`: Keeps the maximum retry count and Retry-After cap while also requiring long waits to avoid relying on a long-lived service worker timer.

## Impact

This primarily affects the request queue in `background.js`, `RedmineAPI.makeRequest()`, `NotificationManager.checkNotifications()`, alarm listeners, runtime message handlers, and background/popup tests. The follow-up lossless sync and offline health UI depend on this change's single-flight behavior and `SyncResult`.

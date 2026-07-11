# Notification Synchronization Lifecycle

All synchronization triggers use `NotificationManager.requestSync(trigger)`. Alarm, startup, popup refresh, and force refresh calls that overlap share one promise and receive the same structured result. Force refresh is coalesced with an existing run and never starts a second Redmine request.

## SyncResult

A synchronization result contains `status`, `success`, `stale`, `startedAt`, `completedAt`, `lastSuccessAt`, `errorCode`, `retry`, and `trigger`. Supported statuses are `success`, `failure`, `stale`, and `retryScheduled`. Timed-out mutations separately return `outcomeUnknown` and require a context re-fetch before retry.

## Alarms and retry

The periodic alarm is created only when missing or when its interval changes. Loading the service worker does not synchronize immediately. Long `Retry-After` waits use the separate `redmine-notification-retry` one-shot alarm and local retry metadata; retry count remains capped at three and delay at 300 seconds.

## Timeouts

Every Redmine fetch owns an `AbortController`. Its 30-second timer aborts the underlying request and is cleared in `finally` for success, failure, and timeout paths.

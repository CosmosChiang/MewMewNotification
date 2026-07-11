## 1. Single-Flight Coordinator

- [x] 1.1 Introduce `requestSync(trigger)` and route alarm, startup, Popup, refresh, and force-refresh calls through it
- [x] 1.2 Clear checkPromise in `finally` and return the same SyncResult to all overlapping callers
- [x] 1.3 Define force-refresh coalescing behavior without starting a second concurrent run

## 2. Alarm Lifecycle

- [x] 2.1 Implement promise-based `ensurePeriodicAlarm()` that compares existing period before create/replace
- [x] 2.2 Remove zero-delay plus direct-check double startup and unconditional module-load synchronization
- [x] 2.3 Persist and restore one-shot retry alarm metadata separately from the periodic alarm

## 3. Abortable Requests and SyncResult

- [x] 3.1 Replace Promise.race-only timeout with AbortController and guaranteed timer cleanup
- [x] 3.2 Define stable SyncResult statuses, timestamps, safe error codes, freshness, and retry metadata
- [x] 3.3 Return SyncResult through runtime handlers instead of swallowing failures or returning unconditional success
- [x] 3.4 Treat timed-out Redmine mutations as `outcomeUnknown` and require re-fetch before retry

## 4. Persistent Bounded Retry

- [x] 4.1 Preserve the three-attempt and 300-second limits across worker restarts
- [x] 4.2 Retry short waits in-process and schedule long Retry-After waits with a one-shot alarm
- [x] 4.3 Clear retry metadata on success, terminal failure, configuration change, or Profile change

## 5. Verification and Documentation

- [x] 5.1 Test simultaneous alarm/Popup/manual triggers and assert one Redmine synchronization and one notification delivery
- [x] 5.2 Test unchanged/changed/missing alarms and service-worker restart recovery
- [x] 5.3 Run Jest detectOpenHandles and verify success, failure, timeout, and retry leave no timer handles
- [x] 5.4 Update lifecycle/error contract documentation and run unit tests plus strict OpenSpec validation

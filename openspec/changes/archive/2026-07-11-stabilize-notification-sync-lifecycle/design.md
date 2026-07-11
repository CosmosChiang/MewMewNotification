## Context

The MV3 service worker can be started by multiple extension events and may terminate between events. Current startup code recreates the alarm and also starts a direct check, while runtime messages and alarms can enter the same mutable synchronization path concurrently. Request timeouts use an uncancelled timer and do not abort fetch.

## Goals / Non-Goals

**Goals:**

- Guarantee at most one in-flight synchronization per service worker instance.
- Make alarm creation idempotent and event-driven.
- Abort timed-out requests and return a stable SyncResult to every caller.
- Persist rate-limit backoff that survives worker termination.

**Non-Goals:**

- This change does not add pagination or a lossless cursor.
- It does not redesign notification filtering or Popup presentation.

## Decisions

### D1: All triggers call one single-flight coordinator

Introduce `requestSync(trigger)` as the only entry point. If `checkPromise` exists, it returns that promise; otherwise it creates one and clears it in `finally`. Alarm, startup, Popup refresh and force refresh use this entry point. Force refresh may adjust pre-flight flags but MUST NOT start a second concurrent run.

### D2: Alarm setup is idempotent

`ensurePeriodicAlarm()` loads the current alarm and compares its period with settings. It creates or replaces the alarm only when missing or changed. Top-level worker code registers listeners and checks alarm existence but never performs an unconditional direct sync. Install/startup may request one sync through the single-flight coordinator.

### D3: Requests use AbortController and structured outcomes

Each fetch owns an AbortController and timeout ID. Timeout aborts the signal; `finally` clears the timer. `checkNotifications()` returns a SyncResult with status, freshness, timestamps, error code and retry metadata instead of swallowing errors. Runtime message handlers return the same result shape.

### D4: Long Retry-After uses persisted backoff alarm

Short waits that fit the worker-safe threshold may retry in-process. Longer waits persist retry count and next-attempt time, schedule a named one-shot alarm, and end the current run as `retryScheduled`. The maximum of three retries and 300-second cap remain.

## Risks / Trade-offs

- [Risk] Coalesced force refresh may not start immediately → it receives the current result and may schedule one follow-up only when explicit force semantics require it.
- [Risk] Alarm implementations differ by Chrome version → use existing supported API surface and test missing/delayed alarm cases.
- [Risk] Aborted writes may have completed server-side → mutation callers receive an `outcomeUnknown` code and must re-fetch before retrying.

## Migration Plan

No storage migration is required except versioned retry metadata. Deploy the new coordinator first, route every trigger through it, then remove direct `checkNotifications()` calls. Rollback ignores retry metadata safely.

## Open Questions

- The worker-safe threshold for in-process Retry-After will be a tested constant and can be revisited after browser telemetry.

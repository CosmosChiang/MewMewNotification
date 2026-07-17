## Purpose

Define deterministic synchronization lifecycle behavior, including concurrency, alarm management, network timeouts, and structured results.

## Requirements

### Requirement: Concurrent synchronization triggers are single flight
The extension MUST execute at most one notification synchronization at a time and MUST return the same in-flight result to overlapping alarm, startup, Popup, and manual refresh callers.

#### Scenario: Alarm and Popup refresh overlap
- **WHEN** an alarm and Popup refresh request synchronization before the first run completes
- **THEN** exactly one Redmine synchronization runs and both callers receive its SyncResult

#### Scenario: In-flight state clears after failure
- **WHEN** the active synchronization fails
- **THEN** the single-flight state is cleared in `finally` so a later trigger can start a new run

### Requirement: Periodic alarm management is idempotent
The extension MUST create or replace the periodic alarm only when it is missing or its configured period changed, and MUST NOT combine a zero-delay alarm with an unconditional direct synchronization.

#### Scenario: Worker starts with correct alarm
- **WHEN** the service worker starts and the existing alarm has the configured period
- **THEN** the alarm remains unchanged and no synchronization starts solely because module code loaded

#### Scenario: Check interval changes
- **WHEN** the user saves a different check interval
- **THEN** the extension replaces the alarm once with the new period

### Requirement: Network timeouts abort underlying requests
Every Redmine fetch MUST have an abort signal and MUST clear its timeout handle on success, failure, or abort.

#### Scenario: Request completes before timeout
- **WHEN** fetch completes before the deadline
- **THEN** its timer is cleared and no open timeout handle remains

#### Scenario: Request exceeds timeout
- **WHEN** fetch exceeds the configured deadline
- **THEN** the extension aborts the fetch and returns a stable timeout error code

### Requirement: Synchronization returns a structured result
Every synchronization caller MUST receive a SyncResult that distinguishes success, failure, stale cached data, scheduled retry, and unknown mutation outcome, including safe timestamps and error codes.

#### Scenario: Background catches an API failure
- **WHEN** Redmine synchronization fails
- **THEN** the runtime response reports failure and does not return an unconditional success flag

#### Scenario: Cached data remains available
- **WHEN** synchronization fails but retained history exists
- **THEN** SyncResult identifies the data as stale while allowing the caller to display it

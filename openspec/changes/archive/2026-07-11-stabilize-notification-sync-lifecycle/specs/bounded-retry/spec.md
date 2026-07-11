## MODIFIED Requirements

### Requirement: HTTP 429 retry attempts are bounded
Redmine requests MUST NOT retry more than `MAX_REQUEST_RETRIES` times (3). Retry count and next-attempt time MUST survive service-worker termination when the wait cannot safely complete in-process, and exceeding the limit MUST return a stable rate-limit error.

#### Scenario: First short Retry-After triggers an in-process retry
- **WHEN** a request receives HTTP 429 with a Retry-After within the worker-safe threshold and retry count is 0
- **THEN** the extension waits for the bounded duration and retries with count 1

#### Scenario: Long Retry-After schedules a retry alarm
- **WHEN** Retry-After exceeds the worker-safe in-process threshold
- **THEN** the extension persists retry metadata, schedules a one-shot alarm, and ends the current synchronization as `retryScheduled`

#### Scenario: Retry alarm resumes after worker restart
- **WHEN** the retry alarm fires after the original service worker terminated
- **THEN** the extension restores the persisted retry count and continues without resetting the limit

#### Scenario: Retry limit reached
- **WHEN** a request receives HTTP 429 after three retries
- **THEN** the extension makes no further request and returns the rate-limit retry-exceeded error

#### Scenario: Retry-After wait time is capped
- **WHEN** Retry-After exceeds 300 seconds
- **THEN** the persisted or in-process delay is capped at 300 seconds

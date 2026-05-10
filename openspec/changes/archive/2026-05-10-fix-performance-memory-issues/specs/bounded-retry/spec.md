## ADDED Requirements

### Requirement: HTTP 429 retry attempts are bounded
The `makeRequest()` method SHALL accept a `retryCount` parameter (default: 0) and MUST NOT retry more than `MAX_REQUEST_RETRIES` times (3). When the retry limit is exceeded, the method MUST throw an error instead of retrying.

#### Scenario: First 429 response triggers a retry
- **WHEN** `makeRequest()` receives a 429 response and `retryCount` is 0
- **THEN** the method waits for the `Retry-After` duration and retries with `retryCount = 1`

#### Scenario: Retry limit reached
- **WHEN** `makeRequest()` receives a 429 response and `retryCount` equals `MAX_REQUEST_RETRIES` (3)
- **THEN** the method throws an error indicating the retry limit was exceeded without making another request

#### Scenario: Retry-After wait time is capped
- **WHEN** the `Retry-After` header value exceeds 300 seconds
- **THEN** the method waits at most 300 seconds before retrying

#### Scenario: Callers without retryCount argument are not affected
- **WHEN** `makeRequest()` is called without the third argument
- **THEN** it behaves as if `retryCount = 0` (backward compatible default)

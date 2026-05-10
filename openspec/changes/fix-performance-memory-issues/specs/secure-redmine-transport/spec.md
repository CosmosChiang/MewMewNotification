## MODIFIED Requirements

### Requirement: Secure Redmine URL enforcement
The extension MUST require HTTPS for configured Redmine servers unless the URL
matches an explicitly supported development exception policy.

#### Scenario: Saving a standard Redmine URL
- **WHEN** a user saves a Redmine URL for a normal remote server
- **THEN** the extension only accepts the URL if it uses the `https` scheme

#### Scenario: Saving an insecure remote URL
- **WHEN** a user attempts to save a non-HTTPS Redmine URL for a non-development host
- **THEN** the extension rejects the configuration and shows a clear security error

### Requirement: Development exception handling is explicit
If the extension supports non-HTTPS Redmine URLs for development environments,
it MUST limit them to explicitly defined cases and present a clear warning
before those settings are accepted.

#### Scenario: Saving a development exception URL
- **WHEN** a user saves a Redmine URL that matches the allowed development exception policy
- **THEN** the extension shows a warning that the connection is insecure before accepting it

### Requirement: Rate-limited requests are retried with a bounded attempt count
When the Redmine server responds with HTTP 429, the extension SHALL wait for the
duration specified by the `Retry-After` header (capped at 300 seconds) and retry
the request. The extension MUST NOT retry more than `MAX_REQUEST_RETRIES` (3) times
for a single original request.

#### Scenario: Server rate-limits a request
- **WHEN** a Redmine API request receives a 429 response
- **THEN** the extension waits the prescribed time and retries automatically

#### Scenario: Server continues to rate-limit beyond the retry limit
- **WHEN** a Redmine API request receives a 429 response after `MAX_REQUEST_RETRIES` retries
- **THEN** the extension stops retrying and surfaces an error to the caller

## Purpose

Define structured, redacted, quiet-by-default runtime logging and the contract for opt-in diagnostic event sinks.

## Requirements

### Requirement: Runtime logging uses structured safe events
Runtime code MUST log stable event codes with allowlisted primitive metadata instead of arbitrary objects, request headers, server response bodies, issue content, or raw exception stacks.

#### Scenario: Redmine request fails
- **WHEN** transport receives an HTTP or network failure
- **THEN** logging receives a safe error code and permitted status metadata without the API key, full URL, response body, or issue data

### Requirement: Sensitive values are redacted before output
The logger MUST redact token-like strings, URL-like strings, server and profile identifiers, user or issue content, and raw error details before writing to the console or an event sink.

#### Scenario: Metadata contains sensitive test values
- **WHEN** a log call includes a token, host URL, profile ID, issue title, or response body
- **THEN** none of those original values appears in console output or the emitted structured event

### Requirement: Default logging is quiet
Production logging MUST suppress `debug` and `info` events by default and emit only sanitized warning and error events to the console.

#### Scenario: Normal synchronization succeeds
- **WHEN** diagnostic logging is disabled and a routine synchronization completes
- **THEN** no debug or informational console output is produced

### Requirement: Opt-in diagnostic sink receives only sanitized events
The logger MUST expose an injected debug-enabled predicate and event sink, and MUST send events to that sink only when debug diagnostics are enabled and after redaction.

#### Scenario: Diagnostic logging is disabled
- **WHEN** the predicate returns false
- **THEN** no event is sent to the diagnostic sink

#### Scenario: Diagnostic logging is enabled
- **WHEN** the predicate returns true
- **THEN** the sink receives a timestamped, schema-versioned, sanitized event containing only its level, code, and allowlisted metadata

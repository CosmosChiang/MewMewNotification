# Safe diagnostics

MewMewNotification diagnostics are a local, explicit opt-in troubleshooting aid. Detailed event retention is disabled by default, never uploads automatically, and does not require a downloads or clipboard permission.

## Local keys and retention

- `diagnosticsEnabledV1`: local boolean; an absent value means disabled.
- `diagnosticEventsV1`: local array of `DiagnosticEventV1`.
- Events are pruned during initialization, append, inspection, and export.
- Events older than seven days are removed and only the newest 100 are retained.
- Clear removes the event key without changing the enabled setting.
- Disable stores `false`, removes the event key immediately, and stops future capture.

`DiagnosticEventV1` has exactly `schemaVersion`, `timestamp`, `level`, `code`, and `metadata`. Metadata is limited to allowlisted operational booleans, finite numbers, and short sanitized strings.

## DiagnosticSnapshotV1

The `getDiagnostics` runtime action is available only to this extension. It accepts no storage key, domain, profile, or record selector and returns the following closed schema:

- `schemaVersion`, `generatedAt`
- `extension`: extension and manifest versions
- `configuration`: Redmine/API-key configured booleans and `http`/`https` transport scheme
- `permissions`: required permissions and configured-host access state
- `alarms`: periodic and retry alarm health
- `sync`: last success, stale state, safe error code, and bounded retry timing
- `schemas`: profile-state and diagnostic schema versions
- `profile`: active boolean and a 16-character locally bound SHA-256 server fingerprint
- `counts`: history, unread, issue-state, desktop-mapping, and retained-event counts
- `diagnostics`: enabled state, 100-event limit, and seven-day retention
- `events`: up to 100 sanitized events, or an empty array while retention is disabled

Known exported sync error codes are `missingRequiredSettings`, `syncFailed`, `rateLimited`, `rateLimitRetryExceeded`, `hostPermissionRequired`, `connectionTimeout`, and `networkError`. Any other non-empty value becomes `unknown`.

The fingerprint is derived from a versioned string containing the local credential binding and normalized server scope. Only the first 16 lowercase hexadecimal SHA-256 characters are exported. Credential rotation changes the fingerprint; neither source value is exported.

## Prohibited output

Final validation rejects additional fields, malformed types, oversized collections, unsafe timestamps, URLs, hostnames, token-like values, credentials, server scope, binding/profile identifiers, issue identifiers or titles, comments, project/user names, request headers, response bodies, and raw errors or stacks. Rejection returns `diagnosticsUnsafe` and creates no file.

## Support workflow

1. Reproduce the problem with diagnostics enabled only if event history is useful.
2. Open Options → About → Safe diagnostics.
3. Select **Export diagnostics**. One-time export also works while retention is disabled.
4. Open the downloaded JSON in a text editor.
5. Confirm that it contains only the categories listed above.
6. Search for your API key, Redmine hostname, issue title, user name, and any other identifying text.
7. Share the file only if you are comfortable with its timestamps, counts, and fingerprint.
8. Select **Clear diagnostics** or disable diagnostics when troubleshooting is complete.

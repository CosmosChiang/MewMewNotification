## Why

Users and maintainers can see only a small sync-health status when Redmine integration fails, while existing console logs are noisy and unsafe to share. The extension needs an explicit opt-in diagnostic path that captures enough structured state for troubleshooting without exporting credentials, server identity, issue content, or raw responses.

## What Changes

- Add an About-page switch for detailed diagnostics, disabled by default, plus actions to export and clear local diagnostic data.
- Retain at most 100 sanitized diagnostic events for seven days in local extension storage and delete them immediately when diagnostics is disabled.
- Add an internal `getDiagnostics` runtime action that returns a versioned, allowlisted `DiagnosticSnapshotV1`.
- Include extension version, permission state, alarm state, sync health, schema versions, safe counts, configuration booleans, transport scheme, a locally bound irreversible server fingerprint, and sanitized events.
- Reject snapshots containing prohibited field names or sensitive value patterns before returning or exporting them.
- Export formatted JSON with Blob and a temporary anchor without adding `downloads`, clipboard, or host permissions.
- Update the privacy policy to disclose opt-in local diagnostic retention and user-initiated export.

## Capabilities

### New Capabilities

- `sanitized-diagnostics`: Defines opt-in diagnostic retention, the snapshot schema and runtime action, prohibited content, local export, and deletion behavior.

### Modified Capabilities

- `extension-privacy-disclosure`: Requires the public and in-product privacy disclosures to cover local diagnostic events, retention, clearing, and user-controlled export.

## Impact

- Depends on `modularize-extension-runtime` for `SafeLogger` and its sanitized diagnostic event sink.
- Affects the Options About UI, localized messages, local storage, runtime router, profile repository reads, alarm and permission inspection, privacy documentation, tests, and package validation.
- Adds local keys `diagnosticsEnabledV1` and `diagnosticEventsV1` and internal runtime action `getDiagnostics`.
- Does not add telemetry, automatic upload, a backend service, new permissions, raw log export, or Redmine behavior changes.

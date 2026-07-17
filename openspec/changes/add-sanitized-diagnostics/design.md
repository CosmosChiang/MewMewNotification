## Context

The Popup exposes current sync health but does not provide a shareable troubleshooting artifact. Existing console output is unsuitable because it is noisy and can contain server-derived detail. The modular runtime change introduces `SafeLogger`, which emits only sanitized structured events to an injected sink when an injected predicate enables diagnostics.

This change is applied after `harden-extension-maintenance-baseline` and `modularize-extension-runtime`. It adds no remote service: all diagnostic state stays in `chrome.storage.local` until the user explicitly downloads a JSON file.

## Goals / Non-Goals

**Goals:**

- Make detailed diagnostic retention explicit, disabled by default, bounded, and easy to clear.
- Provide a stable allowlisted snapshot that helps diagnose permissions, alarms, synchronization, schema, and retained-state problems.
- Prevent secrets, server identity, Redmine content, and raw errors from entering the snapshot or export.
- Export locally without additional browser permissions.

**Non-Goals:**

- Telemetry, analytics, crash reporting, automatic upload, or a support backend.
- Exporting raw console logs, storage records, Redmine responses, or user content.
- Changing synchronization, retries, profile retention, permissions, or Redmine requests.
- Providing a general-purpose storage inspection runtime action.

## Decisions

### Use two local-only versioned keys

- `diagnosticsEnabledV1`: boolean, absent means false.
- `diagnosticEventsV1`: array of `DiagnosticEventV1`.

`DiagnosticEventV1` contains only:

```text
schemaVersion, timestamp, level, code, metadata
```

`metadata` is an allowlisted map of safe primitive values produced by `SafeLogger`. Events older than seven days are removed, and only the newest 100 events remain. Pruning occurs on initialization, append, snapshot creation, and export. Writes are serialized to avoid concurrent append loss.

Disabling diagnostics writes `false` and immediately removes the event key. Clearing events removes the event key without changing whether future capture is enabled.

Alternative considered: retain events while disabled. This is surprising for a privacy control, so disabling is destructive by design.

### Allow snapshot export even when retention is disabled

The user can export a current health snapshot at any time. When detailed diagnostics is disabled, `events` is empty and no background events are retained. This separates one-time troubleshooting from ongoing opt-in capture.

### Define an explicit DiagnosticSnapshotV1 allowlist

The internal `getDiagnostics` action returns:

```text
schemaVersion
generatedAt
extension { version, manifestVersion }
configuration { redmineConfigured, apiKeyConfigured, transportScheme }
permissions { required, configuredHostAccessGranted }
alarms {
  periodic { exists, periodMinutes }
  retry { exists, scheduledAt }
}
sync {
  lastSuccessAt, stale, lastErrorCode,
  retryScheduled, nextRetryAt
}
schemas { profileState, diagnostics }
profile { active, serverFingerprint }
counts {
  history, unread, issueStates,
  desktopMappings, retainedEvents
}
diagnostics { enabled, maxEvents, retentionDays }
events
```

Timestamps use ISO 8601 UTC. Missing values are `null`; counts are non-negative integers. `lastErrorCode` is selected from known safe codes, with unrecognized values mapped to `unknown`.

The snapshot builder reads only required fields through repository methods. It does not copy storage objects and then redact them.

### Bind the server fingerprint to this local installation

When an active profile exists, `serverFingerprint` is the first 16 lowercase hexadecimal characters of SHA-256 over a versioned string containing the local credential binding ID and normalized server scope. The binding ID and server scope are never exported. This gives support a stable per-device correlation value without exposing the hostname or allowing straightforward hostname dictionary matching.

No active profile produces `null`.

### Validate the final snapshot before response and export

A recursive validator enforces the exact schema, permitted types, maximum collection sizes, and prohibited field/value rules. It rejects key names or values representing API keys, tokens, full URLs, hostnames, server scopes, issue IDs or titles, project/user names, response bodies, request headers, or raw errors/stacks.

Validation failure returns a stable `diagnosticsUnsafe` error, records no rejected value, and prevents file creation.

Alternative considered: recursively redact arbitrary state. Allowlist construction plus rejection is safer because newly added runtime fields cannot silently enter exports.

### Restrict the runtime action to this extension

`getDiagnostics` is registered in the modular runtime router and accepts no user-supplied selectors or storage keys. The router verifies `sender.id === chrome.runtime.id`; unauthorized callers receive `unauthorizedDiagnostics`.

### Export with page-native APIs

Options requests the snapshot, validates the success envelope, serializes it with two-space JSON indentation, creates an `application/json` Blob, triggers a temporary `<a download>`, and revokes the object URL. The UTC filename is `mewmew-diagnostics-YYYYMMDD-HHmmss.json`.

No `downloads`, clipboard, or new host permission is needed.

## Risks / Trade-offs

- [Counts and timestamps still reveal usage characteristics] → Make retention opt-in, disclose the exact fields, and let users inspect the JSON before sharing.
- [Fingerprint could become a tracking identifier] → Bind it to a local credential generation, truncate it, never upload automatically, and regenerate it when credentials rotate.
- [Diagnostics writes increase storage activity] → Limit capture to opt-in mode, serialize writes, and cap retention at 100 events for seven days.
- [A future field leaks sensitive data] → Use a closed schema and final recursive rejection rather than best-effort redaction.
- [Runtime action exposes internal state] → Restrict it to same-extension senders and return only aggregated fields.

## Migration Plan

1. Confirm the maintenance and modular runtime changes are applied and their specs are canonical.
2. Add diagnostic event storage, pruning, and logger sink integration.
3. Add snapshot builder, fingerprint generation, validator, and internal router action.
4. Add localized Options controls and Blob export.
5. Update the privacy policy and diagnostic documentation.
6. Run prohibited-value, retention, runtime authorization, UI, smoke, package, and OpenSpec tests.

Rollback removes the UI and runtime action and deletes both diagnostic keys. No profile or notification state migration is required.

## Open Questions

None.

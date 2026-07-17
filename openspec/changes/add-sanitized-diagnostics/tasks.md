## 1. Diagnostic Event Storage

- [x] 1.1 Confirm `harden-extension-maintenance-baseline` and `modularize-extension-runtime` are applied and their required capability specs are canonical.
- [x] 1.2 Implement a side-effect-free diagnostic event store for `diagnosticsEnabledV1` and `diagnosticEventsV1` with serialized local writes.
- [x] 1.3 Implement seven-day pruning, newest-100 retention, default-disabled behavior, clear-without-disable, and destructive disable behavior.
- [x] 1.4 Connect `SafeLogger` to the store through its injected predicate and sanitized event sink without retaining events while disabled.
- [x] 1.5 Add event-store tests for missing settings, concurrent appends, limits, expiry boundaries, clearing, disabling, and local-only storage.

## 2. Safe Snapshot and Runtime Interface

- [x] 2.1 Implement `DiagnosticSnapshotV1` construction from explicit manifest, configuration, permission, alarm, sync-health, schema, profile, count, and event repository methods.
- [x] 2.2 Implement the locally bound SHA-256 server fingerprint and verify credential rotation changes it without exporting its inputs.
- [x] 2.3 Implement closed-schema validation for required fields, types, timestamps, counts, event limits, safe error codes, and prohibited keys or values.
- [x] 2.4 Add `getDiagnostics` to the runtime action constants and router with same-extension sender validation and no caller-selected storage input.
- [x] 2.5 Map unsafe output and unauthorized access to `diagnosticsUnsafe` and `unauthorizedDiagnostics` without logging rejected values.
- [x] 2.6 Add snapshot and router tests using seeded API keys, URLs, hosts, profile IDs, issue content, response bodies, headers, and raw errors to prove none can escape.

## 3. Options Controls and Export

- [x] 3.1 Add localized About-page controls and explanations for enabling, exporting, and clearing diagnostics in all four locales.
- [x] 3.2 Load and persist the local enabled state, delete retained events when disabled, and provide visible localized success or failure states.
- [x] 3.3 Implement `getDiagnostics` request handling and export validated snapshots as two-space JSON using Blob and a temporary anchor.
- [x] 3.4 Generate the UTC `mewmew-diagnostics-YYYYMMDD-HHmmss.json` filename and always revoke the temporary object URL.
- [x] 3.5 Add Options tests for default-off display, opt-in, destructive disable, clear behavior, disabled one-time export, successful download, and rejected export.

## 4. Privacy, Packaging, and Documentation

- [x] 4.1 Update the public privacy policy and in-product disclosure with diagnostic fields, opt-in behavior, local retention, clearing, export, and no-upload statements.
- [x] 4.2 Document the snapshot schema, safe event codes, retention, support workflow, and a user checklist for reviewing JSON before sharing.
- [x] 4.3 Update the package allowlist and validators for new diagnostic modules while confirming no `downloads`, clipboard, or additional host permission is added.
- [x] 4.4 Extend locale and privacy-link validation for all new messages and diagnostic disclosures.

## 5. Final Verification

- [x] 5.1 Run diagnostic unit tests, full Jest coverage, Fake Redmine integration, and Chromium smoke tests with diagnostics both disabled and enabled.
- [x] 5.2 Inspect an exported fixture and run automated forbidden-key/value scans proving that credentials, server identity, Redmine content, and raw errors are absent.
- [x] 5.3 Run lint, locale parity, strict OpenSpec, Web Store asset, package, version, checksum, permission, moderate audit, and `git diff --check` validation.

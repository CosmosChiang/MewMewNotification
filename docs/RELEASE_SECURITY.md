# Release and Supply-Chain Security

## Baseline and remediation

Before dependency cleanup, the repository had 127 tests and package metadata reported 437 production dependency entries. The audit contained 14 findings: 10 low, 2 moderate, 2 high, and 0 critical. The extension itself uses no npm runtime package.

The restored toolchain has zero production dependencies and only direct development tools for Jest, coverage instrumentation, ESLint, locale/workflow validation, packaging, OpenSpec, and Playwright. The blocking `npm run audit:moderate` gate reports zero moderate, high, or critical findings.

## Required gates

Node 22 and 24 run lint, locale parity, workflow policy, controller-instrumented unit coverage, audit, and strict OpenSpec validation. Node 24 additionally runs the fake Redmine integration layer, packaged unpacked-Chromium smoke test, version check, deterministic allowlist packaging, and ZIP validation.

All workflow Actions are pinned to full commit SHAs. Dependabot proposes npm and GitHub Actions updates weekly. Top-level workflow permission is read-only; release write and attestation permissions are scoped to their jobs.

## Superseded dependency pull requests

This feature change incorporates and verifies the intended `adm-zip` and `js-yaml` upgrades from Dependabot PRs #12 and #13 on the current codebase. After the feature PR merges, close #12 and #13 as superseded and link the merged feature PR; do not merge their stale branch bases independently.

## Artifact identity

`tools/package-extension.js` is the only packaging implementation. The PowerShell helper delegates to it. `tools/package-allowlist.json` is the versioned source for exact archive entries. Tests, docs, credentials, `node_modules`, workspace metadata, and unexpected files are rejected.

Release tags must equal `v<manifest version>`, and `package.json` must have the same version. Each ZIP receives a SHA-256 checksum and GitHub build-provenance attestation before the release job publishes it.

## Temporary security exception schema

No exception is currently active. If a blocking finding cannot be immediately remediated, a reviewed exception record must contain:

- owner and approval date;
- exact dependency/advisory or workflow scope;
- rationale and user impact;
- compensating controls and verification evidence;
- expiry date no more than 30 days away;
- removal issue and status.

Expired or incomplete exceptions never bypass CI. Exceptions must not permit runtime dependencies or secrets in the extension package.

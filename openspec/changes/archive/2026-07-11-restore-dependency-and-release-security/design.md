## Context

The extension ships plain JavaScript and no node_modules, yet package.json lists nearly the entire Jest/jsdom tree as production dependencies. The current audit gate fails, CI tests EOL Node versions, coverage excludes the main controllers, and release artifacts are built from duplicated file lists without immutable Action references or version/provenance gates.

## Goals / Non-Goals

**Goals:**

- Restore a minimal, auditable development dependency graph.
- Make CI quality and security gates reflect the actual extension surface.
- Produce one reproducible, version-consistent and verifiable release artifact.

**Non-Goals:**

- This change does not automatically publish a production Chrome Web Store release.
- It does not rewrite application modules except where needed for testability.
- It does not require runtime npm packages in the extension ZIP.

## Decisions

### D1: Runtime dependencies are zero

Rebuild package.json from actual direct tools. Jest, js-yaml, ESLint and browser-test tooling live in devDependencies; transitive packages are controlled only by the lockfile. Upgrade Jest/tooling as a coordinated change and remove obsolete overrides once audit is clean.

### D2: CI uses supported Node and layered tests

Use Node 22 and 24 for unit/quality compatibility, with Node 24 as the packaging runtime. Gates run lint, locale parity, unit coverage across background/options/popup/shared, fake Redmine integration, unpacked Chromium smoke, audit and OpenSpec strict validation. Coverage upload failure is blocking when configured.

### D3: GitHub Actions are immutable inputs

Every `uses:` reference is pinned to a full commit SHA with a version comment. Dependabot updates the SHA. Release write permission remains job-scoped; third-party release logic is minimized, preferring preinstalled GitHub CLI where practical.

### D4: One cross-platform packaging implementation

Create a cross-platform Node packaging tool with one versioned allowlist; the PowerShell helper delegates to it. CI calls the same tool, validates exact ZIP entries, and never packages workspace metadata, tests, credentials or node_modules.

### D5: Release identity and provenance are mandatory

For tag releases, tag must equal `v${manifest.version}` and package version must match manifest. CI emits the ZIP, SHA-256 checksum, dependency snapshot/SBOM where available, and GitHub artifact attestation. A mismatch fails before release creation.

## Risks / Trade-offs

- [Risk] Jest/toolchain major upgrades expose brittle tests → migrate in small commits while preserving the 127-test baseline and add controller instrumentation before raising thresholds.
- [Risk] SHA pins require maintenance → Dependabot provides reviewed update PRs.
- [Risk] Chromium smoke tests add CI time → keep one focused install/options/popup/permission smoke job and cache browser binaries safely.

## Migration Plan

1. Snapshot current tests/audit/package contents.
2. Rebuild devDependencies and upgrade test/lint tooling.
3. Add layered gates and repair current OpenSpec Purpose sections.
4. Introduce single packaging tool, version checks and ZIP inspection.
5. Pin Actions and add checksum/attestation to tag release.
6. Rollback can restore the old lockfile/workflow; released artifacts remain independently verifiable.

## Open Questions

- Production Web Store upload credentials and approval belong to a later dedicated change.

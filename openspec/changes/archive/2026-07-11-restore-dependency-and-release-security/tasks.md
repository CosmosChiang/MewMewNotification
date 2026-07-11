## 1. Dependency and Toolchain Baseline

- [x] 1.1 Record the current 127-test baseline, audit findings, package contents, and required direct tools
- [x] 1.2 Rebuild package.json with zero runtime dependencies and only actual devDependencies
- [x] 1.3 Upgrade Jest/jsdom-related tooling and remove obsolete overrides while preserving behavior
- [x] 1.4 Add ESLint configuration and scripts compatible with Node 22/24

## 2. Test and Quality Layers

- [x] 2.1 Instrument background, options, popup, and shared sources in coverage and enforce required thresholds
- [x] 2.2 Add locale key parity and workflow-policy validation as blocking checks
- [x] 2.3 Add fake Redmine integration tests for HTTP, pagination, errors, and mutations
- [x] 2.4 Add focused unpacked Chromium smoke tests for install, Options, Popup, permissions, and packaging

## 3. CI and Supply-Chain Security

- [x] 3.1 Replace Node 18/20 with Node 22/24 and use Node 24 for packaging
- [x] 3.2 Run lint, locale, unit, integration, smoke, audit, OpenSpec strict, and package validation in CI
- [x] 3.3 Pin every GitHub Action to a full commit SHA with version comments and configure Dependabot updates
- [x] 3.4 Keep release write permission job-scoped and document any time-bounded security exception schema

## 4. Reproducible Packaging and Release

- [x] 4.1 Create one cross-platform packaging implementation and allowlist used by local and CI workflows
- [x] 4.2 Validate exact ZIP entries and reject node_modules, workspace metadata, tests, docs, secrets, and unexpected files
- [x] 4.3 Enforce tag/manifest/package version parity before release creation
- [x] 4.4 Generate and publish SHA-256 checksum and artifact provenance/attestation for release ZIPs

## 5. Spec, Documentation, and Final Gates

- [x] 5.1 Add missing Purpose sections and align current CI/security/test specs with actual policy
- [x] 5.2 Consolidate CI, packaging, release, license, and security documentation into accurate sources
- [x] 5.3 Verify npm audit high is zero, all 127 baseline tests plus new layers pass, and workflow helper remains valid
- [x] 5.4 Run strict OpenSpec validation for all current specs and the change before release

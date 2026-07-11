## Why

At the moment, the package manifest incorrectly lists many transitive testing tools as production dependencies, and `npm audit --audit-level=high` is already failing. CI still uses end-of-life Node, does not run lint, coverage does not include the main controllers, and the release Action and version/artifact flow are missing immutability and consistency checks. These gaps block reliable releases and increase supply-chain risk.

## What Changes

- Reduce extension runtime dependencies to zero, keep only the devDependencies that are actually needed, and upgrade Jest/toolchain.
- Move CI to supported Node 22 and 24, and add lint, locale parity, full controller coverage, a fake Redmine integration test, and an unpacked Chromium smoke test.
- Pin every GitHub Action to a full commit SHA and create a maintainable update strategy.
- Enforce version consistency across the tag, `manifest.json`, and `package.json`, and unify the allowlist packaging entry point for local and CI runs.
- Attach a SHA-256 checksum and verifiable provenance/attestation to release artifacts.
- Fix the existing OpenSpec structure and CI/test docs so strict validation matches the real workflow.

## Capabilities

### New Capabilities

- `release-artifact-integrity`: Defines version consistency, a single packaging entry point, artifact allowlists, checksums, and provenance verification.

### Modified Capabilities

- `extension-security-maintenance`: Dependency vulnerabilities, Action references, EOL runtimes, and security exceptions must be managed by blocking gates.
- `ci-cd-pipeline-enhancement`: CI must run lint, tests, integration/smoke, audit, packaging, and release gates on supported Node versions.
- `unit-test-structure`: Coverage must include background, options, popup, and shared modules, and must add real Chrome and fake Redmine boundary tests.

## Impact

This primarily affects `package.json`, `package-lock.json`, the Jest and ESLint configuration, `.github/workflows/ci.yml`, `tools/package-extension.ps1`, the workflow validator, the current OpenSpec specs, and the CI documentation. It should be implementable independently of product features, but it becomes the merge and release gate for them.

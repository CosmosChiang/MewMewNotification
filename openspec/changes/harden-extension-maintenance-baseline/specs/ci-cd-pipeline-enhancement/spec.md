## MODIFIED Requirements

### Requirement: CI/CD 流程自動化與穩定性
CI/CD pipeline MUST install dependencies reproducibly and execute lint, locale validation, workflow validation, unit tests, OpenSpec validation, integration tests, Chromium smoke tests, dependency auditing, and package validation using supported Node.js versions.

#### Scenario: 多版本品質驗證
- **WHEN** quality jobs run for a pull request or main-branch push
- **THEN** Node.js 22.x and 24.x both pass lint, locale, workflow, unit-test, moderate dependency-audit, and OpenSpec gates

#### Scenario: 整合與封裝驗證
- **WHEN** quality jobs succeed
- **THEN** the pipeline runs Fake Redmine integration tests, packages the extension, loads it in Chromium, and verifies the approved package contents

### Requirement: 覆蓋率報告自動上傳
CI/CD pipeline SHALL generate coverage for the supported controller and shared-module test scope and SHALL upload it from the designated Node.js job when the configured coverage credential is available.

#### Scenario: Coverage credential is configured
- **WHEN** the designated coverage job completes and its upload credential is present
- **THEN** the pipeline uploads `coverage/lcov.info` and treats an upload failure as a job failure

#### Scenario: Coverage credential is unavailable
- **WHEN** the coverage credential is absent
- **THEN** the upload step is skipped without failing otherwise valid quality jobs

### Requirement: 發佈流程自動化
The pipeline MUST create a validated installable package for main-branch pushes and pull requests, and MUST publish a GitHub Release only for a pushed `v*` tag whose version identity and checksum are valid.

#### Scenario: Main branch or pull request build
- **WHEN** package prerequisites pass without a release tag
- **THEN** the pipeline uploads the validated package artifact but does not publish a GitHub Release

#### Scenario: Version tag push
- **WHEN** a valid `v*` tag is pushed
- **THEN** the pipeline verifies tag, manifest, package version, and checksum before publishing the ZIP and checksum as a GitHub Release

## ADDED Requirements

### Requirement: Moderate dependency findings block CI
The quality workflow MUST run `npm audit --audit-level=moderate` against the locked development dependency tree.

#### Scenario: Moderate finding is present
- **WHEN** npm reports an unresolved moderate, high, or critical advisory
- **THEN** the quality workflow fails before integration and packaging jobs run

#### Scenario: Audit is clean at the threshold
- **WHEN** no moderate-or-higher advisory exists
- **THEN** dependency validation passes and downstream jobs may proceed

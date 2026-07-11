## MODIFIED Requirements

### Requirement: CI/CD 流程自動化與穩定性
CI/CD pipeline MUST 在受支援的 Node 22 與 24 上執行 dependency install、lint、locale parity、unit/integration tests、coverage、audit、OpenSpec strict validation、build 與 package validation；tag release 另 MUST 通過 version 與 artifact integrity gates。

#### Scenario: Pull request validation
- **WHEN** pull request targeting main 執行 pipeline
- **THEN** Node 22/24 quality and test gates、audit、OpenSpec validation 與 packaging smoke 全部必須通過

#### Scenario: Unsupported Node appears in matrix
- **WHEN** workflow 包含 upstream EOL Node version
- **THEN** CI policy validation fails

#### Scenario: Tag release validation
- **WHEN** `v*` tag 觸發 release
- **THEN** pipeline verifies versions、ZIP allowlist、checksum 與 provenance before publishing

### Requirement: 覆蓋率報告自動上傳
CI/CD pipeline SHALL 產生涵蓋 background、options、popup 與 shared modules 的 coverage report，MUST enforce configured thresholds，並 SHALL upload the report using a blocking configured integration.

#### Scenario: Coverage below threshold
- **WHEN** 任一 required global or critical-module threshold 未達標
- **THEN** pipeline fails before packaging

#### Scenario: Coverage upload fails
- **WHEN** coverage upload is configured and the provider rejects the report
- **THEN** the reporting step fails visibly instead of silently succeeding

### Requirement: 發佈流程自動化
Only a validated version tag MUST create a GitHub release, and the release MUST contain the approved ZIP, checksum, and provenance while production store publication remains separately approved.

#### Scenario: Main branch push
- **WHEN** main branch receives a normal push without a version tag
- **THEN** pipeline validates and uploads a temporary build artifact but does not create a versioned release

#### Scenario: Valid version tag
- **WHEN** a matching version tag passes all gates
- **THEN** pipeline creates the GitHub release with verifiable artifacts

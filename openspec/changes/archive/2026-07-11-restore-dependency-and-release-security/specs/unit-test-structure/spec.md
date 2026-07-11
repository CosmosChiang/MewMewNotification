## MODIFIED Requirements

### Requirement: 統一單元測試結構
Tests SHALL use explicit unit、integration、and extension-smoke layers with deterministic naming and fixtures. Each production module change MUST add or update the corresponding layer needed to validate its boundary.

#### Scenario: 新增純邏輯模組
- **WHEN** a new testable module is added
- **THEN** a colocated or mapped `.test.js` unit test is added

#### Scenario: 新增 Chrome/Redmine 邊界行為
- **WHEN** behavior depends on Chrome lifecycle, storage, permissions, or Redmine HTTP contracts
- **THEN** the change adds an integration or unpacked-extension smoke test instead of relying only on loose mocks

### Requirement: 提升測試覆蓋率
Coverage MUST instrument background、options、popup and shared production sources, enforce at least the configured global baseline, and publish per-module results without excluding controllers through raw VM loading.

#### Scenario: 覆蓋率檢查
- **WHEN** CI runs the unit coverage job
- **THEN** the report lists every required production source and fails if thresholds are not met

#### Scenario: Controller is omitted
- **WHEN** background、options or popup is absent from instrumentation
- **THEN** coverage validation fails even if the remaining files exceed the numeric threshold

### Requirement: 優化 CI/CD 流程
CI/CD MUST run unit tests, fake Redmine integration tests, and a focused unpacked Chromium smoke test on supported runtimes before releasing.

#### Scenario: PR 或 main push
- **WHEN** CI is triggered for a code change
- **THEN** all required test layers run and produce independently visible results

#### Scenario: Extension smoke fails
- **WHEN** Chromium cannot load the packaged extension or its Popup/Options entry point
- **THEN** packaging and release are blocked

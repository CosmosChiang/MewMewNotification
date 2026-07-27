## MODIFIED Requirements

### Requirement: 統一單元測試結構
All production modules MUST have colocated `.test.js` coverage under `scripts/` or its subdirectories, and tests MUST import the target module without executing unrelated extension bootstrap behavior.

#### Scenario: 新增模組測試
- **WHEN** a runtime or shared module is added
- **THEN** a corresponding `.test.js` file covers its public behavior, failure paths, and import-time side-effect contract

### Requirement: 提升測試覆蓋率
All major production modules MUST have positive and failure-path tests. Newly extracted pure or dependency-injected modules MUST maintain at least 90% line and function coverage and 85% branch coverage, while the complete measured production surface MUST maintain at least 65% global line, statement, function, and branch coverage.

#### Scenario: 覆蓋率檢查
- **WHEN** CI executes the full unit-test suite
- **THEN** it fails if any new-module threshold or the 65% global threshold is not met

## ADDED Requirements

### Requirement: Fake Redmine integration tests load only transport code
Fake Redmine integration tests MUST import the Redmine API module directly and MUST NOT evaluate or initialize the complete extension service worker.

#### Scenario: Integration suite starts
- **WHEN** the Fake Redmine tests load their subject
- **THEN** no NotificationManager, locale fetch, alarm repair, Chrome listener, or background storage preload is started

### Requirement: Passing integration tests have clean runtime output
Expected integration scenarios MUST complete without unexpected `console.error`, missing-Chrome errors, invalid locale URL errors, open handles, or bootstrap warnings.

#### Scenario: Successful and expected-failure cases run
- **WHEN** the Fake Redmine integration suite executes its pagination, mutation, and authentication scenarios
- **THEN** all assertions pass and only explicitly asserted safe logger events may be emitted

## Purpose

Define deterministic test organization, coverage expectations, and CI execution for the extension's production surfaces.

## Requirements

### Requirement: 統一單元測試結構
All production modules MUST have colocated `.test.js` coverage under `scripts/` or its subdirectories, and tests MUST import the target module without executing unrelated extension bootstrap behavior.

#### Scenario: 新增模組測試
- **WHEN** 新增模組時
- **THEN** a corresponding `.test.js` file covers its public behavior, failure paths, and import-time side-effect contract

### Requirement: 提升測試覆蓋率
All major production modules MUST have positive and failure-path tests. Newly extracted pure or dependency-injected modules MUST maintain at least 90% line and function coverage and 85% branch coverage, while the complete measured production surface MUST maintain at least 65% global line, statement, function, and branch coverage.

#### Scenario: 覆蓋率檢查
- **WHEN** 執行 CI/CD 時
- **THEN** it fails if any new-module threshold or the 65% global threshold is not met

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

### Requirement: 優化 CI/CD 流程
CI/CD 流程 SHALL 自動執行 lint、單元測試、建構、發佈，並支援多 Node 版本。

#### Scenario: PR 或 main push
- **WHEN** PR 或 main branch push
- **THEN** 自動執行完整 CI/CD 流程並產生覆蓋率報告

### Requirement: 文件同步維護
所有測試與 CI/CD 相關規範 MUST 同步更新於 README、Task.md 等文件。

#### Scenario: 規範調整
- **WHEN** 測試或 CI/CD 流程有異動
- **THEN** 文件需同步更新

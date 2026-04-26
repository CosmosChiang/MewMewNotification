## ADDED Requirements

### Requirement: CI/CD 流程自動化與穩定性
CI/CD pipeline MUST 自動執行依賴安裝、lint、單元測試、建構、發佈，並於多 Node 版本下驗證通過。

#### Scenario: 多版本驗證
- **WHEN** CI/CD pipeline 執行時
- **THEN** 於 Node 18.x、20.x 下皆須通過所有測試

### Requirement: 覆蓋率報告自動上傳
CI/CD pipeline SHALL 自動產生並上傳測試覆蓋率報告（如 Codecov）。

#### Scenario: pipeline 執行
- **WHEN** pipeline 執行結束
- **THEN** 自動上傳覆蓋率報告

### Requirement: 發佈流程自動化
main branch push 時，pipeline MUST 自動產生可安裝套件並發佈。

#### Scenario: main branch push
- **WHEN** main branch push
- **THEN** pipeline 自動產生並上傳發佈檔案

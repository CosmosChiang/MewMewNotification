## Why

目前專案單元測試與 CI/CD 流程雖已初步建置，但測試覆蓋率、結構規範與自動化流程仍有優化空間。隨著功能增多，需提升測試品質與自動化穩定性，以確保未來維護與擴充。

## What Changes

- 強化單元測試結構與覆蓋率，補齊現有模組測試
- 統一測試檔案命名與目錄規範（如 scripts/*.test.js）
- 完善 Jest 設定與 scripts，確保本地與 CI 一致
- 優化 GitHub Actions CI/CD 流程，涵蓋多 Node 版本、建構、發佈
- 增加測試覆蓋率報告與自動上傳（如 Codecov）
- 文件同步更新，說明測試與 CI/CD 流程

## Capabilities

### New Capabilities
- `unit-test-structure`: 統一並強化單元測試結構與規範
- `ci-cd-pipeline-enhancement`: 優化並自動化 CI/CD 流程，提升穩定性與可維護性

### Modified Capabilities


## Impact

- scripts/ 及其子目錄下所有模組
- 測試相關設定檔（jest.config.js、package.json scripts 等）
- .github/workflows/ci.yml
- README、Task.md、CI/CD/測試相關文件

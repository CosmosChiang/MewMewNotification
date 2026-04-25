## Context

目前專案已具備基本單元測試與 CI/CD 流程，但測試覆蓋率、結構規範與自動化流程尚有優化空間。隨著功能增多，維護與擴充的需求提升，需強化測試品質與自動化穩定性。

## Goals / Non-Goals

**Goals:**
- 統一並強化單元測試結構與規範
- 提升測試覆蓋率，補齊現有模組測試
- 優化並自動化 CI/CD 流程，提升穩定性與可維護性
- 文件同步更新，說明測試與 CI/CD 流程

**Non-Goals:**
- 不涉及功能層面大幅重構
- 不更動現有業務邏輯

## Decisions

- 採用 Jest 作為單元測試框架，統一測試檔案命名與目錄（scripts/*.test.js）
- CI/CD 採用 GitHub Actions，涵蓋多 Node 版本、建構、發佈
- 測試覆蓋率報告自動上傳至 Codecov
- 文件與 Task.md、README 同步維護

## Risks / Trade-offs

- [風險] 測試補齊過程可能遇到 legacy code 難以覆蓋 → 逐步重構並以 wrapper 增加可測性
- [風險] CI/CD 流程優化需兼容現有部署 → 先於分支測試再合併

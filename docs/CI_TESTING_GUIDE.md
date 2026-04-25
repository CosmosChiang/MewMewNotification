## GitHub Actions 工作流程

### 自動化流程概述

CI/CD 會在 `main` 分支的 push、對 `main` 的 Pull Request，以及手動觸發時執行。整體流程包含測試、建構、覆蓋率上傳與 release 自動化。

### 工作流程階段

#### 測試階段 (`test` job)

- 使用 Node.js `18.x` 與 `20.x` matrix
- 執行 `npm ci`
- 執行 `npm run lint --if-present`
- 執行 `npm run test:ci`
- 僅在 Node.js `20.x` 上傳 `coverage/lcov.info` 到 Codecov

#### 建構階段 (`build` job)

- 驗證 workflow helper：`node validate-workflow.js`
- 執行 `npm run build`
- 驗證 `manifest.json`
- 產生可安裝 ZIP 檔
- 上傳 build artifact

#### 發布階段 (`release` job)

- 僅在 `main` 分支 push 時執行
- 下載 build artifact
- 讀取 `manifest.json` 版本
- 建立 GitHub Release 並附上 ZIP 檔

## 本地測試命令

```bash
# 標準測試流程（含覆蓋率）
npm test

# 較快的本地測試流程
npm run test:local

# CI 對齊測試流程
npm run test:ci

# 重新產生覆蓋率報告
npm run test:coverage
```

## 測試配置與覆蓋範圍

### 測試配置文件

- `jest.config.js`：標準測試與覆蓋率設定
- `jest.ci.config.js`：CI 專用設定
- `jest.lite.config.js`：較快的本地測試設定
- `test-setup.js`：Chrome API、fetch、alert/confirm 與基本 DOM mock

### 已覆蓋的模組

- `scripts/shared/config-manager.js`
- `scripts/shared/i18n.js`
- `scripts/options.js`
- `scripts/popup.js`

### 測試策略

- 共用模組使用較完整的單元測試與覆蓋率門檻
- UI controller 以實際原始碼的 smoke/unit tests 驗證核心流程
- 所有測試檔統一使用 `.test.js` 命名
- 預設採單執行緒 (`--runInBand`) 降低記憶體壓力

## 覆蓋率門檻

- 全域 coverage threshold：`80%`
- `scripts/shared/config-manager.js`：
  - branches：`90%`
  - functions：`100%`
  - lines：`90%`
  - statements：`90%`

## 故障排除

### 常見問題

1. 覆蓋率不達標：先檢查 `coverage` 輸出與 `jest.ci.config.js`
2. Chrome API mock 異常：檢查 `test-setup.js` 與個別測試檔的 mock
3. CI 上傳 coverage 失敗：確認 `CODECOV_TOKEN` 與 `coverage/lcov.info`

### 本地調試

```bash
# 驗證 workflow helper
node validate-workflow.js

# 用 CI 設定執行詳細測試輸出
npm run test:ci -- --verbose
```

此文件應與 README、workflow 與實際測試配置同步維護。

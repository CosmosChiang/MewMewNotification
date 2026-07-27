## GitHub Actions 工作流程

### 自動化流程概述

CI/CD 會在 `main` 分支的 push、對 `main` 的 Pull Request，以及手動觸發時執行。整體流程包含測試、驗證、擴充功能打包，以及在推送 `v*` tag 時自動建立 GitHub Release。

### 工作流程階段

#### 品質階段 (`quality` job)

- 使用 Node.js `22.x` 與 `24.x` matrix
- 執行 `npm ci --ignore-scripts`
- 兩個 Node.js 版本都執行 `npm run audit:moderate`
- 執行 `npm run test:ci`
- 僅在 Node.js `24.x` 且設定 token 時上傳 `coverage/lcov.info` 到 Codecov

#### 整合與打包階段 (`integration` / `package` jobs)

- 驗證 workflow helper：`node validate-workflow.js`
- 執行 `npm run build`（目前為 Chrome extension 專案的 no-op build hook）
- 驗證 `manifest.json`
- 僅將擴充功能執行所需檔案打包成可安裝 ZIP 檔
- 上傳 build artifact

#### 發布階段 (`release` job)

- 僅在推送 `v*` tag 時執行
- 下載 build artifact
- 讀取 `manifest.json` 版本
- 使用目前推送的 tag 建立 GitHub Release 並附上 ZIP 檔

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

# 檢查 moderate / high / critical 依賴漏洞
npm run audit:moderate
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

## 依賴安全門檻

- CI 以 `npm audit --audit-level=moderate` 作為阻擋門檻
- 目前鎖定依賴樹在此門檻下必須為零項漏洞
- 若未來無法立即修復，例外必須依 `docs/RELEASE_SECURITY.md` 記錄負責人、範圍、補償控制與最長 30 天期限

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

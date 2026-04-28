## Why

目前專案已經有基本的輸入驗證與 CSP 保護，但仍存在幾個實際的資安風險：
Redmine API Key 可能透過 HTTP 明文傳輸、API Key 目前儲存在
`chrome.storage.sync`、擴充功能要求過寬的 host permissions，且相依套件也有已知漏洞。
這些問題會直接影響憑證保護、最小權限原則與供應鏈安全，應優先整理並修正。

## What Changes

- 強化 Redmine 連線安全，限制不安全的 HTTP 使用情境並明確定義例外
- 調整 API Key 的儲存策略，降低跨裝置同步與意外暴露的風險
- 收斂 extension 的 host permissions 與相關權限行為，落實最小權限
- 建立依賴漏洞修補與驗證要求，處理目前 `npm audit` 已知風險
- 修正文檔中的安全敘述，使 README 與實際行為一致

## Capabilities

### New Capabilities

- `secure-redmine-transport`: 規範 Redmine 連線必須以安全傳輸進行，並限制不安全 URL 的使用
- `secure-credential-storage`: 規範 API Key 的儲存、讀寫與錯誤處理方式，降低敏感資料暴露面
- `extension-security-maintenance`: 規範最小權限、依賴漏洞治理與安全文件同步要求

### Modified Capabilities


## Impact

- `manifest.json` 權限與 host permissions 設定
- `background.js` 的 Redmine 連線、訊息處理與通知流程
- `scripts/options.js` 的設定驗證、儲存與 UI 提示
- `README.md` 與安全相關文件說明
- `package.json`、`package-lock.json`、CI 驗證流程與依賴管理

## Why

程式碼審查發現多項效能與記憶體管理問題：Storage API 在迴圈內逐筆讀寫、快取 Map 無大小上限、事件監聽器未使用委派導致累積洩漏、無限重試遞迴、以及 `chrome.storage.sync` 陣列無限增長等，這些問題在長期使用或大量 Issue 情境下會顯著影響擴充功能的穩定性與效能，應於下一版本一併修正。

## What Changes

- **批次 Storage 寫入**：移除迴圈內個別 `persistIssueState()` 呼叫，改為迴圈結束後一次性寫入所有狀態
- **快取大小上限**：為 `RedmineAPI` 與 `ConfigManager` 的 `cache` / `cacheExpiry` Map 加入最大容量限制（最早到期優先淘汰策略）
- **事件委派**：重構 `createNotificationElement()` 改用父容器事件委派，移除每個通知元素上的個別監聽器
- **有界重試**：為 `makeRequest()` 加入 `retryCount` 參數，HTTP 429 重試上限設為 3 次
- **已讀通知清理**：為 `readNotifications` 陣列加入最大保留數量（1000 筆），防止 `storage.sync` 超出配額
- **DOM 清空優化**：將多處 `innerHTML = ''` 改為 `replaceChildren()` 或 `textContent = ''`

## Capabilities

### New Capabilities

- `bounded-cache`: 快取 Map 的最大容量控制與最早到期優先淘汰機制
- `batched-storage-writes`: 批次化 Storage 寫入，避免迴圈內逐筆 I/O
- `bounded-retry`: HTTP 請求重試次數上限機制
- `read-notifications-cleanup`: 已讀通知陣列的容量管理與自動清理

### Modified Capabilities

- `secure-redmine-transport`: 網路請求層新增有界重試行為（retryCount 上限）
- `secure-credential-storage`: storage 寫入模式改為批次，影響 issueStates 與 readNotifications 的持久化行為

## Impact

- **高風險檔案**：`background.js`（Storage 批次寫入、重試邏輯）、`scripts/shared/config-manager.js`（快取上限）
- **中風險檔案**：`scripts/popup.js`（事件委派重構、DOM 清空優化）
- **影響功能**：Issue 狀態持久化、已讀通知同步、Redmine API 請求、Popup 通知列表渲染
- **測試範圍**：`background.js` 單元測試、`config-manager` 單元測試、popup 渲染整合測試
- **不影響**：manifest.json、options.html、外部 API 介面、使用者可見設定欄位

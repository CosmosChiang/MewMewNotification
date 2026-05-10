## 1. background.js — 批次 Storage 寫入

- [x] 1.1 在 `background.js` 中找出 `checkNotifications()` / issue 處理迴圈，確認 `persistIssueState()` 在迴圈內的所有呼叫位置
- [x] 1.2 重構迴圈：移除迴圈內的個別 `persistIssueState()` 呼叫，改以記憶體中的 `issueStates` 物件累積所有變更
- [x] 1.3 在迴圈結束後加入一次性的 `chrome.storage.local.set({ issueStates: ... })` 呼叫，並包覆 try/catch 記錄錯誤
- [x] 1.4 確認 `syncUpdatedIssue()` 不再觸發獨立的 storage 寫入（若需要保留，整合進批次呼叫）

## 2. background.js — 有界 HTTP 429 重試

- [x] 2.1 在 `background.js` 頂部加入常數 `const MAX_REQUEST_RETRIES = 3`
- [x] 2.2 修改 `makeRequest(endpoint, options)` 簽名為 `makeRequest(endpoint, options = {}, retryCount = 0)`
- [x] 2.3 在 HTTP 429 分支加入重試次數檢查：`retryCount >= MAX_REQUEST_RETRIES` 時拋出錯誤
- [x] 2.4 將 `Retry-After` 等待時間以 `Math.min(retryAfter, 300)` 限制在 300 秒內
- [x] 2.5 遞迴呼叫改為 `return this.makeRequest(endpoint, options, retryCount + 1)`

## 3. background.js — readNotifications 容量管理

- [x] 3.1 在 `background.js` 頂部加入常數 `const MAX_READ_NOTIFICATIONS = 1000`
- [x] 3.2 找出所有對 `readNotifications.push()` 後接 `storage.sync.set()` 的程式碼區段
- [x] 3.3 在每次 push 後加入容量檢查：若 `readNotifications.length > MAX_READ_NOTIFICATIONS`，則以 `splice(0, readNotifications.length - MAX_READ_NOTIFICATIONS)` 截斷

## 4. scripts/shared/config-manager.js — 快取容量上限

- [x] 4.1 在 `ConfigManager` 類別的 constructor 中加入 `this.maxCacheSize = 100`
- [x] 4.2 實作私有方法 `_evictOldestCacheEntry()`：遍歷 `cacheExpiry`，找出最小到期時間的 key，同時從 `cache` 和 `cacheExpiry` 中刪除
- [x] 4.3 在 `setCache()` 方法寫入前呼叫 `_evictOldestCacheEntry()`（當 `cache.size >= maxCacheSize` 時）
- [x] 4.4 確認 `RedmineAPI` 類別中的 cache 邏輯（若有獨立的 setCache 實作）同樣套用相同的上限機制

## 5. scripts/popup.js — 事件委派重構

- [x] 5.1 在 `createNotificationElement()` 中為每個通知 DOM 元素加入 `data-notification-id` 屬性
- [x] 5.2 為需要識別操作類型的按鈕元素加入 `data-action` 屬性（例如 `data-action="mark-read"`、`data-action="more-actions"`）
- [x] 5.3 在通知列表父容器初始化時，設定單一 `click` 事件監聽器，以 `event.target.closest('[data-action]')` 分派操作
- [x] 5.4 移除 `createNotificationElement()` 中 `click` 類操作的個別 `addEventListener`（保留 `textarea` 的 `input` 事件等非委派場景）
- [x] 5.5 確認進階操作（展開/收起、標記已讀、開啟連結）在委派模式下功能正常

## 6. scripts/popup.js — DOM 清空優化

- [x] 6.1 搜尋 `scripts/popup.js` 中所有 `innerHTML = ''` 的使用位置
- [x] 6.2 將每處 `container.innerHTML = ''` 替換為 `container.replaceChildren()`

## 7. 測試與驗證

- [x] 7.1 執行 `npm test` 確認所有既有測試通過
- [x] 7.2 執行 `npm run build` 確認擴充功能可正常建置
- [x] 7.3 手動測試：開啟 Popup，確認通知列表渲染正常、標記已讀、展開進階操作均正常運作
- [x] 7.4 手動測試：觸發多個 Issue 更新，使用 DevTools 確認 storage 寫入次數符合批次預期
- [x] 7.5 在 `chrome://extensions` 的 Service Worker 偵錯工具中確認無記憶體異常增長

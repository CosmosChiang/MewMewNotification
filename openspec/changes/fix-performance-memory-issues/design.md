## Context

MewMewNotification 是一個 Chrome 擴充功能，以 Service Worker (`background.js`) 為核心，定期輪詢 Redmine API 並透過 `chrome.storage` 持久化狀態。程式碼審查發現四類效能與記憶體問題：

1. `persistIssueState()` 在 issue 處理迴圈內逐次觸發 storage 讀寫
2. `RedmineAPI` 與 `ConfigManager` 的快取 Map 無容量上限
3. Popup 每個通知元素都掛載多個事件監聽器，未使用事件委派
4. HTTP 429 重試與 `readNotifications` 陣列均無有界上限

Service Worker 的特性（可被 Chrome 強制終止、記憶體受限）使上述問題比一般 Web 頁面更嚴重。

## Goals / Non-Goals

**Goals:**
- 將 issue 狀態的 storage 寫入由迴圈內改為迴圈後一次性批次寫入
- 為所有快取 Map 加入最早到期優先最大容量限制（上限 100 筆）
- Popup 通知列表改用父容器事件委派，移除個別元素監聽器
- `makeRequest()` 的 HTTP 429 重試加入最大次數限制（3 次）
- `readNotifications` 加入最大保留數量（1000 筆）

**Non-Goals:**
- 不引入新的外部函式庫（DOMPurify、marked.js 等）
- 不修改 manifest.json 或擴充功能的 API 介面
- 不改動 options 頁面的設定欄位結構
- 不重構測試基礎設施
- 不處理 console.log 清理（屬於獨立的技術債任務）

## Decisions

### D1：批次 Storage 寫入策略

**決策**：在 `checkNotifications()` 的 issue 處理迴圈結束後，統一呼叫一次 `chrome.storage.local.set()`，移除 `syncUpdatedIssue()` 中對 `persistIssueState()` 的個別呼叫。

**理由**：Chrome Storage API 建議批次操作；逐筆寫入在 50-100 個 issue 的情境下會產生上百次非同步 I/O，可能觸發 Chrome 的速率限制並延長 Service Worker 的活躍時間。

**替代方案考慮**：使用 debounce 延遲寫入 → 較複雜且在 Service Worker 生命週期中不可靠，捨棄。

---

### D2：快取最早到期優先上限實作位置

**決策**：在 `setCache()` 方法內，寫入前檢查 `cache.size >= maxCacheSize`，若超出則刪除 `cacheExpiry` 中到期時間最小的鍵。最大容量設為 100。

**理由**：Map 保持插入順序，找出最早到期的項目一次遍歷即可，不需要額外的佇列結構。上限 100 足以覆蓋一般使用情境（專案清單 + 使用者資訊），不會影響快取命中率。

**替代方案考慮**：固定 TTL 自動過期（已實作）+ 定期清掃 → 不能保證記憶體上限，仍保留作輔助機制。

---

### D3：事件委派實作範圍

**決策**：在 Popup 的通知列表父容器（`#notificationsList`）上設定單一 `click` 事件監聽器，透過 `event.target.closest('[data-action]')` 和 `dataset.notificationId` 識別目標。個別通知元素改用 `data-*` 屬性傳遞操作類型與 ID。

**理由**：事件委派在 DOM 元素頻繁新增/移除時可大幅降低監聽器數量，且符合虛擬滾動的使用模式。

**替代方案考慮**：`AbortController` 管理監聽器生命週期 → 需要較大的重構範圍，且委派方案已能完全解決問題。

---

### D4：重試上限的傳遞方式

**決策**：`makeRequest(endpoint, options, retryCount = 0)` 加入第三個參數，遞迴時傳入 `retryCount + 1`，上限為 3 次，超出後拋出明確錯誤。

**理由**：不改變現有呼叫端的簽名（預設值為 0），向下相容。

---

### D5：readNotifications 清理策略

**決策**：達到 1000 筆上限時，從陣列頭部移除最舊的項目（FIFO），維持最近 1000 筆。使用 `chrome.storage.sync` 的配額約 100KB，1000 筆通知 ID 字串估計約 30-50KB，安全邊際充足。

**理由**：FIFO 最簡單且不需要時間戳記解析，已讀狀態的時效性越舊越低，移除最舊的已讀記錄影響最小。

## Risks / Trade-offs

| 風險 | 說明 | 緩解措施 |
|------|------|----------|
| 批次寫入遺漏中間狀態 | Service Worker 在迴圈執行中被終止，可能遺失部分狀態更新 | 現有行為已有相同風險；批次寫入不加重此問題，且縮短 SW 活躍時間反而降低被終止機率 |
| 事件委派重構影響現有行為 | `closest()` 選擇器若層級錯誤可能無法觸發 | 對照現有測試逐一驗證每種操作類型；保留原有 `data-notification-id` 命名以減少變動 |
| 快取上限 100 在大型 Redmine 實例可能過小 | 大量專案的使用者快取命中率下降 | 上限設為常數 `MAX_CACHE_SIZE`，未來可依需求調整；現有 TTL 機制仍會自然汰換舊項目 |
| readNotifications 截斷後誤判已讀狀態 | 被移除的舊已讀 ID 可能導致舊通知重新顯示為未讀 | 此為可接受的最終一致性行為；1000 筆對一般使用者數個月的通知量已足夠 |

## Migration Plan

1. 修改 `background.js` — 批次寫入與有界重試（無資料格式變更，向下相容）
2. 修改 `scripts/shared/config-manager.js` — 加入快取上限（純行為變更）
3. 修改 `scripts/popup.js` — 事件委派重構（需同步更新 DOM 元素的 `data-*` 屬性）
4. 執行 `npm test` 確認既有測試全數通過
5. 手動測試：Popup 開啟通知列表、標記已讀、展開進階操作
6. 無需資料庫 migration；storage 格式不變

**回滾策略**：所有修改均為純行為變更，無 storage 格式變更，直接回滾程式碼即可。

## Open Questions

- 事件委派重構後，`textarea` 的 `input` 事件（非 `click`）是否仍需個別掛載？建議保留個別 `input` 監聽器，僅將 `click` 類操作改為委派。

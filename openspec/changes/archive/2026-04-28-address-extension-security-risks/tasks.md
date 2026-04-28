## 1. 傳輸與設定安全

- [x] 1.1 收斂 Redmine URL 驗證邏輯，預設拒絕一般遠端 HTTP URL
- [x] 1.2 為 localhost 或允許的開發例外情境加入明確警告與驗證流程
- [x] 1.3 調整 background 連線流程，確保新傳輸規則會在測試連線與定期同步時一致生效

## 2. 憑證儲存與遷移

- [x] 2.1 將 API Key 從 `chrome.storage.sync` 改為 `chrome.storage.local`，並保留非敏感設定於 `sync`
- [x] 2.2 實作舊版 `sync.apiKey` 到 `local.apiKey` 的一次性搬移與清除流程
- [x] 2.3 收斂錯誤訊息、狀態提示與日誌輸出，避免 API Key 出現在 UI 或診斷資訊中

## 3. 權限最小化

- [x] 3.1 調整 `manifest.json`，移除全域 host permissions，改為較窄的授權模型
- [x] 3.2 讓 Redmine 設定流程只要求目前設定 origin 所需的 host access
- [x] 3.3 補齊與更新權限行為相關測試，覆蓋更換 Redmine origin 的情境

## 4. 依賴與驗證治理

- [x] 4.1 盤點 `npm audit` 的 direct 與 high-risk 漏洞，優先修補可安全升級的套件
- [x] 4.2 更新 CI 或驗證流程，加入依賴漏洞檢查與明確門檻
- [x] 4.3 在無法立即修補的情況下，記錄例外原因、影響範圍與後續處置

## 5. 文件與回歸驗證

- [x] 5.1 更新 README 與相關文件，修正 HTTPS、API Key 儲存與安全保護敘述
- [x] 5.2 補齊或更新單元測試，涵蓋 URL 驗證、儲存遷移、權限與錯誤遮罩行為
- [x] 5.3 執行既有測試與 workflow 驗證，確認安全修正未破壞既有功能

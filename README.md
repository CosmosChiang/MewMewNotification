# MewMewNotification

[![CI/CD Pipeline](https://github.com/CosmosChiang/MewMewNotification/actions/workflows/ci.yml/badge.svg)](https://github.com/CosmosChiang/MewMewNotification/actions/workflows/ci.yml)
[![Test Coverage](https://codecov.io/gh/CosmosChiang/MewMewNotification/branch/main/graph/badge.svg)](https://codecov.io/gh/CosmosChiang/MewMewNotification)

![MewMewNotification Logo](icons/icon128.png)

[English README](README.en.md)

MewMewNotification 是一款簡單易用、支援多語言的 Chrome 擴充功能，能即時通知你 Redmine 上的議題更新，並提供彈性通知管理與專案過濾功能。

## 螢幕截圖範例

![設定頁面](docs/images/options.png)
![通知彈窗](docs/images/popup.png)

## 主要功能

- 即時檢查 Redmine 議題更新，支援自訂檢查間隔（1分鐘-60分鐘）
- 桌面通知與聲音提示，重要訊息不漏接
- 30秒連線超時保護，避免連線卡住
- API 金鑰僅安全儲存於瀏覽器本機 extension storage，不跨裝置同步
- 一鍵標記所有通知為已讀，並可明確清除通知歷史
- 支援多語系介面（繁體中文、簡體中文、日文、英文，並可自行擴充）
- 直接連結 Redmine 議題頁面，快速追蹤
- 通知收件匣支援未讀、已讀、全部檢視與輕量搜尋
- 議題更新摘要可顯示狀態、優先權、指派人員與主旨變更
- 支援展開「更多操作」面板，可直接快速回覆、變更狀態與指派人員
- 專案過濾：可選擇只顯示分配給自己的議題，或包含關注的議題
- 自動偵測議題更新，智慧通知管理
- 徽章計數器顯示未讀通知數量

## 安裝與設定

1. 於 Chrome 線上應用程式商店安裝本擴充功能，或手動載入解壓縮套件。
2. 右鍵點擊瀏覽器右上角 MewMewNotification 圖示，選擇「選項」，或點擊彈出視窗中的設定按鈕。
3. 在設定頁面輸入你的 Redmine 伺服器網址（Redmine URL）及 API 金鑰（API Key）。
   - API 金鑰可於 Redmine 個人帳號設定頁面取得。
   - 建議使用 HTTPS；若使用 HTTP，擴充功能會允許連線，但會顯示紅色的不安全連線警告。
4. 設定通知檢查間隔、最大通知數量、語言、專案過濾等偏好。
5. 儲存設定並可點擊「測試連線」確認設定正確。
   - 如果你是從舊版升級，第一次更新後請重新儲存 Redmine 設定，以授予新的每站點主機存取權限。

## 通知管理

- 支援通知收件匣管理：
  - **未讀 / 已讀 / 全部檢視**：可在目前未讀工作、已讀歷史與完整保留通知之間切換。
  - **搜尋**：可依議題 ID、標題、專案或指派人員篩選目前檢視。
  - **更新摘要**：當 Redmine 回傳可比較資料時，更新過的議題卡片會顯示變更欄位。
  - **全部標記為已讀**：僅將所有通知設為已讀，保留通知紀錄，方便日後查閱。
  - **清除歷史**：確認後刪除保留的通知歷史，且無法復原。
- 每張議題卡片都可展開「更多操作」：
  - **快速回覆**：可直接在 popup 內新增 Redmine 留言，並提供輕量 Markdown
    預覽。
  - **變更狀態**：可選擇可用狀態並立即更新，不必先開啟完整議題頁。
  - **變更指派人員**：若有可指派使用者，可直接在 popup 中完成改派。
  - 操作可用性會跟隨 Redmine 權限；若角色沒有權限，介面會明確顯示提示，而不
    是靜默失敗。
- 可手動重新整理通知
- 支援通知失敗重試與錯誤提示

## 多語言支援

- 內建繁體中文、簡體中文、日文、英文
- 可依照[多語言支援指南](docs/LANGUAGE_GUIDE.md)自訂新增語言
- 語言選單自動依 manifest 與 _locales 資料夾動態生成

## 開發者安裝與打包流程

1. 下載或 fork 本專案原始碼。
2. 於專案根目錄執行 `npm install` 安裝依賴（如有 package.json）。
3. 開發時可直接在 Chrome 擴充功能頁面載入「未封裝」模式：
   - 進入 chrome://extensions/
   - 開啟「開發人員模式」
   - 點擊「載入已解壓縮的擴充功能」，選擇本專案資料夾
4. 修改程式後可直接重新整理擴充功能。
5. 打包發佈：
    - 僅將擴充功能執行所需檔案打包為 zip（如 `manifest.json`、HTML、`background.js`、`scripts/`、`styles/`、`icons/`、`_locales/`）
    - 上傳至 Chrome Web Store 或手動分發

## 測試與 CI/CD

- `npm test`：執行完整 Jest 測試並輸出覆蓋率報告
- `npm run test:local`：執行較快的本地測試流程
- `npm run test:ci`：模擬 CI 環境執行測試
- `npm run test:coverage`：重新產生覆蓋率報告
- `npm run audit:high`：檢查 high / critical 依賴漏洞
- GitHub Actions 會在 `main` 的 push 與對 `main` 的 PR 上執行多 Node 版本測試、驗證與擴充功能打包
- GitHub Actions 會在 Node.js `20.x` job 執行 `npm run audit:high`，阻擋高風險依賴漏洞
- 推送 `v*` tag 時，GitHub Actions 會建立 GitHub Release 並附上打包 ZIP
- 更完整的流程說明請參考 [CI/CD 測試流程說明](docs/CI_TESTING_GUIDE.md)

## 如何貢獻程式碼

1. fork 本專案並建立新分支。
2. 提交你的修改（請盡量附上說明與測試案例）。
3. 發送 Pull Request，並描述你的改動內容。
4. 維護者會審查並合併你的貢獻。

## 權限說明

- `storage`：儲存使用者設定；一般偏好可同步，API 金鑰僅保存在本機
- `notifications`：顯示桌面通知
- `activeTab`：開啟 Redmine 相關頁面
- `optional_host_permissions`：只在你設定 Redmine 伺服器後，針對該 origin 要求必要的主機存取權限

**⚠️ 安全提醒**: 建議優先使用 HTTPS；若使用 HTTP，擴充功能仍可連線，但會顯示紅色警告提示此連線不安全

## 常見問題

### Q: API 金鑰如何取得？

A: 登入 Redmine，點選右上角「我的帳號」，即可在頁面下方找到 API 金鑰。

### Q: 為什麼沒有收到通知？

A: 請確認 Redmine URL 與 API Key 是否正確，且瀏覽器已授予該 Redmine 伺服器的主機存取權限。可點擊「測試連線」確認設定。
如果是從舊版升級，也請到選項頁重新儲存一次 Redmine 設定。

### Q: 如何只看分配給我的議題？

A: 在設定頁的「通知」分頁中啟用「只顯示分配給我的議題」選項。

### Q: 如何包含我關注的議題？

A: 在設定頁的「通知」分頁中啟用「包含我關注的議題」選項。

### Q: 為什麼有些進階議題操作是停用的？

A: popup 會依照 Redmine 伺服器回傳的權限與可用選項決定能否操作。若你的角色無
法變更狀態、改派指派人員，或新增留言，對應控制項會維持停用並顯示權限提示。

### Q: 如何新增語言？

A: 請參考 [多語言支援指南](docs/LANGUAGE_GUIDE.md) 說明。

### Q: 為什麼連線會超時？

A: 擴充功能設有 30 秒連線超時保護，如果你的 Redmine 伺服器響應較慢，請檢查網路連線或聯絡管理員。

### Q: API 金鑰安全嗎？

A: API 金鑰僅儲存在瀏覽器本機的 extension storage，不會同步到其他裝置。我們實施了多層安全防護：

- 嚴格的輸入驗證和過濾
- XSS 和注入攻擊防護
- 內容安全政策 (CSP) 保護
- 敏感資料與一般同步偏好的分離儲存

### Q: 擴充功能如何防護安全威脅？

A: MewMewNotification 實施了全面的安全措施：

- **XSS 防護**：使用安全的 DOM 操作，自動轉義所有用戶輸入
- **輸入驗證**：嚴格驗證所有 URL、API 金鑰和配置參數
- **API 安全**：白名單限制可訪問的 Redmine API 端點
- **傳輸安全**：優先建議使用 HTTPS；若使用 HTTP，擴充功能會明確顯示不安全連線警告
- **最小權限**：僅在設定的 Redmine origin 上請求主機存取權限
- **安全儲存**：敏感資料僅保存在本機 extension storage

## License

本專案採用 [MIT 授權條款](LICENSE)。

© 2025 MewMewNotification

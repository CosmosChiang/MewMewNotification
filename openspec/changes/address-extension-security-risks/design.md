## Context

這個 Chrome extension 目前會讓使用者輸入 Redmine URL 與 API Key，並由
background service worker 定期向 Redmine API 取資料。現況已有基本輸入驗證、
CSP 與部分 URL 檢查，但仍有三類跨模組的安全問題：

- 傳輸安全不足：設定流程與 manifest 仍允許一般 HTTP 目標，API Key 會透過
  `X-Redmine-API-Key` header 傳送
- 憑證保護不足：API Key 目前儲存在 `chrome.storage.sync`，會隨帳號跨裝置同步
- 權限與供應鏈面過大：`host_permissions` 允許所有 HTTP/HTTPS 網站，且目前
  `npm audit` 顯示多個已知漏洞

這些風險同時牽涉 `manifest.json`、`background.js`、`scripts/options.js`、
README、依賴管理與 CI 驗證，因此需要先用設計文件把策略定義清楚。

## Goals / Non-Goals

**Goals:**

- 將 Redmine 連線預設收斂為安全傳輸，避免 API Key 經由明文 HTTP 傳送
- 降低 API Key 的保存與讀寫暴露面，避免不必要的同步與顯示
- 將 extension 權限收斂到實際設定的 Redmine origin，符合最小權限
- 為已知依賴漏洞建立修補與驗證策略
- 讓 README 與安全實作一致，避免文件誤導

**Non-Goals:**

- 不更換 Redmine 驗證機制本身
- 不新增遠端後端服務或秘密管理服務
- 不在這個 change 中重構所有通知或 UI 邏輯
- 不承諾一次性解決所有低風險第三方套件問題；重點先放在高風險與直接相關項目

## Decisions

### 1. 非開發情境一律要求 HTTPS

Redmine URL 將改為預設必須使用 HTTPS。若要支援本機或內網開發環境，
只允許明確列出的例外情境，且需要在 UI 中提供清楚警告，不得默默接受一般
HTTP 網址。

**為什麼這樣做：**

- 可以直接阻斷 API Key 明文傳輸風險
- 與 README 現有的安全敘述一致

**替代方案：**

- 繼續允許任意 HTTP，只在 README 提醒使用者：風險仍然存在，不能接受
- 完全禁止所有 HTTP，包括 localhost：最安全，但會讓本機測試與內部環境遷移成本偏高

### 2. API Key 從 `chrome.storage.sync` 移到 `chrome.storage.local`

敏感憑證只保存在本機 `chrome.storage.local`。非敏感設定
（語言、通知偏好、輪詢頻率等）可以繼續放在 `sync`。升級時若發現舊版把
`apiKey` 放在 `sync`，系統需執行一次性搬移，成功後清除 `sync` 中的舊值。

**為什麼這樣做：**

- 減少跨裝置同步造成的暴露面
- 符合敏感資料與一般偏好的分離原則

**替代方案：**

- 保持在 `sync`：使用方便，但風險過高
- 改為自行加密後再放進 `sync`：瀏覽器端金鑰管理仍不理想，複雜度高且容易產生假安全感

### 3. 以 origin 為單位申請 host 權限

擴充功能不再預設持有全域 `http://*/*` 與 `https://*/*`。改為以使用者設定的
Redmine origin 為單位，透過較窄的權限模型進行授權，例如改用
`optional_host_permissions` 或等價的精準授權流程。

**為什麼這樣做：**

- 符合最小權限原則
- 可以把權限範圍限制在實際需要的 Redmine 主機

**替代方案：**

- 保留萬用 host permissions：實作最簡單，但權限過寬
- 僅在文件中說明不要填錯網址：無法從技術上降低權限

### 4. 依賴漏洞處理採「直接修補 + CI 驗證 + 例外明文化」

先優先處理直接依賴與高風險漏洞，必要時同步更新測試/工具鏈版本。CI 需加入
可自動化的漏洞檢查門檻；若存在暫時無法立即消除的項目，需在變更中明確記錄
原因與後續處置，而不是默默忽略。

**為什麼這樣做：**

- 目前 `npm audit` 已有多個 moderate/high 項目，不能只靠人工記憶追蹤
- 供應鏈風險會反映在開發、CI 與未來維護成本上

**替代方案：**

- 全部先忽略，等功能完成再處理：容易持續累積
- 直接對所有 audit 結果 fail build：短期可能造成雜訊過大，不利逐步收斂

### 5. README 的安全宣告必須與實作同步驗證

README 中與 HTTPS、API Key 儲存、安全防護相關的敘述，必須只描述目前已落地的
行為。設計上不允許文件先聲稱「強制 HTTPS」或「安全儲存」但實作仍未達標。

## Risks / Trade-offs

- [Risk] HTTPS 強制化可能影響使用 HTTP 的既有內網使用者
  → 提供明確例外策略、警告與遷移說明
- [Risk] 憑證從 `sync` 搬到 `local` 後，跨裝置體驗會下降
  → 明確將它定位為安全優先的取捨，並保留其他偏好設定同步
- [Risk] 權限模型改窄後，設定流程與權限授權流程會變複雜
  → 將授權設計成和儲存設定同一流程，降低使用者困惑
- [Risk] 套件升級可能帶來測試或 CI 破壞
  → 以直接依賴與高風險項目為優先，搭配既有測試與 workflow 驗證逐步收斂

## Migration Plan

1. 在新版啟動時檢查是否存在舊版 `sync.apiKey`
2. 若存在，搬移到 `local.apiKey`，並在成功後移除 `sync.apiKey`
3. 重新驗證目前設定的 Redmine URL 是否符合新安全規則
4. 若原有 host 權限不再符合最小權限模型，提示使用者重新授權目標 origin
5. 文件與 CI 驗證在同一 change 中一併更新，避免安全政策與實作不同步

## Open Questions

- localhost 與 RFC1918 私網位址的 HTTP 例外範圍要放寬到什麼程度
- host 權限實作上要採 `optional_host_permissions`，還是其他更適合現有 UX 的細化策略
- CI 的 audit 門檻要先以 high 為阻擋標準，還是連 moderate 一併收斂

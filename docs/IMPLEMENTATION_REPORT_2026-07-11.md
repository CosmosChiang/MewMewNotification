# MewMewNotification 改善計畫實作報告

日期：2026-07-11  
版本：1.5.0

## 結論

六個 OpenSpec 變更均已完成實作與驗收。同步資料現在依 Redmine profile 隔離；同步生命週期具 single-flight、取消與明確結果；分頁與 overlap cursor 可無損處理更新；Popup 支援離線優先與同步健康狀態；桌面通知可安全開啟議題及標記已讀；CI、相依套件與 release pipeline 已完成安全強化。

## 完成範圍

### 1. isolate-redmine-profile-state

- profile scope 由正規化 Redmine origin/path、current user ID 與 credential binding 建立。
- history、issue states、seen/read IDs、cursor、project cache 與桌面通知 mapping 分區保存。
- 舊資料採版本化 migration；所有會修改 Redmine 的操作均驗證 card profile。
- 同站更換 API Key 會建立不同 credential binding，不繼承原 profile 資料。

### 2. stabilize-notification-sync-lifecycle

- 所有 alarm、popup 與手動刷新共用 single-flight request。
- Alarm 僅在不存在或 interval 改變時重建。
- 移除重複啟動路徑，加入 AbortController、timer/retry 清理與結構化 SyncResult。
- Jest detectOpenHandles 驗證通過。

### 3. make-notification-sync-lossless

- API page size 與 UI 顯示上限完全分離。
- 支援完整 pagination、updated_on overlap cursor 與冪等去重。
- 納入 closed issue，並以 reconciliation 校正關閉、改派、刪除等狀態。
- storage commit 成功後才推進 cursor。
- 以 test-info.txt 進行唯讀 live 驗證：current user 正常；11 筆資料分 2 頁全部讀取。未輸出憑證，亦未執行 PUT。

### 4. improve-sync-health-offline-experience

- Popup 先顯示本機 history，再背景同步。
- 顯示 syncing、最後成功時間、stale、錯誤碼與 retry。
- 修正聲音控制、鍵盤操作、ARIA live region、reduced motion 與長列表呈現。

### 5. add-desktop-notification-actions

- 桌面通知本體可直接開啟 issue，按鈕可標記已讀。
- 使用 opaque notification mapping，不把 URL 或 credential 放入 notification ID。
- click/action 均再次驗證 active profile 與安全 Redmine URL。

### 6. restore-dependency-and-release-security

- runtime dependencies 為 0，Jest 升級至 30.4.2，CI 使用 Node 22/24。
- 新增 ESLint、locale parity、controller coverage、fake Redmine integration 與 Chromium smoke。
- GitHub Actions 全部 pin 至完整 commit SHA，並加入 Dependabot。
- 本機與 CI 共用同一 Node packaging implementation 及精確 allowlist。
- tag、manifest、package version 一致性、SHA-256 checksum 與 provenance/attestation 已納入 release。

## 驗證結果

| 閘門 | 結果 |
| --- | --- |
| ESLint | 通過，0 warning |
| Jest unit / controller | 157/157 通過，detectOpenHandles 通過 |
| Fake Redmine integration | 3/3 通過 |
| Node 22 compatibility | 157/157 通過 |
| Node 24 CI coverage | 157/157 通過 |
| Coverage | statements 57.31%、branches 53.74%、functions 62.20%、lines 57.80%，各 controller 門檻通過 |
| Locale parity | 4 locales、192 keys，一致 |
| Workflow policy | quality/integration/package/release 與 Node 22/24 通過 |
| Chromium unpacked smoke | extension、Options、Popup、optional permissions 通過 |
| OpenSpec strict | 17/17 artifacts 通過；6 active changes 全部有效 |
| npm audit | high 0、critical 0 |
| Package allowlist | 20 entries，無測試、文件、workspace metadata、secret 或 node_modules |
| Reproducible ZIP | 兩次 SHA-256 均為 8aa5d1d71f5acc049d5ea2e978968182ada8a11d8a825508c383f075d9586d45 |

## 已知風險

npm audit 尚有 2 個 moderate，均位於開發工具鏈的 transitive dependency：

- brace-expansion：由工具鏈間接引用。
- js-yaml：OpenSpec/開發驗證工具使用；不會被封裝進 extension runtime。

目前 high/critical 為 0，release ZIP 又採 allowlist，所以上述套件不會進入瀏覽器擴充套件。仍應由 Dependabot 持續追蹤上游修補。

## 操作入口

```powershell
npm ci --ignore-scripts
npm run quality
npm run test:integration
npm run test:smoke
npm run audit:high
npm run openspec:check
npm run package
npm run package:validate
```

Release 與封裝細節請參考 `docs/PACKAGE_AND_RELEASE.md`；安全基線與例外流程請參考 `docs/RELEASE_SECURITY.md`。

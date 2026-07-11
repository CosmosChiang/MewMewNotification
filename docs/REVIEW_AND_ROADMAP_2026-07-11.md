# MewMewNotification 審查結論與後續路線圖

審查日期：2026-07-11  
範圍：目前 \`main\` checkout 的架構、效能、可靠性、資安、測試、CI/CD 與產品功能。  
方式：唯讀程式碼審查、單元測試、依賴弱點掃描、OpenSpec 驗證與官方平台文件交叉確認。

## 執行摘要

MewMewNotification 已具備可用的 Redmine 通知、篩選、收件匣與快速操作功能，但目前不宜優先擴充新功能。

應先處理兩項 P0 風險：

1. 遠端 HTTP Redmine 仍會以明文傳送 API Key，且行為違反既有 OpenSpec。
2. 切換 Redmine 站台或帳號時，通知與同步狀態未隔離，可能顯示舊站資料，甚至把操作送到新站同 ID 的 issue。

接著應修正可能漏通知、重複同步、同步配額失敗與供應鏈/CI 阻塞問題。完成這層穩定化後，再投入同步健康面板、桌面通知操作、多 Profile 等功能。

## 已確認的良好控制

- Manifest V3 且 CSP 僅允許 self script，沒有 unsafe-eval 或遠端程式碼：\`manifest.json\`。
- 沒有 content script、web_accessible_resources 或 externally_connectable，普通網站無法直接呼叫 privileged message handler。
- Redmine API endpoint 有 allowlist，issue/project/status/assignee ID 有正整數驗證：\`background.js\`。
- Popup 對 issue 資料主要採用 \`textContent\`，Markdown 預覽先 escape，連結僅允許 HTTP(S) 並帶 \`noopener noreferrer\`。
- API Key 已由 sync storage 搬移至 local storage，並保留 legacy migration。
- Host permission 採 optional host permission，設定時只請求指定 Redmine origin。
- 發布 ZIP 使用 allowlist，不包含 node_modules、測試與文件。

靜態審查沒有發現一般網站可直接利用的 XSS 或外部訊息通道；不過這不取代實際瀏覽器 E2E 與滲透測試。

## 優先問題

| 優先級 | 問題 | 影響 | 主要證據 |
|---|---|---|---|
| P0 | 遠端 HTTP 仍可連線 | API Key 會透過明文 HTTP 傳送，可被網路中間人取得或竄改回應 | \`scripts/shared/config-manager.js:373\`、\`background.js:129\`、\`openspec/specs/secure-redmine-transport/spec.md:6\` |
| P0 | Redmine/Profile 狀態未隔離 | 跨站台或跨帳號沿用 history、issueStates、read/seen IDs；同 issue ID 可能造成錯誤操作與隱私外洩 | \`scripts/options.js:1146\`、\`background.js:1527\`、\`background.js:1840\` |
| P1 | 同步可能永久漏通知 | display limit 被當成 API limit；無 pagination；incremental sync 未實作；closed/reassigned-away issue 不會出現在查詢結果 | \`background.js:272\`、\`background.js:298\`、\`background.js:1887\` |
| P1 | 背景同步可重入 | Service worker 載入、alarm、Popup、手動刷新都可平行執行 check，造成重複請求、重複通知與競態寫入 | \`background.js:2293\`、\`background.js:2346\`、\`background.js:2537\` |
| P1 | timeout 未中止 fetch | Promise.race 不會 abort fetch，也不會清除 timer；Jest 偵測到第 142 行的 open handle | \`background.js:140\` |
| P1 | sync storage 單項配額風險 | readNotifications 上限 1000 筆，但代表性資料約 29KB；Chrome sync 單 item 上限 8KB，約 281 筆即可失敗 | \`background.js:12\`、\`background.js:2204\` |
| P1 | audit 與 CI 安全閘門失敗 | npm audit 有 14 項（2 high、2 moderate、10 low）；CI 設定 high 為阻擋門檻 | \`package.json:9\`、\`.github/workflows/ci.yml:40\` |
| P1 | Popup 離線/錯誤體驗不足 | 開啟時先 live refresh；同步錯誤被 background 吃掉，仍可能回 success 與舊 history | \`scripts/popup.js:304\`、\`background.js:2074\`、\`background.js:2453\` |
| P2 | Coverage 指標不完整 | 98% coverage 只計算 shared modules，background/options/popup 未計入 coverage 門檻 | \`jest.config.js:6\` |
| P2 | 功能與文件漂移 | enableSound 未實作、activeTab 未使用、ISC/MIT license 不一致、CI 文件與實作不一致 | \`options.html:63\`、\`manifest.json:11\`、\`package.json:332\` |

## 驗證結果

- \`npm run test:local -- --ci --watchAll=false\`：5 suites、127 tests 全部通過。
- \`npm test -- --forceExit --silent\`：coverage 顯示 98.02%，但僅涵蓋 \`config-manager.js\` 與 \`i18n.js\`。
- \`npx jest scripts/background.test.js --detectOpenHandles --forceExit\`：確認 \`background.js:142\` 有殘留 timeout handle。
- \`npm audit --json\`：14 項弱點，含 2 high；發行 ZIP 不含 node_modules，因此主要影響開發/CI/供應鏈。
- \`node validate-workflow.js\`：通過。
- \`openspec validate --all --strict\`：7 通過、4 失敗。失敗規格為 \`ci-cd-pipeline-enhancement\`、\`extension-security-maintenance\`、\`issue-card-advanced-actions\`、\`unit-test-structure\`，原因均為缺少 \`## Purpose\`。

## 建議 OpenSpec 執行順序

### 1. enforce-secure-redmine-transport-policy（P0，S）

- 強制遠端 Redmine 使用 HTTPS。
- HTTP 僅允許 localhost、127.0.0.1、::1，並顯示明確風險警告。
- 拒絕 URL userinfo、query、fragment，且禁止跨 origin redirect。
- 將 validator 同時套用在 Options、連線測試、背景同步與 issue 操作。
- 將 manifest HTTP host pattern 收斂為 loopback。

驗收：

- 遠端 HTTP 不觸發 permission request 或 fetch。
- loopback HTTP 經警告後可用。
- 文件、測試、實作與 OpenSpec 使用同一政策。

### 2. isolate-redmine-profile-state（P0，M）

- 以 normalized Redmine origin/path 與 current user ID 建立 Profile scope。
- 為 notification history、issueStates、seen/read IDs、sync cursor 與 project cache 加上 namespace。
- 所有 issue action 帶 profile ID，不符合目前 Profile 時拒絕執行。
- 提供 legacy state migration 或在切換設定後原子清除。

驗收：

- A、B 站都有 issue 1 時，B 不繼承 A 的通知狀態。
- API Key 更換但 URL 相同時，也不會操作舊帳號資料。
- 切換後首次同步完成前不顯示前一個 Profile 的卡片。

### 3. stabilize-notification-sync-lifecycle（P1，M）

- 加入 single-flight \`checkPromise\`，合併 alarm、Popup、手動刷新所發起的同步。
- Alarm 僅在不存在或 interval 改變時建立；移除 immediate alarm 與 direct check 的雙重啟動。
- 以 AbortController 實作 timeout，在 finally 清 timer。
- 將同步結果改成明確 SyncResult，例如 ok、stale、lastSuccess、errorCode。
- 長時間 Retry-After 改用 alarm/backoff，而非讓 service worker 長時間等待。

驗收：

- 多個觸發來源同時到達時，Redmine 只收到一次同步。
- 成功與失敗都不留下 Jest open handle。
- 同步失敗不會回傳 success。

### 4. make-notification-sync-lossless（P1，L）

- 分離 UI display limit、API page size、history retention。
- 實作 updated_on overlap cursor、完整 pagination、冪等去重與週期性 full reconciliation。
- 支援 \`status_id=*\`，並處理關閉或被改派離開使用者的既有追蹤 issue。
- 在所有頁面、state 與 history 寫入成功後，才更新 cursor。

驗收：

- 顯示上限為 10、一次有 25 筆更新時，25 筆都會被處理。
- open -> closed、assigned-to-me -> other 都產生一次正確摘要。
- 中斷後重播不漏資料也不重複通知。

### 5. restore-dependency-and-release-security（P1，M）

- Runtime npm dependency 歸零；測試與 workflow 工具改列 devDependencies。
- 升級 Jest/toolchain，CI 改用 Node 22/24。
- 補 lint、locale parity、完整 controller coverage、fake Redmine integration test 與 unpacked Chromium smoke test。
- 所有 GitHub Actions pin full commit SHA，啟用 Dependabot Actions 更新。
- 檢查 tag、manifest、package.json 版本一致；統一本機與 CI 打包入口。
- 新增 ZIP allowlist、checksum 與 artifact attestation。

驗收：

- \`npm audit --audit-level=high\` 為 0。
- CI matrix 沒有 EOL Node。
- OpenSpec strict 全部通過。
- 產物內容、版本與 checksum 可驗證。

### 6. improve-sync-health-offline-experience（P1，M）

- Popup 採 cached-first / stale-while-revalidate。
- 顯示最後成功時間、同步中、stale、錯誤與 retry。
- 補上真正有效的 sound 設定，或移除該設定與文件宣稱。
- 修正虛擬捲動 listener 累積與固定高度問題。
- 補 keyboard navigation、ARIA live region、lang、reduced motion 與 locale key CI 驗證。

## 後續功能排序

| 順序 | 功能 | 前置條件 |
|---|---|---|
| 1 | 同步健康面板與去識別化診斷包 | 同步結果契約與錯誤遮罩 |
| 2 | 桌面通知直接開啟 issue、標記已讀 | Profile-scoped notification mapping |
| 3 | Issue/Project snooze、優先權/狀態規則 | Lossless sync |
| 4 | 安靜時段結束後的 digest | 時區、DST、休眠補送策略 |
| 5 | 多 Redmine / 多帳號 Profile | Profile namespace 與資料遷移 |
| 6 | Redmine saved query、tracker、due-date 檢視 | Redmine capability discovery |
| 7 | Chrome Web Store draft upload 與發布 runbook | 版本/產物驗證與 Store credentials |

## 後續決策

在進入實作前，需確認下列政策：

1. 是否只允許 loopback HTTP，或需支援 RFC1918 內網 HTTP。
2. 切換 Profile 時採「完整清除舊資料」或「保留多 Profile 分頁」。
3. 關閉與改派離開使用者的 issue，要保留多久以追蹤其最後一次狀態。
4. 是否要提供 API Key 僅在瀏覽器執行期間保留的高安全模式。

建議先建立並實作前兩個 P0 change，再依序處理同步生命週期與 lossless sync。

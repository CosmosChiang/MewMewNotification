## Why

目前 issues 資訊卡僅能顯示基本資訊，無法直接進行常用操作，降低了處理效率。用戶希望能在資訊卡上快速回覆、變更狀態與指派人員，提升協作體驗。

## What Changes

- 新增 issues 資訊卡進階操作功能，支援快速回覆、變更狀態、變更指派人員
- 僅限網頁端支援此功能
- 進階操作需權限控管，僅特定角色可執行部分操作
- 回覆內容支援簡易 Markdown 格式
- 操作按鈕以「點擊展開更多」方式呈現

## Capabilities

### New Capabilities
- `issue-card-advanced-actions`: 在 issues 資訊卡上直接進行快速回覆、變更狀態、變更指派人員，含權限控管與格式化回覆

### Modified Capabilities


## Impact

- 影響 issues 資訊卡元件與相關 API
- 需新增權限驗證與操作 API
- 前端需調整 UI/UX 與互動流程
- 需更新相關文件與測試案例

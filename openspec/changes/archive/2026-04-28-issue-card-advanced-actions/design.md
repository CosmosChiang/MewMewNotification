## Context

目前 issues 資訊卡僅能顯示基本資訊，無法直接進行常用操作，降低了處理效率。用戶希望能在資訊卡上快速回覆、變更狀態與指派人員，提升協作體驗。

## Goals / Non-Goals

**Goals:**
- 讓使用者可直接於 issues 資訊卡上進行快速回覆、變更狀態、變更指派人員
- 支援權限控管與簡易 Markdown 格式回覆
- 操作按鈕以「點擊展開更多」方式呈現

**Non-Goals:**
- 不支援桌面或行動裝置端
- 不提供批次操作

## Decisions

- 僅於網頁端支援進階操作
- 權限控管採用現有角色權限機制
- 回覆內容採用簡易 Markdown 格式
- UI 採用點擊展開更多操作

## Risks / Trade-offs

- [Risk] 權限控管複雜度提升 → Mitigation: 詳細設計權限驗證流程
- [Risk] UI 操作流程需重新設計 → Mitigation: 先行設計 wireframe 並用戶測試

## Popup wireframe

```text
+------------------------------------------------------+
| #1234: Issue subject                     [⋯] [✓]     |
| Project name | In Progress | 5 分鐘前                |
| 指派：Alice                                           |
|                                                      |
| ┌ 更多操作 ────────────────────────────────────────┐ |
| | 快速回覆                                         | |
| | [ textarea 支援 Markdown ]                       | |
| | 預覽：**bold** / `code` / [link](https://...)    | |
| | [送出回覆]                                       | |
| |                                                  | |
| | 狀態變更                                         | |
| | [ status select                     ] [更新狀態] | |
| |                                                  | |
| | 指派人員                                         | |
| | [ assignee select                   ] [更新指派] | |
| |                                                  | |
| | 權限不足時顯示 disabled 狀態與錯誤訊息           | |
| └──────────────────────────────────────────────────┘ |
+------------------------------------------------------+
```

- 每張 issue 卡片保留原本的點擊開啟行為，僅在點擊 `⋯` 後展開進階操作。
- 一次只展開一張卡片，避免 popup 在小尺寸視窗內失控膨脹。
- 回覆、狀態、指派三個操作共享同一個權限與載入狀態區塊，減少重複提示。

## Permission and API contract

### 權限規則

- 所有進階操作皆沿用 Redmine 既有角色與 API 權限，不在擴充功能內自行複製
  角色判斷。
- popup 開啟進階操作時先向 background 取得 action context，依可用選項決定可
  否編輯：
  - `canReply`: 只要 issue 可讀取即允許輸入，實際送出仍以 Redmine API 回應為
    準。
  - `canChangeStatus`: 由 issue detail 回傳的 `allowed_statuses` 推導；若取不到
    可用狀態則停用狀態更新。
  - `canChangeAssignee`: 由專案 membership 名單推導可指派使用者；若無候選者則停
    用指派更新。
- Redmine 回傳 HTTP 403 時，UI 必須顯示「權限不足」訊息，並保留原本 issue 卡片
  狀態不變。

### Popup ↔ background message 介面

| action | request | response |
| --- | --- | --- |
| `getIssueActionContext` | `{ issueId }` | `{ success, context, error }` |
| `submitIssueReply` | `{ issueId, reply }` | `{ success, notification, context, error }` |
| `updateIssueStatus` | `{ issueId, statusId }` | `{ success, notification, context, error }` |
| `updateIssueAssignee` | `{ issueId, assigneeId }` | `{ success, notification, context, error }` |

### Background action context payload

```json
{
  "permissions": {
    "canReply": true,
    "canChangeStatus": true,
    "canChangeAssignee": true
  },
  "current": {
    "statusId": 3,
    "assigneeId": 42
  },
  "statusOptions": [
    { "id": 1, "name": "New" }
  ],
  "assigneeOptions": [
    { "id": 42, "name": "Alice" }
  ]
}
```

- 成功更新後 background 必須同步更新記憶中的 notification 與 `issueStates`，
  避免使用者自己的操作在下一次同步時被誤判為外部更新。

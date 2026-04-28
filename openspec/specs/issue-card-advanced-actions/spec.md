## Requirements

### Requirement: issues 資訊卡進階操作
系統 MUST 允許使用者於 issues 資訊卡上直接進行快速回覆、變更狀態、變更指派
人員，並支援權限控管與簡易 Markdown 格式回覆。

#### Scenario: 展開進階操作
- **WHEN** 使用者點擊資訊卡上的「更多操作」
- **THEN** 顯示快速回覆、變更狀態、變更指派人員等操作選項

#### Scenario: 權限控管
- **WHEN** 非授權使用者嘗試操作
- **THEN** 系統應顯示權限不足提示，並禁止操作

#### Scenario: 快速回覆支援 Markdown
- **WHEN** 使用者於回覆欄輸入 Markdown 格式內容
- **THEN** 系統正確渲染格式化內容

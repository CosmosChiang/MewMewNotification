# 多語言支援指南 (Multi-Language Support Guide)

> 本專案支援多語言介面，並可依需求輕鬆擴充。所有語言檔案皆遵循 Chrome 擴充標準格式，並支援動態語言選單。

## 新增語言步驟

### 建立語言檔案

在 `_locales/{language_code}/messages.json` 建立新語言資料夾與檔案，例如：

```text
_locales/
├── en/
├── zh_TW/
├── zh_CN/
├── ja/
└── {new_language_code}/
    └── messages.json
```

### 複製並翻譯內容

複製 `en/messages.json` 內容到新語言檔，將所有 `message` 欄位翻譯為目標語言。

### 更新語言選單

在 `options.html` 的 `<select id="languageSelect">` 中新增語言選項：

```html
<option value="{new_language_code}">{language_display_name}</option>
```

### 新增語言名稱翻譯

於所有語言檔案中加入新語言的名稱翻譯：

```json
"language_{new_language_code}": {
  "message": "{localized_language_name}",
  "description": "{language_name} language option"
}
```

### 程式自動處理

`options.js` 會自動：

- 掃描 `_locales` 目錄，動態生成語言選單
- 根據當前語言顯示對應語言名稱
- 若缺少翻譯則顯示原始名稱

## 範例：新增法語 (fr) 支援

1. 建立 `_locales/fr/messages.json`
2. 複製 `en/messages.json` 並翻譯
3. 在語言選單加入：

   ```html
   <option value="fr">Français</option>
   ```

4. 在所有語言檔案加入：

   ```json
   "language_fr": {
     "message": "Français",
     "description": "French language option"
   }
   ```

## 進階：程式化新增語言

可用 `OptionsManager.addLanguageOption('fr', 'Français')` 動態新增語言選項，會自動檢查重複並排序。

## 注意事項

- **語言代碼**：請使用標準語言/地區代碼（如 `en`, `zh_TW`, `fr-CA`）
- **Manifest**：`manifest.json` 的 `default_locale` 必須正確
- **完整性**：每個語言檔案都需包含所有翻譯鍵值
- **測試**：新增語言後請完整測試介面與功能

## 維護建議

- 定期檢查是否有新翻譯鍵值需同步到所有語言
- 可用自動化工具比對語言檔案結構
- 建議使用 JSON Linter 或翻譯工具驗證格式

## 最新功能與多語言支援

- 目前內建：繁體中文、簡體中文、日文、英文
- 支援專案過濾（只顯示分配給我的議題）
- 支援包含關注的議題選項
- 30秒連線超時保護
- API 金鑰僅儲存在本機 extension storage
- 語言選單與名稱皆可自動化管理

### 專案過濾功能翻譯範例

```json
"onlyMyProjects": {
  "message": "只顯示分配給我的議題",    // zh_TW
  "message": "只显示分配给我的问题",    // zh_CN
  "message": "自分に割り当てられた課題のみ表示", // ja
  "message": "Only show issues assigned to me", // en
  "description": "Only my projects filter option"
}
```

## 小技巧

- 語言選單會自動依 manifest 與 _locales 結構生成，無需手動維護清單
- 建議每次新增語言後，於各語言環境下完整測試
- 若有新功能，請同步更新所有語言檔案

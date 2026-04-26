## 1. 測試結構與覆蓋率優化

- [x] 1.1 統一 scripts/ 及子目錄下測試檔案命名為 .test.js
- [x] 1.2 補齊現有模組單元測試，提升覆蓋率至 80% 以上
- [x] 1.3 補充異常情境與邊界測試

## 2. Jest 與本地測試環境優化

- [x] 2.1 完善 jest.config.js 與相關 scripts 設定
- [x] 2.2 確保本地 npm test 可正確執行並產生覆蓋率報告

## 3. CI/CD 流程優化

- [x] 3.1 優化 .github/workflows/ci.yml，涵蓋多 Node 版本、lint、建構、發佈
- [x] 3.2 整合 Codecov，自動上傳覆蓋率報告
- [x] 3.3 main branch push 時自動產生並上傳發佈檔案

## 4. 文件同步維護

- [x] 4.1 更新 README、Task.md，說明測試與 CI/CD 流程
- [x] 4.2 調整後同步檢查文件內容正確性

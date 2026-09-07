# 教學訓練計畫主持人工作坊

依據「教學訓練計畫主持人工作坊.docx」製作的繁體中文視覺化網頁，支援填寫、確認資料及送至 Google Sheets。

## 檔案

- **index.html**：紫色漸層、emoji、響應式單檔網頁，內含 HTML／CSS／JavaScript。
- **apps-script/Code.gs**：Google Apps Script 收件程式，已設定指定試算表與「工作坊報名資料」分頁。
- **apps-script/headers.tsv**：可整行貼到 A1 的 10 欄表頭。
- **[apps-script/SETUP.md](apps-script/SETUP.md)**：初始化、授權、部署、網頁設定及收件驗證步驟。
- **tests/**：Google 服務模擬測試與前端送出流程測試，無外部測試套件。

## 啟用收件

先依 SETUP.md 執行 setupSheet 並部署 Code.gs，再將部署後的 /exec 網址填入 index.html 的 **APPS_SCRIPT_URL**。目前此值留白，網頁會清楚顯示服務未啟用並停用送出，仍可預覽資料。

網頁可直接開啟查看；正式報名請使用 HTTPS 網站並完成實際收件驗證。Google Sheets 網址不能直接當成送出網址。此專案未自動部署 Apps Script，也未寫入線上試算表。

## 資料與行為

保留原文件日期 2026/01/25、時間 9:00–16:00、地點、聯絡資訊與 12 個職類選項。所有 8 個填寫欄位為必填。確認送出後，資料寫入指定試算表，新增台北時間及報名編號。

只有收到後端成功回覆才顯示收件成功；網路失敗可在同頁保持相同資料重試，沿用編號防止重複寫入。沒有瀏覽器持久儲存，後端保留電話前導零並防止輸入變成公式。

## 測試

```sh
node --test tests/*.test.cjs
```

測試不需連線、不使用真實個資、不寫入 Google Sheets。通過本地測試不代表 Apps Script 已完成部署；上線後請依 SETUP.md 驗證實際收件。

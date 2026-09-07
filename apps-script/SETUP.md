# Google Sheets 報名串接設定

本專案已完成網頁送出流程與 Apps Script 收件程式。尚需由試算表擁有者執行初始化、授權並部署，取得收件網址後填入網頁，才能實際收件。

## 1. 開啟指定試算表

[開啟 Google Sheets](https://docs.google.com/spreadsheets/d/1uiACPGdC3mS-bR1mxh_TukK31rS7Z7fcrtqiuKSBkWI/edit?gid=0#gid=0)

- 試算表 ID：`1uiACPGdC3mS-bR1mxh_TukK31rS7Z7fcrtqiuKSBkWI`
- 分頁名稱：**工作坊報名資料**（字詞須完全相同）
- 2026/09/07 核對時此分頁存在，A1:J2 為空；本次未直接修改線上試算表，也未建立測試報名資料。

## 2. 安裝程式並建立表頭

1. 在該試算表選取「擴充功能 → Apps Script」。
2. 將本目錄的 **Code.gs** 完整內容貼入 Apps Script 的 Code.gs，取代預設範例並儲存。
3. 上方函式選單選擇 **setupSheet**，按「執行」，用對此試算表有編輯權限的帳號完成 Google 授權。
4. 回到「工作坊報名資料」確認 A1:J1 出現表頭。

setupSheet 會建立缺少的指定分頁，或在空分頁建立表頭；表頭不同時停止，不會清除或覆寫既有資料。可重複執行。請勿在編輯器直接執行 doPost，因為它需要網頁 POST 請求。

若要手動設定：開啟 **headers.tsv**，複製整行，在分頁 **A1** 貼上，會分成 10 欄。不要加上標題列或改變順序。

| 欄 | 表頭 | 來源／用途 |
| --- | --- | --- |
| A | 報名時間 | 伺服器產生，台北時間 yyyy/MM/dd HH:mm:ss |
| B | 姓名 | name |
| C | 機構名 | organization |
| D | 職稱 | title |
| E | 負責的職類 | profession，12 個既有選項 |
| F | 目前是否擔任教學訓練計畫主持人 | director，是／否 |
| G | 參與方式 | attendance，實體／線上 |
| H | Email | email |
| I | 聯繫電話 | phone，以文字保存前導 0 與分機 |
| J | 報名編號 | 網頁產生 UUID，同次請求重試不重複寫入 |

## 3. 部署 Apps Script

1. 按右上角「部署 → 新增部署作業」。
2. 選取類型「網頁應用程式」。
3. 「執行身分」選 **我**；「誰可以存取」選 **所有人／任何人**（包含未登入 Google 的使用者）。
4. 按「部署」，依 Google 流程完成授權。
5. 複製「網頁應用程式網址」，格式應為：

```text
https://script.google.com/macros/s/部署識別碼/exec
```

請使用 **/exec**，不要使用 /dev、Apps Script 編輯網址或 Google Sheets 網址。如果 Workspace 管理員限制匿名部署，請先聯繫管理員；只允許登入者的部署不適用本頁匿名送出流程。試算表本身不需要設成公開，收件程式以部署者權限寫入。

這是一個公開報名收件端，知道部署網址者可提交資料，網址不是密碼。程式不提供讀取報名清單的 API。若修改 Code.gs，需到「部署 → 管理部署作業 → 編輯 → 新版本 → 部署」更新；僅儲存程式不會更新既有部署。

## 4. 設定網頁收件網址

在專案根目錄 **index.html** 搜尋：

```js
const APPS_SCRIPT_URL = '';
```

將引號內換成上一步的完整 /exec 網址，儲存後 commit 並 push 更新網頁。此設定值是公開收件網址，請勿填入 API key 或 OAuth token。未設定時仍可確認資料，但送出按鈕會停用。

## 5. 驗證實際收件

1. 使用實際網站（HTTPS）開啟表單，填入一筆清楚標示為測試的資料。
2. 按「確認參與資料」，核對後按「確認送出報名」。
3. **只有收到有效的成功回覆及相符報名編號，網頁才顯示「報名資料已收件」。**
4. 到指定分頁核對新增列，尤其是姓名、Email、電話前導 0 與報名編號。
5. 若出現「尚未收到收件確認」，資料可能已寫入；保持相同資料，在同一頁按「重試送出」會沿用編號，後端不新增重複列。重新整理或修改資料會失去此重試條件，請先用編號查詢收件狀態。

程式以報名編號去重，並非依 Email 或電話限制一人只能報名一次。未設定截止日期，活動日期仍依原文件保留為 2026/01/25。

## 技術與排錯

- POST 使用 URLSearchParams（application/x-www-form-urlencoded），不額外加入 JSON 或自訂標頭；JSON 回應使用 ContentService，網頁允許跟隨 Google 重新導向。
- 不使用 no-cors，因為不透明回應無法證明寫入成功。若 Google 回應遭瀏覽器阻擋，頁面保留資料並顯示未確認狀態。
- 連線錯誤：先核對 /exec 網址、匿名存取權限及是否已部署最新版本，再以 Apps Script「執行項目」和試算表 J 欄核對是否送達。
- HEADER_MISMATCH：核對 A1:J1 是否與 headers.tsv 完全一致，請不要直接覆蓋不相符的既有資料表。
- SETUP_REQUIRED：先執行 setupSheet；SERVER_ERROR：檢查部署帳號的試算表權限、Google 服務配額與執行紀錄。
- 後端驗證必填、長度、控制字元與選項；寫入使用鎖避免併發衝突，公式樣式輸入以文字保存。
- 網頁只在記憶體保留當頁資料，未使用 localStorage／sessionStorage；確認送出後會傳送並保存於指定 Google Sheets。

本地驗證：在專案根目錄執行 `node --test tests/*.test.cjs`。測試使用模擬 Google 服務，不會寫入真實試算表；真實部署網址填入後仍需完成上述收件驗證。

官方參考：[Web Apps 部署與 doPost](https://developers.google.com/apps-script/guides/web)、[Content Service 與重新導向](https://developers.google.com/apps-script/guides/content)、[Lock Service](https://developers.google.com/apps-script/reference/lock/lock)。

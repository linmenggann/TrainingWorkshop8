# Google Sheets 串接設定（工作坊報名資料）

## 1) Google Sheets 分頁表頭
請在試算表分頁「`工作坊報名資料`」第 1 列放入以下欄位：

1. 報名時間
2. 姓名
3. 機構名
4. 職稱
5. 負責的職類
6. 是否擔任教學訓練計畫主持人
7. 預計參與方式
8. Email
9. 聯繫電話
10. 來源頁面
11. 備註

> 若已部署 Apps Script，可直接先執行 `setupSheet()` 自動建立以上表頭。

## 2) Apps Script 內容
將 `google-apps-script.gs` 內容完整貼到 Apps Script 專案後，依序進行：

1. 儲存專案。
2. 執行一次 `setupSheet()`（授權後建立分頁與表頭）。
3. 透過「部署 > 新增部署 > 網頁應用程式」發布：
   - 執行身分：我
   - 存取權：任何知道連結的人

## 3) 前端送出範例（可加到網頁）
```html
<script>
  async function submitRegistration(formData) {
    const endpoint = '請貼上你的 Apps Script Web App URL';

    const payload = {
      name: formData.name,
      organization: formData.organization,
      title: formData.title,
      professionCategory: formData.professionCategory,
      isProgramDirector: formData.isProgramDirector,
      attendanceMode: formData.attendanceMode,
      email: formData.email,
      phone: formData.phone,
      sourcePage: '教學訓練計畫主持人工作坊頁面',
      note: formData.note || ''
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok || result.status !== 200) {
      throw new Error(result.message || '送出失敗');
    }
    return result;
  }
</script>
```

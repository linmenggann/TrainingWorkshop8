/**
 * 教學訓練計畫主持人工作坊 - 報名資料寫入 Google Sheets
 *
 * Spreadsheet: https://docs.google.com/spreadsheets/d/1tzFYenje0VFreIeZBcKEX7vAFye1BGPmCWeIhgZ76tI/edit
 * Sheet name: 工作坊報名資料
 */
const SPREADSHEET_ID = '1tzFYenje0VFreIeZBcKEX7vAFye1BGPmCWeIhgZ76tI';
const SHEET_NAME = '工作坊報名資料';

/**
 * 建立工作表與表頭（第一次部署前先執行一次）。
 */
function setupSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const headers = [
    '報名時間',
    '姓名',
    '機構名',
    '職稱',
    '負責的職類',
    '是否擔任教學訓練計畫主持人',
    '預計參與方式',
    'Email',
    '聯繫電話',
    '來源頁面',
    '備註'
  ];

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

/**
 * 提供簡單 GET 健康檢查。
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'workshop-registration-webapp' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 接收報名資料（JSON）並寫入「工作坊報名資料」。
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse(400, '缺少 POST 內容');
    }

    const data = JSON.parse(e.postData.contents);

    const requiredFields = [
      'name',
      'organization',
      'title',
      'professionCategory',
      'isProgramDirector',
      'attendanceMode',
      'email',
      'phone'
    ];

    const missing = requiredFields.filter((key) => !String(data[key] || '').trim());
    if (missing.length) {
      return jsonResponse(400, `缺少必要欄位: ${missing.join(', ')}`);
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      return jsonResponse(500, `找不到工作表: ${SHEET_NAME}`);
    }

    const row = [
      new Date(),
      data.name,
      data.organization,
      data.title,
      data.professionCategory,
      data.isProgramDirector,
      data.attendanceMode,
      data.email,
      data.phone,
      data.sourcePage || '教學訓練計畫主持人工作坊頁面',
      data.note || ''
    ];

    sheet.appendRow(row);

    return jsonResponse(200, '報名資料已成功寫入試算表', {
      sheetName: SHEET_NAME,
      spreadsheetId: SPREADSHEET_ID
    });
  } catch (error) {
    return jsonResponse(500, `寫入失敗: ${error.message}`);
  }
}

function jsonResponse(status, message, data) {
  return ContentService
    .createTextOutput(JSON.stringify({ status, message, data: data || null }))
    .setMimeType(ContentService.MimeType.JSON);
}

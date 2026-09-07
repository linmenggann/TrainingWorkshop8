/**
 * 教學訓練計畫主持人工作坊報名收件服務。
 * 將本檔貼到 Google Sheets → 擴充功能 → Apps Script 的 Code.gs。
 * 先手動執行 setupSheet，再部署為網頁應用程式。完整步驟見 SETUP.md。
 */
const CONFIG = Object.freeze({
  spreadsheetId: '1uiACPGdC3mS-bR1mxh_TukK31rS7Z7fcrtqiuKSBkWI',
  sheetName: '工作坊報名資料',
  timeZone: 'Asia/Taipei'
});
const HEADERS = Object.freeze([
  '報名時間', '姓名', '機構名', '職稱', '負責的職類',
  '目前是否擔任教學訓練計畫主持人', '參與方式', 'Email', '聯繫電話', '報名編號'
]);
const FIELDS = Object.freeze([
  ['name', '姓名', 80], ['organization', '機構名', 150], ['title', '職稱', 100],
  ['profession', '負責的職類', 20], ['director', '主持人身分', 1],
  ['attendance', '參與方式', 2], ['email', 'Email', 254], ['phone', '聯繫電話', 40]
]);
const PROFESSIONS = Object.freeze([
  '藥事', '醫事放射', '醫事檢驗', '護理', '營養', '呼吸治療',
  '聽力', '物理治療', '職能治療', '臨床心理', '語言治療', '其他'
]);

/** 只初始化空分頁或核對相同表頭；不清除、不覆寫既有資料。 */
function setupSheet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const book = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    let sheet = book.getSheetByName(CONFIG.sheetName);
    if (!sheet) sheet = book.insertSheet(CONFIG.sheetName);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS.slice()]);
    }
    assertHeaders_(sheet);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setBackground('#593080').setFontColor('#ffffff').setFontWeight('bold')
      .setWrap(true);
    sheet.setColumnWidths(1, HEADERS.length, 160);
    sheet.setColumnWidth(6, 260);
    sheet.setColumnWidth(8, 240);
    sheet.setColumnWidth(10, 300);
    SpreadsheetApp.flush();
    return '「' + CONFIG.sheetName + '」A1:J1 表頭已就緒。';
  } finally {
    lock.releaseLock();
  }
}

/** GET 僅顯示服務識別，不讀取或揭露報名資料。 */
function doGet() {
  return json_({ ok: true, service: 'workshop-registration', version: 1 });
}

/** 接受 application/x-www-form-urlencoded POST。不要直接在編輯器執行。 */
function doPost(e) {
  let lock;
  let locked = false;
  try {
    const data = validateRequest_(e);
    lock = LockService.getScriptLock();
    locked = lock.tryLock(15000);
    if (!locked) throw publicError_('BUSY', '目前報名人數較多，請稍後以相同資料重試。');
    const sheet = SpreadsheetApp.openById(CONFIG.spreadsheetId).getSheetByName(CONFIG.sheetName);
    if (!sheet) throw publicError_('SETUP_REQUIRED', '報名服務尚未完成設定，請聯繫主辦單位。');
    assertHeaders_(sheet);

    // 同一頁面重試沿用 UUID；檢查與寫入均在同一把鎖內，避免同時送出重複列。
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const existing = sheet.getRange(2, 10, lastRow - 1, 1)
        .createTextFinder(data.requestId).matchEntireCell(true).matchCase(true)
        .useRegularExpression(false).findNext();
      if (existing) return json_({ ok: true, duplicate: true, requestId: data.requestId });
    }
    const timestamp = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy/MM/dd HH:mm:ss');
    const row = [timestamp].concat(FIELDS.map(function (field) {
      return safeCell_(data[field[0]]);
    }), [data.requestId]);
    const nextRow = lastRow + 1;
    if (nextRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    // 文字格式保留電話 0 與分機；safeCell_ 另防止使用者輸入被當成公式。
    sheet.getRange(nextRow, 1, 1, HEADERS.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
    return json_({ ok: true, duplicate: false, requestId: data.requestId });
  } catch (error) {
    // 不回傳例外堆疊、試算表資料、憑證或使用者輸入。
    return json_({
      ok: false,
      code: error.publicCode || 'SERVER_ERROR',
      message: error.publicMessage || '暫時無法確認報名結果，請以相同資料重試或聯繫主辦單位。'
    });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function validateRequest_(e) {
  if (!e || !e.postData || Number(e.contentLength) > 12000 ||
      !/^application\/x-www-form-urlencoded(?:;|$)/i.test(e.postData.type || '')) {
    throw publicError_('INVALID_REQUEST', '請從工作坊報名網頁送出資料。');
  }
  const p = e.parameter || {};
  if (p.action !== 'register') throw publicError_('INVALID_REQUEST', '不支援的操作。');
  const keys = ['action', 'requestId'].concat(FIELDS.map(function (f) { return f[0]; }));
  if (keys.some(function (key) { return e.parameters && e.parameters[key] && e.parameters[key].length !== 1; })) {
    throw publicError_('INVALID_REQUEST', '欄位不可重複。');
  }
  if (typeof p.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.requestId)) {
    throw publicError_('INVALID_REQUEST', '報名編號無效，請重新開啟報名頁。');
  }
  const data = { requestId: p.requestId.toLowerCase() };
  FIELDS.forEach(function (field) {
    const value = typeof p[field[0]] === 'string' ? p[field[0]].trim() : '';
    if (!value || value.length > field[2] || /[\u0000-\u001f\u007f]/.test(value)) {
      throw publicError_('VALIDATION_ERROR', '請確認「' + field[1] + '」已正確填寫且未超過長度限制。');
    }
    data[field[0]] = value;
  });
  if (PROFESSIONS.indexOf(data.profession) === -1 || ['是', '否'].indexOf(data.director) === -1 ||
      ['實體', '線上'].indexOf(data.attendance) === -1) {
    throw publicError_('VALIDATION_ERROR', '請使用表單提供的職類、主持人身分及參與方式選項。');
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(data.email)) {
    throw publicError_('VALIDATION_ERROR', '請輸入有效的 Email。');
  }
  return data;
}

function assertHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (HEADERS.some(function (header, index) { return current[index] !== header; })) {
    throw publicError_('HEADER_MISMATCH', '報名表欄位設定不符，請主辦單位核對 A1:J1 表頭。');
  }
}

function safeCell_(value) {
  return /^[=+\-@']/.test(value) ? "'" + value : value;
}

function publicError_(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  error.publicMessage = message;
  return error;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

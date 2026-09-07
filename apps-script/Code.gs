/**
 * 教學訓練計畫主持人工作坊報名收件服務。
 * 將本檔貼到 Google Sheets → 擴充功能 → Apps Script 的 Code.gs。
 * 先手動執行 setupSheet，再部署為網頁應用程式。完整步驟見 SETUP.md。
 */
const CONFIG = Object.freeze({
  spreadsheetId: '1uiACPGdC3mS-bR1mxh_TukK31rS7Z7fcrtqiuKSBkWI',
  sheetName: '工作坊報名資料',
  timeZone: 'Asia/Taipei',
  capacity: 4
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

/** GET 預設為服務識別；action=dashboard 僅回傳不含個資的彙總數字。 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'dashboard') return dashboardResponse_();
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
    const registeredRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getDisplayValues() : [];
    const registered = buildDashboardSummary_(registeredRows, new Date().toISOString()).total;
    const availability = availabilityForCount_(registered);
    if (lastRow > 1) {
      const existing = sheet.getRange(2, 10, lastRow - 1, 1)
        .createTextFinder(data.requestId).matchEntireCell(true).matchCase(true)
        .useRegularExpression(false).findNext();
      if (existing) return json_({ ok: true, duplicate: true, requestId: data.requestId, availability: availability });
    }
    // 必須在重試去重之後、寫入之前檢查，且持續持有同一把 ScriptLock。
    if (availability.full) return json_({ok: false, code: 'FULL', message: '額滿，本活動限額 4 名，已停止受理報名。', availability: availability});
    const timestamp = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy/MM/dd HH:mm:ss');
    const row = [timestamp].concat(FIELDS.map(function (field) {
      return safeCell_(data[field[0]]);
    }), [data.requestId]);
    const nextRow = lastRow + 1;
    if (nextRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    // 文字格式保留電話 0 與分機；safeCell_ 另防止使用者輸入被當成公式。
    sheet.getRange(nextRow, 1, 1, HEADERS.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
    return json_({ ok: true, duplicate: false, requestId: data.requestId, availability: availabilityForCount_(registered + 1) });
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


/** 儀表板唯讀端點；沿用報名寫入鎖以取得一致的統計快照。 */
function dashboardResponse_() {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(15000);
    if (!locked) throw publicError_('BUSY', '資料更新中，請稍後重試。');
    const sheet = SpreadsheetApp.openById(CONFIG.spreadsheetId).getSheetByName(CONFIG.sheetName);
    if (!sheet) throw publicError_('SETUP_REQUIRED', '找不到報名資料分頁。');
    assertHeaders_(sheet);
    const count = sheet.getLastRow() - 1;
    const rows = count > 0 ? sheet.getRange(2, 1, count, HEADERS.length).getDisplayValues() : [];
    const summary = buildDashboardSummary_(rows, new Date().toISOString());
    return json_({ok: true, service: 'workshop-dashboard', schemaVersion: 1,
      summary: summary, availability: availabilityForCount_(summary.total)});
  } catch (error) {
    return json_({ok: false, code: error.publicCode || 'SERVER_ERROR',
      message: error.publicMessage || '暫時無法讀取報名統計，請稍後重試。'});
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** 純統計函式：不回傳姓名、機構名稱、職稱、Email、電話或報名編號。 */
function buildDashboardSummary_(rows, generatedAt) {
  const attendance = {'實體': 0, '線上': 0, '未分類': 0};
  const directors = {'是': 0, '否': 0, '未分類': 0};
  const professions = PROFESSIONS.concat(['未分類']).map(function (label) { return {label: label, count: 0}; });
  const institutions = new Set();
  const ids = new Set();
  const days = Object.create(null);
  const quality = {skippedRows: 0, duplicateRows: 0, invalidDates: 0};
  let total = 0;
  let latest = '';
  rows.forEach(function (row) {
    const values = row.map(function (value) { return String(value == null ? '' : value).trim(); });
    if (!values.some(Boolean)) return;
    if (!values[1]) { quality.skippedRows++; return; }
    const id = values[9] ? values[9].toLowerCase() : '';
    if (id && ids.has(id)) { quality.duplicateRows++; return; }
    if (id) ids.add(id);
    total++;
    if (values[2]) institutions.add(values[2]);
    attendance[Object.prototype.hasOwnProperty.call(attendance, values[6]) ? values[6] : '未分類']++;
    directors[Object.prototype.hasOwnProperty.call(directors, values[5]) ? values[5] : '未分類']++;
    const profession = professions.find(function (item) { return item.label === values[4]; });
    (profession || professions[professions.length - 1]).count++;
    const stamp = normalizeDashboardDate_(values[0]);
    if (stamp) {
      const day = stamp.slice(0, 10).replace(/\//g, '-');
      days[day] = (days[day] || 0) + 1;
      if (stamp > latest) latest = stamp;
    } else quality.invalidDates++;
  });
  return {generatedAt: generatedAt, total: total, institutionCount: institutions.size,
    attendanceCounts: attendance, directorCounts: directors, professionCounts: professions,
    dailyCounts: Object.keys(days).sort().map(function (date) { return {date: date, count: days[date]}; }),
    lastRegistrationAt: latest || null, quality: quality};
}

function normalizeDashboardDate_(value) {
  const match = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value || '');
  if (!match) return null;
  const parts = match.slice(1).map(function (n) { return Number(n || 0); });
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 ||
      date.getUTCDate() !== parts[2] || date.getUTCHours() !== parts[3] ||
      date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) return null;
  function pad(n) { return String(n).padStart(2, '0'); }
  return parts[0] + '/' + pad(parts[1]) + '/' + pad(parts[2]) + ' ' + pad(parts[3]) + ':' + pad(parts[4]) + ':' + pad(parts[5]);
}


/** 名額狀態由伺服器統一決定；前端不提供也不能覆寫名額上限。 */
function availabilityForCount_(registered) {
  return {capacity: CONFIG.capacity, registered: registered,
    remaining: Math.max(0, CONFIG.capacity - registered),
    full: registered >= CONFIG.capacity, capacityEnforced: true};
}

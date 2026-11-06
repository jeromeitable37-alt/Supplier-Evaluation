/**
 * SOUTHVILLE PURCHASING - evaluation integration, deployed by the authorized
 * school Google Workspace account that owns the official spreadsheet.
 *
 * Deploy as Web App -> Execute as Me. Configure Script Properties:
 *   EMAIL_WEBHOOK_SECRET = random long value (match Vercel secret)
 *   SUPPLIER_SHEET_ID = spreadsheet ID, owned by this account
 *
 * Requests without "action" retain backwards compatibility with the existing
 * send-evaluation and reminder routes.
 *
 * This deliberately writes to WEB_EVALUATIONS rather than changing historical
 * DATABASE formulas or legacy reports.
 */
var ISO_TAB = 'WEB_EVALUATIONS';
var ISO_HEADERS = [
  'Evaluation ID', 'Submitted At', 'PO Number', 'PRF No', 'Supplier',
  'Supplier Address', 'Items Delivered', 'Evaluator Role', 'Evaluator Name',
  'Evaluator Email', 'Accurate Delivery / Quality', 'Competitive Price',
  'Timeliness of Delivery', 'After Sales Service', 'Compliance',
  'Role Average', 'Supplier Comments', 'Reasons for Scores Below 4',
  'Purchasing Service - Timeliness', 'Purchasing Service - Accuracy',
  'Purchasing Service Comments', 'Requisitioner Acknowledged Name',
  'Last Synced At'
];

/**
 * Public reachability check. Never reveals Drive IDs or secret properties.
 */
function doGet(e) {
  return jsonResponse_({ ok: true, status: 'ready', service: 'supplier-evaluation-iso' });
}

/**
 * Run manually in the Apps Script editor before using the production web app.
 * This performs checks only. It never sends an email or modifies any sheet.
 */
function testIntegrationSetup() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('EMAIL_WEBHOOK_SECRET');
  var sheetId = props.getProperty('SUPPLIER_SHEET_ID');
  if (!secret || secret.length < 24) throw new Error('Configure EMAIL_WEBHOOK_SECRET (24+ characters).');
  if (!sheetId) throw new Error('Configure SUPPLIER_SHEET_ID.');
  var sheet = SpreadsheetApp.openById(sheetId);
  assertPrivateWorkbook_(sheetId);
  var folderId = props.getProperty('PO_DRIVE_FOLDER_ID');
  if (folderId) {
    var folder = DriveApp.getFolderById(folderId);
    // Read-only access check. Upload permissions must also be granted.
    folder.getName();
  }
  var result = {
    ok: true,
    status: 'ready',
    spreadsheetAccess: 'verified',
    spreadsheetSharing: 'restricted',
    driveFolderAccess: folderId ? 'verified-read' : 'not-yet-configured'
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * Supplier evaluation responses include named staff and their ratings.
 * Never write them to a spreadsheet that has anyone-with-link access.
 * Do not change sharing settings automatically: school staff must approve.
 */
function assertPrivateWorkbook_(sheetId) {
  var sharing = DriveApp.getFileById(sheetId).getSharingAccess();
  if (sharing === DriveApp.Access.ANYONE || sharing === DriveApp.Access.ANYONE_WITH_LINK) {
    throw new Error('Workbook is accessible by anyone with the link. Restrict sharing before syncing confidential evaluations.');
  }
}

function doPost(e) {
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('EMAIL_WEBHOOK_SECRET');
    if (!secret || secret.length < 24 || request.secret !== secret) {
      throw new Error('Unauthorized or unconfigured integration request.');
    }
    var action = String(request.action || 'send_email');
    var result;
    if (action === 'send_email') result = sendEvaluationEmail_(request);
    else if (action === 'sync_evaluation') result = upsertWebEvaluation_(request, props);
    else throw new Error('Unsupported action.');
    return jsonResponse_(Object.assign({ ok: true }, result));
  } catch (error) {
    return jsonResponse_({ ok: false, message: String(error && error.message || error) });
  }
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeSheetText_(value, maxLength) {
  var text = String(value == null ? '' : value).trim().slice(0, maxLength || 1000);
  // Prevent formulas supplied in submitted text from being evaluated as formulas.
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function safeScore_(value) {
  if (value === '' || value == null) return '';
  var n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : '';
}

function upsertWebEvaluation_(request, props) {
  var data = request.evaluation || {};
  var id = String(data.id || '').trim();
  var role = String(data.evaluatorRole || '').trim();
  if (!/^public-[a-z0-9]{8,50}$/i.test(id)) throw new Error('Invalid evaluation ID.');
  if (['purchaser', 'requisitioner', 'amd_personnel'].indexOf(role) < 0) {
    throw new Error('Invalid evaluator role.');
  }
  if (!data.poNumber || !data.submittedAt) throw new Error('Missing required evaluation details.');
  var spreadsheetId = props.getProperty('SUPPLIER_SHEET_ID');
  if (!spreadsheetId) throw new Error('SUPPLIER_SHEET_ID is not configured.');
  assertPrivateWorkbook_(spreadsheetId);
  var satisfaction = data.customerSatisfaction || {};
  var score = data.scores || {};
  var reasons = data.ratingRemarks || {};
  var avg = Number(data.finalRating);
  var row = [
    safeSheetText_(id, 100), safeSheetText_(data.submittedAt, 40),
    safeSheetText_(data.poNumber, 100), safeSheetText_(data.prfNo, 100),
    safeSheetText_(data.supplier, 300), safeSheetText_(data.address, 400),
    safeSheetText_(data.itemsDelivered, 3000), role,
    safeSheetText_(data.evaluatorName, 200), safeSheetText_(data.evaluatorEmail, 250),
    safeScore_(score.accurate_delivery), safeScore_(score.competitive_price),
    safeScore_(score.timeliness), safeScore_(score.after_sales),
    role === 'purchaser' ? safeScore_(score.compliance) : 'N/A',
    Number.isFinite(avg) && avg >= 1 && avg <= 5 ? avg : '',
    safeSheetText_(data.remarks, 3000),
    safeSheetText_(JSON.stringify(reasons), 3000),
    role === 'requisitioner' ? safeScore_(satisfaction.timeliness) : '',
    role === 'requisitioner' ? safeScore_(satisfaction.accuracy) : '',
    role === 'requisitioner' ? safeSheetText_(satisfaction.comments, 3000) : '',
    role === 'requisitioner' ? safeSheetText_(satisfaction.evaluatedBy, 200) : '',
    new Date().toISOString()
  ];

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName(ISO_TAB);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(ISO_TAB);
      sheet.getRange(1, 1, 1, ISO_HEADERS.length).setValues([ISO_HEADERS]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, ISO_HEADERS.length).setBackground('#40266d').setFontColor('#ffffff').setFontWeight('bold');
    }
    var last = sheet.getLastRow();
    var existingRow = 0;
    if (last > 1) {
      var hit = sheet.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
      if (hit) existingRow = hit.getRow();
    }
    if (existingRow) sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    SpreadsheetApp.flush();
    return { message: 'Evaluation synced to official sheet.', evaluationId: id, row: existingRow || sheet.getLastRow(), sheet: ISO_TAB };
  } finally {
    lock.releaseLock();
  }
}

function sendEvaluationEmail_(request) {
  var to = String(request.to || '').trim();
  var subject = String(request.subject || '').trim();
  var body = String(request.textBody || '').trim();
  var html = String(request.htmlBody || '');
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) throw new Error('Invalid recipient email.');
  if (!body || !subject || subject.length > 250) throw new Error('Email subject and body are required.');
  var items = Array.isArray(request.attachments) ? request.attachments : [];
  if (items.length < 1 || items.length > 10) throw new Error('1 to 10 official PO attachments are required.');
  var total = 0;
  var attachments = items.map(function (item, index) {
    var blob;
    var driveId = String(item.fileId || '');
    var url = String(item.url || '');
    if (driveId) {
      if (!/^[A-Za-z0-9_-]{15,150}$/.test(driveId)) throw new Error('Invalid Drive file ID.');
      blob = DriveApp.getFileById(driveId).getBlob();
    } else {
      // Only permit legacy Cloudinary downloads; do not fetch arbitrary URLs.
      if (!/^https:\/\/res\.cloudinary\.com\//i.test(url)) {
        throw new Error('Attachment must reference an authorized Drive file or legacy Cloudinary URL.');
      }
      var res = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) throw new Error('PO attachment could not be downloaded.');
      blob = res.getBlob();
    }
    total += blob.getBytes().length;
    if (total > 20 * 1024 * 1024) throw new Error('Email attachments exceed 20 MB.');
    var name = String(item.name || ('PO-' + (index + 1) + '.pdf')).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
    return blob.setName(name);
  });
  MailApp.sendEmail({
    to: to, subject: subject, body: body, htmlBody: html,
    name: 'Southville Supplier Evaluation', attachments: attachments
  });
  return { message: 'Email accepted by the school Google account.', recipient: to, attachmentCount: attachments.length };
}

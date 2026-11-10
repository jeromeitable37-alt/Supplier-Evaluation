/**
 * SupplierEvaluationISO.gs — Add-on for the existing school Apps Script.
 *
 * Keep Code.gs exactly as it is. This file contains ONLY ISO evaluation sync
 * helpers. It intentionally DOES NOT declare doPost(e) or doGet(e).
 *
 * Because Code.gs has no doPost and ven.gs is currently empty, paste the
 * companion scripts/southville-evaluation-webhook.gs into ven.gs.
 * That companion file handles incoming email and sync requests.
 *
 * Script properties are private. Never paste a secret in the source code.
 * Required: SUPPLIER_SHEET_ID and PMS_WEBHOOK_SECRET (or EMAIL_WEBHOOK_SECRET).
 *
 * The destination Sheet is presently anyone-with-link-viewable; sync is
 * blocked until the workbook owner approves a protected access migration.
 */

var SISC_ISO_TAB_NAME_ = 'WEB_EVALUATIONS';
var SISC_ISO_HEADERS_ = [
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
 * Called only by your EXISTING doPost(e) dispatcher.
 * Double-checks the shared secret even if that dispatcher already authenticates.
 */
function siscIsoSyncEvaluation_(request) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('PMS_WEBHOOK_SECRET') ||
    props.getProperty('EMAIL_WEBHOOK_SECRET');
  if (!secret || secret.length < 24 || !request || request.secret !== secret) {
    throw new Error('Unauthorized or unconfigured ISO sync request.');
  }
  var result = siscIsoUpsertWebEvaluation_(request, props);
  result.ok = true;
  return result;
}

/**
 * Read-only permissions check: run directly in editor while signed in with the
 * school account. No mail is sent, no data is created, no old sheet is modified.
 */
function siscIsoTestSetup() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('PMS_WEBHOOK_SECRET') ||
    props.getProperty('EMAIL_WEBHOOK_SECRET');
  var sheetId = props.getProperty('SUPPLIER_SHEET_ID');
  if (!secret || secret.length < 24) {
    throw new Error('Configure existing PMS_WEBHOOK_SECRET or EMAIL_WEBHOOK_SECRET (24+ characters).');
  }
  if (!sheetId) throw new Error('Set SUPPLIER_SHEET_ID in Script Properties.');
  SpreadsheetApp.openById(sheetId).getName();
  var visibility;
  try {
    visibility = siscIsoCheckWorkbookVisibility_(sheetId);
  } catch (error) {
    var diagnostic = {
      ok: false,
      sheetAccess: 'verified',
      privacyCheck: 'unavailable',
      syncReady: false,
      message: String(error && error.message || error)
    };
    Logger.log(JSON.stringify(diagnostic));
    return diagnostic;
  }
  var folderId = props.getProperty('PO_DRIVE_FOLDER_ID');
  if (folderId) DriveApp.getFolderById(folderId).getName();
  var ready = !visibility.anyoneCanRead;
  var result = {
    ok: ready,
    sheetAccess: 'verified',
    privacyCheck: ready ? 'restricted' : 'anyone-with-link',
    syncReady: ready,
    poDriveFolder: folderId ? 'read-access-verified' : 'not-configured',
    message: ready
      ? 'Sheet access and privacy checks passed.'
      : 'The Sheet has anyone-with-link access; confidential sync is paused. Existing data was not changed.'
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * Do not send evaluator names, emails and scores to a public workbook.
 * A school administrator must change any broad file sharing deliberately.
 */
/**
 * Query Google Drive permissions through the documented API instead of
 * DriveApp.getSharingAccess(), which throws "invalid access settings" in
 * some school-owned shared files. This checks only; it changes no sharing.
 * Uses the authorized user's Apps Script OAuth token (never logs it).
 */
function siscIsoCheckWorkbookVisibility_(sheetId) {
  var endpoint = 'https://www.googleapis.com/drive/v3/files/' +
    encodeURIComponent(sheetId) + '/permissions';
  var entries = 0;
  var publicLink = false;
  var nextToken = '';
  var pages = 0;
  do {
    if (++pages > 20) throw new Error('Workbook permission list was too long to verify.');
    var query = '?pageSize=100&supportsAllDrives=true&fields=' +
      encodeURIComponent('nextPageToken,permissions(type,role,allowFileDiscovery)');
    if (nextToken) query += '&pageToken=' + encodeURIComponent(nextToken);
    var response = UrlFetchApp.fetch(endpoint + query, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error('Unable to read Drive sharing permissions (HTTP ' +
        response.getResponseCode() +
        '). Confirm school account access and Drive API authorization.');
    }
    var parsed = JSON.parse(response.getContentText());
    if (!Array.isArray(parsed.permissions)) {
      throw new Error('Google Drive did not return a verifiable permission list.');
    }
    parsed.permissions.forEach(function (permission) {
      entries++;
      if (permission.type === 'anyone') publicLink = true;
    });
    nextToken = String(parsed.nextPageToken || '');
  } while (nextToken);
  if (entries === 0) throw new Error('No workbook permissions were available to inspect.');
  return { anyoneCanRead: publicLink };
}

function siscIsoAssertPrivateWorkbook_(sheetId) {
  if (siscIsoCheckWorkbookVisibility_(sheetId).anyoneCanRead) {
    throw new Error('The official Sheet is accessible by anyone with the link. Confidential evaluation syncing is paused; no records were changed.');
  }
}

function siscIsoSafeSheetText_(value, maxLength) {
  var text = String(value == null ? '' : value).trim().slice(0, maxLength || 1000);
  // Prevent formulas supplied in submitted text from being evaluated as formulas.
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function siscIsoSafeScore_(value) {
  if (value === '' || value == null) return '';
  var n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : '';
}

function siscIsoUpsertWebEvaluation_(request, props) {
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
  siscIsoAssertPrivateWorkbook_(spreadsheetId);
  var satisfaction = data.customerSatisfaction || {};
  var score = data.scores || {};
  var reasons = data.ratingRemarks || {};
  var avg = Number(data.finalRating);
  var row = [
    siscIsoSafeSheetText_(id, 100), siscIsoSafeSheetText_(data.submittedAt, 40),
    siscIsoSafeSheetText_(data.poNumber, 100), siscIsoSafeSheetText_(data.prfNo, 100),
    siscIsoSafeSheetText_(data.supplier, 300), siscIsoSafeSheetText_(data.address, 400),
    siscIsoSafeSheetText_(data.itemsDelivered, 3000), role,
    siscIsoSafeSheetText_(data.evaluatorName, 200), siscIsoSafeSheetText_(data.evaluatorEmail, 250),
    siscIsoSafeScore_(score.accurate_delivery), siscIsoSafeScore_(score.competitive_price),
    siscIsoSafeScore_(score.timeliness), siscIsoSafeScore_(score.after_sales),
    role === 'purchaser' ? siscIsoSafeScore_(score.compliance) : 'N/A',
    Number.isFinite(avg) && avg >= 1 && avg <= 5 ? avg : '',
    siscIsoSafeSheetText_(data.remarks, 3000),
    siscIsoSafeSheetText_(JSON.stringify(reasons), 3000),
    role === 'requisitioner' ? siscIsoSafeScore_(satisfaction.timeliness) : '',
    role === 'requisitioner' ? siscIsoSafeScore_(satisfaction.accuracy) : '',
    role === 'requisitioner' ? siscIsoSafeSheetText_(satisfaction.comments, 3000) : '',
    role === 'requisitioner' ? siscIsoSafeSheetText_(satisfaction.evaluatedBy, 200) : '',
    new Date().toISOString()
  ];

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName(SISC_ISO_TAB_NAME_);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(SISC_ISO_TAB_NAME_);
      sheet.getRange(1, 1, 1, SISC_ISO_HEADERS_.length).setValues([SISC_ISO_HEADERS_]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, SISC_ISO_HEADERS_.length).setBackground('#40266d').setFontColor('#ffffff').setFontWeight('bold');
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
    return { message: 'Evaluation synced to official sheet.', evaluationId: id, row: existingRow || sheet.getLastRow(), sheet: SISC_ISO_TAB_NAME_ };
  } finally {
    lock.releaseLock();
  }
}


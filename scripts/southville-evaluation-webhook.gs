/**
 * SISC Supplier Evaluation: add this file to the SAME existing Apps Script
 * project as SupplierEvaluationISO.gs. The empty ven.gs may be used.
 *
 * Keep Code.gs and existing manual-form functions unchanged.
 * There must be exactly ONE function doPost(e) across the whole project.
 *
 * POST actions:
 *  - send_email (also the default for legacy website POSTs)
 *  - sync_evaluation (forwards to the ISO extension)
 *
 * Set Script Properties (do not put secrets in these source files):
 *   PMS_WEBHOOK_SECRET  (long random value matching Vercel)
 *   SUPPLIER_SHEET_ID   (the official Sheet ID)
 *   PO_DRIVE_FOLDER_ID  (optional; only after Sir GC approves a private folder)
 */
function doGet(e) {
  // Simple, public health check only. No secrets, staff data, or Drive IDs.
  return siscWebhookJson_({ ok: true, status: 'ready', service: 'supplier-evaluation' });
}

function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) || '';
    if (!body || body.length > 100000) throw new Error('Invalid request.');
    var request = JSON.parse(body);
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('Invalid request body.');
    }

    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('PMS_WEBHOOK_SECRET') ||
      props.getProperty('EMAIL_WEBHOOK_SECRET');
    if (!secret || secret.length < 24 || request.secret !== secret) {
      throw new Error('Unauthorized request.');
    }

    var action = String(request.action || 'send_email');
    if (action === 'sync_evaluation') {
      return siscWebhookJson_(siscIsoSyncEvaluation_(request));
    }
    if (action === 'read_sheet_rows') {
      // The existing shared secret has already been verified above.
      // This read-only action is restricted to approved school tab names.
      return siscWebhookJson_(siscPrivateSheetRead_(request, props));
    }
    if (action === 'upload_po') {
      return siscWebhookJson_(siscDriveUploadPo_(request));
    }
    if (action === 'get_po_file') {
      return siscWebhookJson_(siscDriveGetPoFile_(request));
    }
    if (action === 'send_email') {
      return siscWebhookJson_(siscWebhookSendEmail_(request, props));
    }
    throw new Error('Unsupported action.');
  } catch (error) {
    return siscWebhookJson_({
      ok: false,
      message: String(error && error.message ? error.message : 'Request failed.'),
    });
  }
}

function siscWebhookJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Call from the editor for a READ-ONLY check. It does not email or write.
 * ISO sheet permission check is separate: run siscIsoTestSetup().
 */
function siscWebhookCheckSetup() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('PMS_WEBHOOK_SECRET') ||
    props.getProperty('EMAIL_WEBHOOK_SECRET');
  if (!secret || secret.length < 24) {
    throw new Error('Set PMS_WEBHOOK_SECRET or EMAIL_WEBHOOK_SECRET (24+ chars).');
  }
  var sheetId = props.getProperty('SUPPLIER_SHEET_ID');
  if (!sheetId) throw new Error('SUPPLIER_SHEET_ID is not configured.');
  SpreadsheetApp.openById(sheetId).getName();
  var result = {
    ok: true,
    ready: true,
    sheetAccess: 'verified',
    mailQuotaRemaining: MailApp.getRemainingDailyQuota()
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function siscWebhookSendEmail_(request, props) {
  var to = String(request.to || '').trim();
  var subject = String(request.subject || '').trim();
  var textBody = String(request.textBody || '').trim();
  var htmlBody = String(request.htmlBody || '');
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) {
    throw new Error('Enter exactly one valid recipient email.');
  }
  if (!subject || subject.length > 250 || !textBody) {
    throw new Error('Email subject and text body are required.');
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('Google account daily email recipient quota reached.');
  }

  var files = Array.isArray(request.attachments) ? request.attachments : [];
  if (files.length < 1 || files.length > 10) {
    throw new Error('Supply 1 to 10 official PO attachments.');
  }
  var total = 0;
  var attachments = files.map(function (entry, index) {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid PO document.');
    var fileId = String(entry.fileId || '');
    var url = String(entry.url || '');
    var blob;

    if (fileId) {
      if (!/^[A-Za-z0-9_-]{15,150}$/.test(fileId)) {
        throw new Error('Invalid Drive file ID.');
      }
      // Never accept an arbitrary Drive file. It MUST be within the private
      // school-owned PO archive configured by the authorized script owner.
      var folderId = String(props.getProperty('PO_DRIVE_FOLDER_ID') || '');
      if (!folderId) throw new Error('School PO Drive folder is not configured.');
      var driveFile = DriveApp.getFileById(fileId);
      if (!siscWebhookFileInFolder_(driveFile, folderId)) {
        throw new Error('PO file is not inside the approved school Drive folder.');
      }
      blob = driveFile.getBlob();
    } else {
      // For the migration period only: existing trusted Cloudinary PO URLs.
      if (!/^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\//i.test(url)) {
        throw new Error('Only approved Google Drive or Cloudinary PO attachments are supported.');
      }
      var fetched = UrlFetchApp.fetch(url, {
        method: 'get', followRedirects: false, muteHttpExceptions: true
      });
      if (fetched.getResponseCode() !== 200) {
        throw new Error('Unable to fetch official PO attachment ' + (index + 1) + '.');
      }
      blob = fetched.getBlob();
    }
    total += blob.getBytes().length;
    if (total > 20 * 1024 * 1024) {
      throw new Error('PO attachments exceed the 20 MB email size limit.');
    }
    var filename = String(entry.name || 'PO-document-' + (index + 1) + '.pdf')
      .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
    return blob.setName(filename);
  });

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: textBody,
    htmlBody: htmlBody,
    name: 'Southville Supplier Evaluation',
    attachments: attachments
  });
  return {
    ok: true,
    message: 'Evaluation email accepted by the executing school account.',
    recipient: to,
    attachmentCount: attachments.length
  };
}

/**
 * Allow direct children and files in nested PO subfolders; reject files from
 * anywhere else, even when the executing school account can view them.
 */
function siscWebhookFileInFolder_(file, approvedFolderId) {
  var checked = {};
  var pending = [];
  var parents = file.getParents();
  while (parents.hasNext()) pending.push(parents.next());
  var maxLookups = 60;
  while (pending.length && maxLookups-- > 0) {
    var folder = pending.shift();
    var id = folder.getId();
    if (id === approvedFolderId) return true;
    if (checked[id]) continue;
    checked[id] = true;
    var ancestors = folder.getParents();
    while (ancestors.hasNext()) pending.push(ancestors.next());
  }
  return false;
}

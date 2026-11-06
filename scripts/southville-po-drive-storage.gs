/**
 * PoDriveStorage.gs — Private PO storage for the same school Apps Script project.
 *
 * ADD to the existing project. Do NOT add a second doPost(e).
 * The webhook file calls siscDriveUploadPo_ / siscDriveGetPoFile_.
 *
 * The webhook's shared secret is checked before these functions are called.
 * Never expose the secret in client-side code or public Sheet cells.
 * Uses PO_DRIVE_FOLDER_ID. New files are private/inherited from that folder.
 *
 * Stage 1 limit: 8 MiB per file for Apps Script JSON/base64 transport.
 * Larger files require a future Drive resumable-upload implementation.
 */

var SISC_PO_UPLOAD_LIMIT_ = 8 * 1024 * 1024;
var SISC_PO_ALLOWED_MIMES_ = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true
};

function siscDriveFolder_() {
  var id = String(PropertiesService.getScriptProperties()
    .getProperty('PO_DRIVE_FOLDER_ID') || '').trim();
  if (!/^[A-Za-z0-9_-]{15,150}$/.test(id)) {
    throw new Error('Configure an authorized PO_DRIVE_FOLDER_ID first.');
  }
  return DriveApp.getFolderById(id);
}

function siscDriveAllowedFile_(file) {
  var mime = String(file.mimeType || '').toLowerCase();
  if (!SISC_PO_ALLOWED_MIMES_[mime]) {
    throw new Error('Only PDF, JPEG, PNG and WebP official PO files are permitted.');
  }
  return mime;
}

function siscDriveCheckMagic_(bytes, mime) {
  if (!bytes || !bytes.length) throw new Error('Empty PO file.');
  var u = function (n) { return (bytes[n] || 0) & 255; };
  if (mime === 'application/pdf') {
    if (u(0)!==37 || u(1)!==80 || u(2)!==68 || u(3)!==70 || u(4)!==45) {
      throw new Error('File contents do not match a PDF.');
    }
  } else if (mime === 'image/jpeg') {
    if (u(0)!==255 || u(1)!==216 || u(2)!==255) {
      throw new Error('File contents do not match a JPEG.');
    }
  } else if (mime === 'image/png') {
    if (u(0)!==137 || u(1)!==80 || u(2)!==78 || u(3)!==71) {
      throw new Error('File contents do not match a PNG.');
    }
  } else if (mime === 'image/webp') {
    var str = String.fromCharCode.apply(null, bytes.slice(0, 4).map(u));
    var fmt = String.fromCharCode.apply(null, bytes.slice(8, 12).map(function(x) { return x & 255; }));
    if (str !== 'RIFF' || fmt !== 'WEBP') {
      throw new Error('File contents do not match a WebP.');
    }
  }
}

function siscDriveUploadPo_(request) {
  var upload = request && request.upload || {};
  var po = String(upload.poNumber || '').trim();
  var prf = String(upload.prfNumber || '').trim();
  var rawName = String(upload.name || '').trim();
  var mime = siscDriveAllowedFile_(upload);
  var encoded = String(upload.base64 || '');
  if (!po || po.length > 100 || !/^[\w\s#./-]+$/.test(po)) {
    throw new Error('A valid PO number is required.');
  }
  if (prf.length > 100) throw new Error('Invalid PRF number.');
  if (!encoded || encoded.length > Math.ceil(SISC_PO_UPLOAD_LIMIT_ * 4/3) + 50 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('PO file is missing, invalid or too large.');
  }
  var content = Utilities.base64Decode(encoded);
  if (content.length > SISC_PO_UPLOAD_LIMIT_) throw new Error('PO file exceeds 8 MiB limit.');
  siscDriveCheckMagic_(content, mime);

  // No public sharing and no new public link: files inherit the authorized
  // school folder's restrictions. Avoid path separators/control characters.
  var filename = rawName.replace(/[\\/\u0000-\u001f]/g, '_')
    .replace(/[^a-zA-Z0-9._() -]/g, '_').slice(0, 130);
  if (!filename) filename = 'official-po';
  var stamp = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyyMMdd-HHmmss');
  var safePo = po.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  var savedName = safePo + '-' + stamp + '-' + filename;
  var blob = Utilities.newBlob(content, mime, savedName);
  var file = siscDriveFolder_().createFile(blob);
  file.setDescription('Official PO ' + po + (prf ? ' | PRF ' + prf : '') +
    ' | Uploaded through authorized Supplier Evaluation staff endpoint.');

  return {
    ok: true,
    provider: 'google-drive',
    fileId: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    size: file.getSize()
  };
}

/**
 * Fetch only a file under the approved PO folder. This is called by a trusted
 * server endpoint after verifying staff identity, never directly from browser.
 */
function siscDriveGetPoFile_(request) {
  var fileId = String(request && request.fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{15,150}$/.test(fileId)) throw new Error('Invalid PO file ID.');
  var approvedFolder = siscDriveFolder_();
  var file = DriveApp.getFileById(fileId);
  if (!siscWebhookFileInFolder_(file, approvedFolder.getId())) {
    throw new Error('File is outside the authorized Southville PO archive.');
  }
  var mime = siscDriveAllowedFile_({ mimeType: file.getMimeType() });
  if (file.getSize() > SISC_PO_UPLOAD_LIMIT_) {
    throw new Error('This file needs the large-file Drive preview integration.');
  }
  var bytes = file.getBlob().getBytes();
  siscDriveCheckMagic_(bytes, mime);
  return {
    ok: true,
    fileId: file.getId(),
    name: file.getName(),
    mimeType: mime,
    size: file.getSize(),
    base64: Utilities.base64Encode(bytes)
  };
}

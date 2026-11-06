/**
 * PO Drive write-permission check for the existing Southville Apps Script.
 * Add this as a NEW file: PoDriveTest.gs. Do not overwrite Code.gs or ven.gs.
 *
 * Run ONLY from the Apps Script editor as the authorized school account.
 * Creates a small temporary text file in the approved PO folder, then
 * immediately moves that test file to trash. It does not touch real POs.
 *
 * Required script property:
 *   PO_DRIVE_FOLDER_ID = approved private school PO folder
 *
 * Note: a successful test proves Apps Script can write to this folder.
 * It does NOT yet make the website upload automatically. That requires
 * a staff-authenticated server route and signed/authorized Drive access.
 */
function siscTestPoDriveWriteAccess() {
  var folderId = PropertiesService.getScriptProperties()
    .getProperty('PO_DRIVE_FOLDER_ID');
  if (!folderId || !/^[A-Za-z0-9_-]{15,150}$/.test(folderId)) {
    throw new Error('PO_DRIVE_FOLDER_ID is missing or invalid.');
  }

  var folder = DriveApp.getFolderById(folderId);
  var testName = 'SISC-TEST-DELETE-ME-' + Utilities.getUuid() + '.txt';
  var tempFile = null;
  var cleanedUp = false;
  var created = false;

  try {
    tempFile = folder.createFile(
      testName,
      'Temporary write permission test; not a purchase order.',
      MimeType.PLAIN_TEXT
    );
    created = true;
  } finally {
    if (tempFile) {
      try {
        tempFile.setTrashed(true);
        cleanedUp = true;
      } catch (cleanupError) {
        Logger.log('WARNING: Temporary test file was created but cleanup failed. ' +
          'Ask the authorized Drive owner to delete the SISC-TEST-DELETE-ME file. ' +
          String(cleanupError && cleanupError.message || cleanupError));
      }
    }
  }

  var result = {
    ok: created && cleanedUp,
    folderRead: 'verified',
    folderWrite: created ? 'verified' : 'not-verified',
    temporaryFileCleanup: cleanedUp ? 'trashed' : 'needs-manual-check',
    websiteAutoUpload: 'not-yet-configured'
  };
  Logger.log(JSON.stringify(result));
  return result;
}

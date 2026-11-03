/**
 * Southville Supplier Evaluation - Google Apps Script email sender.
 *
 * IMPORTANT: Create/deploy this project while signed in as
 * do.not.reply.southville@gmail.com. Deploy -> New deployment -> Web app:
 * Execute as: Me, Who has access: Anyone. An EMAIL_WEBHOOK_SECRET must be
 * configured in Project Settings -> Script Properties before deployment.
 *
 * No passwords or tokens should be placed in this source.
 */

function doPost(e) {
  try {
    var storedSecret = PropertiesService.getScriptProperties().getProperty('EMAIL_WEBHOOK_SECRET');
    if (!storedSecret || storedSecret.length < 16) {
      throw new Error('EMAIL_WEBHOOK_SECRET has not been configured.');
    }

    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (request.secret !== storedSecret) {
      throw new Error('Unauthorized email request.');
    }

    var to = String(request.to || '').trim();
    var subject = String(request.subject || '').trim();
    var textBody = String(request.textBody || '').trim();
    var htmlBody = String(request.htmlBody || '');
    var senderName = 'Southville Supplier Evaluation';

    // This endpoint is intended for one recipient per evaluation link.
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) {
      throw new Error('Please supply one valid recipient email.');
    }
    if (!subject || subject.length > 250 || !textBody) {
      throw new Error('The email must include a subject and text body.');
    }

    var requested = Array.isArray(request.attachments) ? request.attachments : [];
    if (!requested.length || requested.length > 10) {
      throw new Error('1 to 10 stored PO attachments are required.');
    }

    // PO files used by the website are uploaded to Cloudinary. Do not
    // blindly fetch arbitrary URLs supplied by an email API client.
    var attachments = [];
    var totalBytes = 0;
    requested.forEach(function (item, index) {
      var url = String((item && item.url) || '');
      if (!/^https:\/\/res\.cloudinary\.com\//i.test(url)) {
        throw new Error('Attachment ' + (index + 1) + ' must be a Cloudinary HTTPS file.');
      }

      var response = UrlFetchApp.fetch(url, {
        method: 'get',
        followRedirects: true,
        muteHttpExceptions: true
      });
      if (response.getResponseCode() !== 200) {
        throw new Error('Could not download official PO attachment ' + (index + 1) + '.');
      }
      var blob = response.getBlob();
      totalBytes += blob.getBytes().length;
      if (totalBytes > 20 * 1024 * 1024) {
        throw new Error('Total PO attachments exceed 20 MB; reduce the file size.');
      }
      var fileName = String(item.name || 'purchase-order-' + (index + 1) + '.pdf')
        .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
      attachments.push(blob.setName(fileName));
    });

    // MailApp uses the account that authorized and executes this script.
    // Changing the `name` option alone never changes the real From address.
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: senderName,
      attachments: attachments
    });

    return asJson({
      ok: true,
      message: 'Evaluation email accepted by Gmail.',
      recipient: to,
      attachmentCount: attachments.length
    });
  } catch (error) {
    return asJson({
      ok: false,
      message: error && error.message ? String(error.message) : 'Could not send evaluation email.'
    });
  }
}

function asJson(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

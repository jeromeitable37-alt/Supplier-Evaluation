/**
 * Plain, recognizable, one-link transactional email for supplier evaluations.
 * HTML and text versions carry the same information. Deliverability is
 * determined by recipient providers; no template can guarantee Inbox delivery.
 */

export type SupplierEvaluationEmailInput = {
  recipientName: string;
  roleLabel: string;
  poNumber: string;
  supplierName?: string;
  evaluationUrl: string;
  schoolName?: string;
  isReminder?: boolean;
};

function plain(value: unknown): string {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 350);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildSupplierEvaluationEmail(input: SupplierEvaluationEmailInput) {
  const recipient = plain(input.recipientName) || "Evaluator";
  const role = plain(input.roleLabel) || "Supplier Evaluation";
  const poNumber = plain(input.poNumber);
  const supplier = plain(input.supplierName) || "Not specified";
  const school = plain(input.schoolName) || "Southville International School and Colleges";
  const link = String(input.evaluationUrl || "").trim();
  if (!poNumber || !/^https?:\/\/[^ ]+$/i.test(link)) {
    throw new Error("A PO number and a valid evaluation link are required.");
  }
  const heading = input.isReminder ? "Reminder: Supplier Evaluation" : "Supplier Evaluation Request";
  const subject = "Southville Purchasing | " + (input.isReminder ? "Reminder - " : "") + role + " - PO " + poNumber;
  const reason = input.isReminder
    ? "This is a reminder from the Purchasing Office about your pending supplier evaluation."
    : "The Purchasing Office is requesting your supplier evaluation for the purchase order below.";
  const ending = "This evaluation link is intended only for you. If you did not expect this request, contact the Purchasing Office through your usual school contact channels.";
  const signoff = "Thank you,\nPurchasing Office\n" + school;
  const text = [
    "Hello " + recipient + ",",
    reason,
    "PO number: " + poNumber,
    "Supplier: " + supplier,
    "Evaluation: " + role,
    "The official Purchase Order is attached for your reference.",
    "Complete your evaluation using this link:\n" + link,
    ending,
    signoff,
    "Sent from do.not.reply.southville@gmail.com. This mailbox is not monitored."
  ].join("\n\n");
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:20px;background:#ffffff;color:#202124;font:14px/1.6 Arial,Helvetica,sans-serif">',
    '<div style="max-width:600px;margin:0 auto">',
    '<h2 style="font-size:18px;font-weight:600;margin:0 0 18px">' + escapeHtml(heading) + '</h2>',
    '<p>Hello ' + escapeHtml(recipient) + ',</p>',
    '<p>' + escapeHtml(reason) + '</p>',
    '<p><strong>PO number:</strong> ' + escapeHtml(poNumber) + '<br>',
    '<strong>Supplier:</strong> ' + escapeHtml(supplier) + '<br>',
    '<strong>Evaluation:</strong> ' + escapeHtml(role) + '</p>',
    '<p>The official Purchase Order is attached for your reference.</p>',
    '<p><strong>Complete your evaluation using this link:</strong><br>',
    '<a style="color:#164e84;word-break:break-word" href="' + escapeHtml(link) + '">' + escapeHtml(link) + '</a></p>',
    '<p>' + escapeHtml(ending) + '</p>',
    '<p>Thank you,<br>Purchasing Office<br>' + escapeHtml(school) + '</p>',
    '<p style="font-size:12px;color:#666">Sent from do.not.reply.southville@gmail.com. This mailbox is not monitored.</p>',
    '</div></body></html>'
  ].join("");
  return { subject, html, text };
}

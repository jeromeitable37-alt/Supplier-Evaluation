import { NextResponse } from "next/server";
import { appPool, appSession, requirePermission, AppAccessError } from "../../../lib/server/neonAppAuth";

export const runtime = "nodejs";
const TEST_PO = "32187";
const TEST_NAME = "JC Campit";
const TEST_ID = "purchasing-jc-32187";
const CONFIRM = "SEND_TEST_JC_32187";
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Explicit one-recipient connectivity test. Does not create evaluations,
 * mark evaluation links emailed, enable bulk sends, or sync any school Sheets.
 * Available only on Vercel Preview with the isolated Neon backend.
 */
export async function POST(request: Request) {
  try {
    if (process.env.VERCEL_ENV !== "preview" ||
        process.env.NEXT_PUBLIC_DATA_BACKEND !== "neon") {
      throw new AppAccessError("This test is available only on the Neon Preview.", 403);
    }
    const session = await appSession(request);
    requirePermission(session, "create_evaluations");
    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== CONFIRM) {
      throw new AppAccessError("Confirm the single-recipient test before sending.", 400);
    }

    const db = appPool();
    const result = await db.query(
      "SELECT payload FROM se_evaluation_links WHERE evaluator_role='purchaser' " +
      "AND link_status='pending' AND payload->'po'->>'poNumber'=$1 " +
      "AND lower(btrim(payload->>'evaluatorName'))=lower($2) " +
      "ORDER BY imported_at DESC LIMIT 1",
      [TEST_PO, TEST_NAME],
    );
    const record = result.rows[0]?.payload as Record<string, unknown> | undefined;
    if (!record) throw new AppAccessError("A pending test recipient record for Sir JC was not found.", 409);
    const recipient = String(record.evaluatorEmail || "").trim().toLowerCase();
    if (!EMAIL.test(recipient)) throw new AppAccessError("Sir JC's email is missing or invalid.", 400);

    const po = (record.po && typeof record.po === "object")
      ? record.po as Record<string, unknown> : {};
    if (po.documentProvider !== "google-drive") {
      throw new AppAccessError("An official private PO is required for this email test.", 409);
    }
    const pages = Array.isArray(po.documentPages) && po.documentPages.length
      ? po.documentPages : [{fileId:po.documentFileId,mimeType:po.documentMimeType}];
    const attachments = pages.slice(0,3).map((page, i) => {
      const doc = page && typeof page === "object" ? page as Record<string, unknown> : {};
      const fileId = String(doc.fileId || "");
      const mimeType = String(doc.mimeType || "application/pdf");
      const ext = mimeType.startsWith("image/") ? ".jpg" : ".pdf";
      return {fileId,name:"TEST-PO-"+TEST_PO+"-page-"+(i+1)+ext,mimeType};
    });
    if (!attachments.length || attachments.some(item => !/^[A-Za-z0-9_-]{15,150}$/.test(item.fileId))) {
      throw new AppAccessError("The secure PO attachment reference is incomplete.",409);
    }
    const endpoint = String(process.env.GOOGLE_APPS_SCRIPT_EMAIL_URL || "").trim();
    const secret = String(process.env.PMS_WEBHOOK_SECRET ||
      process.env.GOOGLE_APPS_SCRIPT_SECRET || "").trim();
    if (!endpoint.startsWith("https://script.google.com/") || !secret) {
      throw new AppAccessError("School email integration is not configured for this test.", 503);
    }

    // A database-enforced cooldown prevents repeated or concurrent test emails.
    const claim = await db.query(
      "INSERT INTO se_email_test_log(test_id,status,attempted_at) VALUES($1,'sending',now()) "+
      "ON CONFLICT(test_id) DO UPDATE SET status='sending',attempted_at=now(),error_type=NULL "+
      "WHERE ((se_email_test_log.status='sent' AND se_email_test_log.sent_at < now()-interval '24 hours') "+
      "OR (se_email_test_log.status<>'sent' AND "+
      "(se_email_test_log.attempted_at IS NULL OR se_email_test_log.attempted_at < now()-interval '5 minutes'))) "+
      "RETURNING test_id", [TEST_ID],
    );
    if (!claim.rowCount) throw new AppAccessError(
      "A test was already sent or attempted recently. Only one successful test per 24 hours is allowed.",429);

    try {
      const subject = "[TEST ONLY] Purchasing Evaluation Email | PO "+TEST_PO;
      const message = "Hello Sir JC,\n\nThis is an authorized test of the Supplier Evaluation email delivery. "+
        "The official PO is attached for checking only. No evaluation is requested and no response is needed.\n\n"+
        "Test PO: "+TEST_PO+"\n\nThis is not a production evaluation request.";
      const response = await fetch(endpoint,{
        method:"POST",
        headers:{"Content-Type":"application/json",Accept:"application/json"},
        cache:"no-store",
        signal:AbortSignal.timeout(30000),
        body:JSON.stringify({
          secret,to:recipient,subject,
          htmlBody:"<p>Hello Sir JC,</p><p><strong>TEST ONLY:</strong> This is an authorized "+
            "delivery test for Purchasing Evaluation, PO "+TEST_PO+".</p>"+
            "<p>The official PO is attached for checking. "+
            "No evaluation response is required.</p><p>This is not a production evaluation request.</p>",
          textBody:message,
          senderName:"Southville Supplier Evaluation",
          attachments,
        }),
      });
      const raw = await response.text();
      let result: {ok?:boolean;message?:string}={};
      try {result=JSON.parse(raw)} catch {/* handled below */}
      if (!response.ok || result.ok !== true) {
        throw new Error(result.message ||
          "The school Apps Script has not accepted the test. Verify its Drive attachment handling.");
      }
      await db.query("UPDATE se_email_test_log SET status='sent',sent_at=now(),error_type=NULL WHERE test_id=$1",[TEST_ID]);
      return NextResponse.json({
        ok:true,accepted:true,
        message:"One Purchasing test email was accepted by the school sender. Check Sir JC's Inbox and Spam.",
        attachmentCount:attachments.length,
      },{headers:{"Cache-Control":"no-store"}});
    } catch(err) {
      await db.query(
        "UPDATE se_email_test_log SET status='failed',error_type=$2 WHERE test_id=$1",
        [TEST_ID,"provider-or-network-error"],
      );
      throw err;
    }
  } catch (error) {
    return NextResponse.json({
      ok:false,
      message:error instanceof Error ? error.message : "Could not send the one-recipient test.",
    },{status:error instanceof AppAccessError?error.status:502,
      headers:{"Cache-Control":"no-store"}});
  }
}

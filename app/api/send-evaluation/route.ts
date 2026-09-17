import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { to, name, po, evaluationUrl, poDocumentUrl, poDocumentName, workspace } = await request.json();
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) {
      return NextResponse.json({ ok: false, configured: false, message: "RESEND_API_KEY and RESEND_FROM_EMAIL are not configured." }, { status: 503 });
    }
    if (!to || !evaluationUrl || !po?.poNumber) {
      return NextResponse.json({ ok: false, message: "Missing recipient or evaluation details." }, { status: 400 });
    }
    if (!poDocumentUrl) {
      return NextResponse.json({ ok: false, message: "The official PO document must be uploaded and stored before sending." }, { status: 400 });
    }

    const subject = `[${workspace?.name || "SISC"}] Supplier Evaluation Request — ${po.poNumber}`;
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5fb;font-family:Arial,Helvetica,sans-serif;color:#111827"><div style="max-width:660px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb"><div style="background:#102e24;padding:24px 28px;color:#fff"><div style="font-size:12px;opacity:.72;text-transform:uppercase;letter-spacing:1px">${workspace?.name || "Southville International School and Colleges"}</div><div style="font-size:22px;font-weight:700;margin-top:5px">Supplier Evaluation Request</div></div><div style="padding:28px"><p>Hello <strong>${name || po.requisitioner || "Requisitioner"}</strong>,</p><p>Please review the attached official Purchase Order for your request, then complete the supplier evaluation for this transaction.</p><div style="margin:18px 0;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc"><div><strong>PO Number:</strong> ${po.poNumber}</div><div><strong>Supplier:</strong> ${po.vendorName || "—"}</div><div><strong>PRF No.:</strong> ${po.prfNumber || "—"}</div><div><strong>Total:</strong> Php ${Number(po.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</div></div><div style="text-align:center;margin:28px 0"><a href="${evaluationUrl}" style="display:inline-block;background:#2a895b;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-weight:700">Open PO & Complete Evaluation</a></div><p style="font-size:12px;color:#6b7280">The official PO is attached to this email and is also available in the evaluation page. The evaluation can only be submitted once using this unique link.</p></div></div></body></html>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        attachments: [{ path: poDocumentUrl, filename: poDocumentName || `${po.poNumber}.pdf` }],
      }),
    });

    const data = await response.json();
    if (!response.ok) return NextResponse.json({ ok: false, configured: true, message: data?.message || "Email provider rejected the request." }, { status: response.status });
    return NextResponse.json({ ok: true, id: data?.id || "", attached: true });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Unable to send evaluation email." }, { status: 500 });
  }
}

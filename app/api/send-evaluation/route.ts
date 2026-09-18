import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { to, name, po, evaluationUrl, poDocumentUrl, poDocumentName, workspace } = await request.json();
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "").replace(/\/$/, "");
    const logoUrl = appUrl ? `${appUrl.startsWith("http") ? appUrl : `https://${appUrl}`}/sisc-logo.png` : "/sisc-logo.png";
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
    const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
      body{margin:0;padding:0;background:#f3f6f4;font-family:Arial,Helvetica,sans-serif;color:#152019}
      .wrap{width:100%;padding:28px 12px;box-sizing:border-box}
      .card{max-width:680px;margin:0 auto;background:#fff;border:1px solid #dde7e1;border-radius:16px;overflow:hidden}
      .head{padding:18px 22px;background:#4f247c;color:#fff;display:flex;align-items:center;gap:13px}
      .logo{width:54px;height:54px;border-radius:12px;background:#fff;padding:3px;box-sizing:border-box;object-fit:contain}
      .kicker{font-size:10px;letter-spacing:1.2px;text-transform:uppercase;opacity:.78}
      .title{font-size:21px;font-weight:700;margin-top:4px}
      .body{padding:24px 22px}
      .intro{font-size:14px;line-height:1.65;margin:0 0 10px}
      .details{margin:18px 0;padding:14px;border:1px solid #e1e9e4;border-radius:12px;background:#f8faf9}
      .row{padding:7px 0;border-bottom:1px solid #e8eeea;font-size:13px}
      .row:last-child{border-bottom:0}
      .label{display:inline-block;width:125px;color:#67776e;font-weight:700}
      .cta{text-align:center;margin:22px 0}
      .cta a{display:inline-block;background:#0f7b53;color:#fff;text-decoration:none;padding:13px 21px;border-radius:9px;font-size:14px;font-weight:700}
      .note{font-size:12px;line-height:1.6;color:#6b7a72;margin:0}
      .footer{padding:13px 22px;border-top:1px solid #e8eeea;background:#fbfcfb;font-size:11px;color:#84928b}
      @media(max-width:520px){.wrap{padding:10px 7px}.head{padding:14px}.body{padding:18px 14px}.title{font-size:18px}.logo{width:46px;height:46px}.label{display:block;width:auto;margin-bottom:2px}.row{font-size:12px}.cta a{display:block}.footer{padding:12px 14px}}
    </style></head><body><div class="wrap"><div class="card"><div class="head"><img class="logo" src="${logoUrl}" alt="Southville International School and Colleges"><div><div class="kicker">${workspace?.name || "Southville International School and Colleges"}</div><div class="title">Supplier Evaluation Request</div></div></div><div class="body"><p class="intro">Hello <strong>${name || po.requisitioner || "Requisitioner"}</strong>,</p><p class="intro">Please review the attached official Purchase Order and complete the supplier evaluation for this transaction.</p><div class="details"><div class="row"><span class="label">PO Number</span>${po.poNumber}</div><div class="row"><span class="label">Supplier</span>${po.vendorName || "—"}</div><div class="row"><span class="label">PRF No.</span>${po.prfNumber || "—"}</div><div class="row"><span class="label">Total Amount</span>Php ${Number(po.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</div></div><div class="cta"><a href="${evaluationUrl}">Open PO &amp; Complete Evaluation</a></div><p class="note">The official PO is attached to this email and is also available on the evaluation page. Your unique evaluation link accepts one completed submission.</p></div><div class="footer">Purchasing Supplier Evaluation System · ${workspace?.address || "Southville International School and Colleges"}</div></div></div></body></html>`;

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

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseDataUrl(value: string) {
  const match = String(value || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("The uploaded file is not a valid data URL.");
  return { mimeType: match[1], data: match[2] };
}

function extractText(result: any) {
  const parts = result?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new Error("Gemini returned no readable response.");
  return parts.map((part: any) => String(part?.text || "")).filter(Boolean).join("\n");
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ ok: false, message: "GEMINI_API_KEY is not configured." }, { status: 503 });

    const body = await request.json();
    const { image } = body || {};
    const { mimeType, data } = parseDataUrl(image);
    if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i.test(mimeType)) {
      return NextResponse.json({ ok: false, message: "Gemini PO extraction expects a PDF or image scan (JPG, PNG, WEBP, HEIC or HEIF)." }, { status: 400 });
    }
    if (data.length > 28_000_000) return NextResponse.json({ ok: false, message: "The PO document is too large for inline Gemini processing. Compress the scan first." }, { status: 413 });

    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const prompt = `Read this purchase order document (PDF or image) and return ONLY valid JSON. Do not guess values that are not visible. Preserve the wording and spelling visible in the document. Use empty strings for missing text. Extract all visible purchase details, especially pricing, delivery dates, actual delivery date, received-by person, and buyer. Return this schema exactly:\n{"poNumber":"","supplier":"","attention":"","vendorPhone":"","vendorEmail":"","vendorAddress":"","vendorCity":"","deliveryAddress":"","orderDate":"","expectedDate":"","actualDeliveryDate":"","paymentTerms":"","prfNumber":"","requisitioner":"","purpose":"","buyerName":"","receivedBy":"","status":"","items":[{"description":"","unit":"","qty":"","unitPrice":"","lineTotal":"","itemDiscountPct":""}],"subtotal":"","discountPct":"","discountAmt":"","total":"","notes":""}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data } }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
    const raw = await response.text();
    if (!response.ok) return NextResponse.json({ ok: false, message: `Gemini request failed: ${raw.slice(0, 700)}` }, { status: response.status });

    const text = extractText(JSON.parse(raw)).replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(text);
    return NextResponse.json({ ok: true, data: parsed, model });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Gemini PO extraction failed." }, { status: 500 });
  }
}

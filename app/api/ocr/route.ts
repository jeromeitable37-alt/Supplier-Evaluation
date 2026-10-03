import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function parseDataUrl(value: string) {
  const match = String(value || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("The uploaded file is not a valid image data URL.");
  return { mimeType: match[1], data: match[2] };
}

function extractText(result: any): string {
  const parts = result?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new Error("Gemini returned no readable extraction.");
  const text = parts.map((part: any) => String(part?.text || "")).filter(Boolean).join("\n");
  if (!text) throw new Error("Gemini returned no readable extraction.");
  return text;
}

async function callGemini(model: string, apiKey: string, prompt: string, mimeType: string, data: string) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data } }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const image = body?.image;
    if (!image || typeof image !== "string") {
      return NextResponse.json({ error: "No document image was provided." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured. Add it to your .env.local or Vercel Environment Variables." }, { status: 500 });
    }

    const { mimeType, data } = parseDataUrl(image);
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) {
      return NextResponse.json({ error: "Gemini document scanning expects a JPG, PNG, WEBP, HEIC, or HEIF image." }, { status: 400 });
    }
    if (data.length > 28_000_000) {
      return NextResponse.json({ error: "The scan is too large for inline Gemini processing. Compress the image first." }, { status: 413 });
    }

    // Flash-Lite is specifically suited to multimodal document parsing and is a better fit for OCR than the heavier 3.8 Flash model.
    const preferredModel = process.env.GEMINI_OCR_MODEL || "gemini-3.5-flash-lite";
    const fallbackModel = "gemini-3.8-flash";
    const prompt = `You are extracting data from a Southville International School and Colleges Supplier Evaluation Form. Return ONLY valid JSON. Preserve text faithfully. Do not guess values that are not visible. If a handwritten or printed field is unreadable, use an empty string for text and null for a rating. Ratings must be numbers 1-5 or null. Dates must be YYYY-MM-DD when readable. Required JSON keys: prfNo, poNumber, itemsDelivered, evaluationDate, supplier, address, remarks, purchasingA, purchasingB, purchasingC, purchasingD, purchasingE, requisitionerA, requisitionerB, requisitionerC, requisitionerD, amdA, amdB, amdC, amdD. The form has five Purchasing criteria, four Requisitioner criteria, and four AMD criteria. Carefully inspect check marks, circled scores, handwritten entries, names, dates, PRF numbers, PO numbers, supplier information, and remarks. Return the JSON object only, with no markdown fences.`;

    let response = await callGemini(preferredModel, apiKey, prompt, mimeType, data);
    let modelUsed = preferredModel;

    // 503 means temporary model unavailability. Try the other stable multimodal model once before failing.
    if (response.status === 503 && fallbackModel !== preferredModel) {
      response = await callGemini(fallbackModel, apiKey, prompt, mimeType, data);
      modelUsed = fallbackModel;
    }

    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: `Gemini request failed: ${raw.slice(0, 700)}` }, { status: response.status });
    }

    const text = extractText(JSON.parse(raw)).replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(text);
    return NextResponse.json({ data: parsed, model: modelUsed, provider: "Gemini" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Gemini document extraction failed." }, { status: 500 });
  }
}

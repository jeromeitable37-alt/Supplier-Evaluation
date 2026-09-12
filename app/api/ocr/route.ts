import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const image = body?.image;
    if (!image || typeof image !== "string") return NextResponse.json({ error: "No document image was provided." }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured. Add it to your .env.local or Vercel Environment Variables." }, { status: 500 });

    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const prompt = `You are extracting data from a Southville International School and Colleges Supplier Evaluation Form. Return ONLY valid JSON. Preserve text faithfully. If a handwritten or printed field is unreadable, use an empty string for text and null for a rating. Ratings must be numbers 1-5 or null. Dates must be YYYY-MM-DD when readable. Required JSON keys: prfNo, poNumber, itemsDelivered, evaluationDate, supplier, address, remarks, purchasingA, purchasingB, purchasingC, purchasingD, purchasingE, requisitionerA, requisitionerB, requisitionerC, requisitionerD, amdA, amdB, amdC, amdD. The form has five Purchasing criteria, four Requisitioner criteria, and four AMD criteria. Carefully inspect the check marks/circled scores and handwritten entries.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: image },
          ],
        }],
      }),
    });

    const raw = await response.text();
    if (!response.ok) return NextResponse.json({ error: `OpenAI request failed: ${raw.slice(0, 500)}` }, { status: response.status });

    const json = JSON.parse(raw);
    const text = extractText(json);
    const clean = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json({ data: parsed });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Document extraction failed." }, { status: 500 });
  }
}

function extractText(result: any): string {
  if (typeof result?.output_text === "string" && result.output_text) return result.output_text;
  const texts: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === "object") {
      if (typeof node.text === "string") texts.push(node.text);
      for (const key of Object.keys(node)) walk(node[key]);
    }
  };
  walk(result?.output);
  if (!texts.length) throw new Error("The AI returned no readable extraction.");
  return texts.join("\n");
}

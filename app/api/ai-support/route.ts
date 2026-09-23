import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json(
        { error: "Please enter a question for the AI assistant." },
        { status: 400 },
      );
    }

    // Supplier Evaluation Support AI now uses Gemini instead of OpenAI.
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured. Add it to .env.local or Vercel Environment Variables." },
        { status: 500 },
      );
    }

    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const context = body?.context ?? {};

    const system = `You are the Supplier Evaluation Pro AI Support assistant for a Purchasing Office.

Your job is to help staff review supplier evaluation data, explain ratings, summarize suppliers, draft professional remarks, suggest useful dashboard insights, and explain how to use the system.

Use only the supplied workspace context when answering data questions. Do not invent supplier facts. If the user asks for a procurement decision, frame it as a recommendation based on the provided ratings and state that the final decision belongs to authorized purchasing personnel.

Keep answers practical, concise, and professional. When useful, use short headings and bullets.

Workspace context:
${JSON.stringify(context).slice(0, 50000)}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: system }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
          },
        }),
      },
    );

    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { error: `Gemini request failed: ${raw.slice(0, 700)}` },
        { status: response.status },
      );
    }

    const json = JSON.parse(raw);
    const answer = extractText(json).trim();

    return NextResponse.json({
      answer: answer || "The AI returned an empty response.",
      model,
      provider: "gemini",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "AI support failed." },
      { status: 500 },
    );
  }
}

function extractText(result: any): string {
  const parts = result?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part: any) => String(part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

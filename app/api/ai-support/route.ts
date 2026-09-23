import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_MODEL = "gemini-3.8-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY is not configured. Add it to .env.local or Vercel Environment Variables.",
        },
        { status: 500 },
      );
    }

    const configuredModel = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const context = body?.context ?? {};

    const system = `You are the Supplier Evaluation Pro AI Support assistant for a Purchasing Office.

Your job is to help staff review supplier evaluation data, explain ratings, summarize suppliers, draft professional remarks, suggest useful dashboard insights, and explain how to use the system.

Use only the supplied workspace context when answering data questions. Do not invent supplier facts. If the user asks for a procurement decision, frame it as a recommendation based on the provided ratings and state that the final decision belongs to authorized purchasing personnel.

Keep answers practical, concise, and professional. When useful, use short headings and bullets.

Workspace context:
${JSON.stringify(context).slice(0, 50000)}`;

    // Gemini can temporarily return HTTP 503 when a model is under heavy demand.
    // Retry briefly, then automatically fall back to a lighter Flash model.
    const modelsToTry = [configuredModel];
    if (configuredModel !== FALLBACK_MODEL) modelsToTry.push(FALLBACK_MODEL);

    let lastError = "Gemini request failed.";

    for (const model of modelsToTry) {
      const result = await generateWithRetry({
        apiKey,
        model,
        system,
        prompt,
      });

      if (result.ok) {
        const answer = extractText(result.json).trim();
        return NextResponse.json({
          answer: answer || "The AI returned an empty response.",
          model,
          provider: "gemini",
        });
      }

      lastError = result.error;

      // Only fall back for temporary service/capacity failures.
      if (result.status !== 429 && result.status !== 500 && result.status !== 502 && result.status !== 503 && result.status !== 504) {
        break;
      }
    }

    return NextResponse.json({ error: lastError }, { status: 503 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "AI support failed." },
      { status: 500 },
    );
  }
}

async function generateWithRetry({
  apiKey,
  model,
  system,
  prompt,
}: {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
}) {
  const maxAttempts = 2;
  let lastStatus = 500;
  let lastError = "Gemini request failed.";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
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

      if (response.ok) {
        return { ok: true as const, json: JSON.parse(raw), status: response.status, error: "" };
      }

      lastStatus = response.status;
      lastError = `Gemini request failed: ${raw.slice(0, 700)}`;

      // Retry only transient failures. A 400/401/403/404 should not be retried.
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error: any) {
      lastError = error?.message || "Unable to reach Gemini.";
      lastStatus = 503;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
    }
  }

  return { ok: false as const, json: null, status: lastStatus, error: lastError };
}

function extractText(result: any): string {
  const parts = result?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part: any) => String(part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

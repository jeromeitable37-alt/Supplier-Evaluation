import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = String(body?.prompt || "").trim();
    if (!prompt) return NextResponse.json({ error: "Please enter a question for the AI assistant." }, { status: 400 });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured. Add it to .env.local or Vercel Environment Variables." }, { status: 500 });

    const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
    const context = body?.context ?? {};
    const system = `You are the Supplier Evaluation Pro AI Support assistant for a Purchasing Office.\n\nYour job is to help staff review supplier evaluation data, explain ratings, summarize suppliers, draft professional remarks, suggest useful dashboard insights, and explain how to use the system. Use only the supplied workspace context when answering data questions. Do not invent supplier facts. If the user asks for a procurement decision, frame it as a recommendation based on the provided ratings and state that the final decision belongs to authorized purchasing personnel. Keep answers practical, concise, and professional. When useful, use short headings and bullets.\n\nWorkspace context:\n${JSON.stringify(context).slice(0, 50000)}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          { role: "user", content: [{ type: "input_text", text: prompt }] },
        ],
      }),
    });

    const raw = await response.text();
    if (!response.ok) return NextResponse.json({ error: `OpenAI request failed: ${raw.slice(0, 500)}` }, { status: response.status });

    const json = JSON.parse(raw);
    const answer = extractText(json).trim();
    return NextResponse.json({ answer: answer || "The AI returned an empty response." });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "AI support failed." }, { status: 500 });
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
      Object.keys(node).forEach((key) => walk(node[key]));
    }
  };
  walk(result?.output);
  return texts.join("\n");
}

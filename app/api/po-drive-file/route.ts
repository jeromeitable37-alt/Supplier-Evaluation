import { PoDriveAuthError, requirePoDriveAdmin, schoolPoWebhook } from "../../../lib/server/schoolPoAuth";

export const runtime = "nodejs";
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/**
 * Authorized preview proxy. No public Drive permissions or permanent signed URL.
 * Client must fetch with its Firebase ID token, then use a temporary blob URL.
 */
export async function GET(request: Request) {
  try {
    if (process.env.PO_DRIVE_UPLOAD_ENABLED !== "true") {
      return Response.json({ ok: false, message: "PO Drive pilot is disabled." }, { status: 503 });
    }
    await requirePoDriveAdmin(request);
    const fileId = new URL(request.url).searchParams.get("fileId") || "";
    if (!/^[A-Za-z0-9_-]{15,150}$/.test(fileId)) {
      return Response.json({ ok: false, message: "Invalid official PO file ID." }, { status: 400 });
    }
    const file = await schoolPoWebhook("get_po_file", { fileId });
    const mime = String(file.mimeType || "");
    if (!ALLOWED_MIME.has(mime) || typeof file.base64 !== "string" ||
        file.base64.length > 12 * 1024 * 1024) {
      throw new Error("Unsupported or oversized PO preview.");
    }
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.length > 8 * 1024 * 1024 || bytes.length === 0) {
      throw new Error("Invalid PO file content.");
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    const status = error instanceof PoDriveAuthError ? error.status : 502;
    console.error("School PO Drive preview failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, message: status === 403 || status === 401
      ? "Sign in as an authorized Purchasing administrator." : "Could not securely retrieve the PO." }, { status });
  }
}

import { NextResponse } from "next/server";
import { PoDriveAuthError, requirePoDriveAdmin, schoolPoWebhook } from "../../../lib/server/schoolPoAuth";

export const runtime = "nodejs";
const MAX_PO_SIZE = 8 * 1024 * 1024;
const SUPPORTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/**
 * Public, read-only feature-status endpoint.
 * Returns ONLY the safety switch; no secrets, credentials, staff identities,
 * folder IDs or configuration values are ever exposed.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    uploadEnabled: process.env.PO_DRIVE_UPLOAD_ENABLED === "true",
  }, { headers: { "Cache-Control": "no-store" } });
}

/** Pilot: authorized admin uploads one official PO page/file at a time. */
export async function POST(request: Request) {
  try {
    if (process.env.PO_DRIVE_UPLOAD_ENABLED !== "true") {
      return NextResponse.json({ ok: false, message: "School Drive upload pilot is not enabled yet." }, { status: 503 });
    }
    const staff = await requirePoDriveAdmin(request);
    const type = request.headers.get("content-type") || "";
    if (!type.toLowerCase().startsWith("multipart/form-data")) {
      return NextResponse.json({ ok: false, message: "Multipart PO file upload required." }, { status: 415 });
    }
    const data = await request.formData();
    const file = data.get("file");
    const poNumber = String(data.get("poNumber") || "").trim();
    const prfNumber = String(data.get("prfNumber") || "").trim();
    if (!(file instanceof File) || !SUPPORTED.has(file.type) ||
        file.size < 1 || file.size > MAX_PO_SIZE ||
        !poNumber || poNumber.length > 100 || prfNumber.length > 100) {
      return NextResponse.json({ ok: false, message: "Upload a valid PO PDF/image up to 8 MiB with a PO number." }, { status: 400 });
    }
    const fileBytes = Buffer.from(await file.arrayBuffer());
    const saved = await schoolPoWebhook("upload_po", {
      upload: {
        poNumber, prfNumber, name: file.name,
        mimeType: file.type, base64: fileBytes.toString("base64"),
        uploadedBy: staff.email,
      },
    });
    if (!/^[A-Za-z0-9_-]{15,150}$/.test(String(saved.fileId || ""))) {
      throw new Error("School Drive did not return a valid file ID.");
    }
    return NextResponse.json({
      ok: true, fileId: saved.fileId, provider: "google-drive",
      name: saved.name, mimeType: saved.mimeType, size: saved.size,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof PoDriveAuthError ? error.status : 502;
    const message = error instanceof PoDriveAuthError ? error.message : "Could not securely save the PO in school Drive.";
    console.error("School PO Drive upload failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, message }, { status });
  }
}

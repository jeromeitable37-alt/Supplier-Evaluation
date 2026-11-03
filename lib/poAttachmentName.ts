/**
 * Use descriptive attachment names without changing the stored Purchase Order.
 * The MIME type is preferred because scanned uploads sometimes have no extension.
 */
export function officialPoAttachmentName(input: {
  poNumber: unknown;
  index: number;
  mimeType?: unknown;
  originalName?: unknown;
  url?: unknown;
}): string {
  const safeNumber = String(input.poNumber ?? "PO")
    .replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0,60) || "PO";
  const mime = String(input.mimeType ?? "").split(";")[0].trim().toLowerCase();
  const mimeExtensions: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  const candidate = String(input.originalName ?? "") || String(input.url ?? "");
  const match = candidate.match(/\.(pdf|jpe?g|png|webp|gif|heic|heif)(?:\?.*)?$/i);
  const detected = match?.[1]?.toLowerCase().replace("jpeg", "jpg");
  const ext = mimeExtensions[mime] || detected || "";
  const page = input.index > 0 ? "-page-" + (input.index + 1) : "";
  return "Official-PO-" + safeNumber + page + (ext ? "." + ext : "");
}

export type CloudinaryPoDocument = {
  url: string;
  publicId: string;
  resourceType: string;
  format: string;
  originalFilename: string;
  bytes: number;
  pages?: number;
  width?: number;
  height?: number;
};

const cloudName = () => process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || "";
const uploadPreset = () => process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim() || "";

export function cloudinaryConfigured() {
  return Boolean(cloudName() && uploadPreset());
}

export function getCloudinarySetupMessage() {
  return "Cloudinary is not configured. Add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET to your local/Vercel environment.";
}

export function uploadPoDocumentToCloudinary(
  file: File,
  folder: string,
  onProgress?: (percent: number) => void,
): Promise<CloudinaryPoDocument> {
  return new Promise((resolve, reject) => {
    const name = cloudName();
    const preset = uploadPreset();
    if (!name || !preset) {
      reject(new Error(getCloudinarySetupMessage()));
      return;
    }
    if (!file) {
      reject(new Error("Please choose a PO document."));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      reject(new Error(`${file.name} is larger than 25 MB. Please compress the document first.`));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(name)}/auto/upload`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Cloudinary upload failed. Check your internet connection."));
    xhr.ontimeout = () => reject(new Error("Cloudinary upload timed out. Please retry the document."));
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data?.error?.message || `Cloudinary upload failed (${xhr.status}).`));
        return;
      }
      if (!data?.secure_url || !data?.public_id) {
        reject(new Error("Cloudinary did not return a usable document URL."));
        return;
      }
      resolve({
        url: data.secure_url,
        publicId: data.public_id,
        resourceType: data.resource_type || "auto",
        format: data.format || "",
        originalFilename: data.original_filename || file.name,
        bytes: Number(data.bytes || file.size),
        pages: Number.isFinite(Number(data.pages)) && Number(data.pages) > 0 ? Number(data.pages) : undefined,
        width: Number.isFinite(Number(data.width)) ? Number(data.width) : undefined,
        height: Number.isFinite(Number(data.height)) ? Number(data.height) : undefined,
      });
    };

    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", preset);
    form.append("asset_folder", folder);
    xhr.send(form);
  });
}

export const ARTWORK_MAX_BYTES = 4 * 1024 * 1024;
export const ARTWORK_TYPES = Object.freeze(["image/png", "image/jpeg", "image/svg+xml"]);

export async function validateArtworkFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") return { ok: false, error: "Choose a PNG, JPG/JPEG, or SVG logo file." };
  if (!ARTWORK_TYPES.includes(file.type)) return { ok: false, error: "Logo files must be PNG, JPG/JPEG, or SVG." };
  if (!file.size || file.size > ARTWORK_MAX_BYTES) return { ok: false, error: "Logo files must be 4 MB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes.length > 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const text = file.type === "image/svg+xml" ? new TextDecoder().decode(bytes) : "";
  const svg = /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)
    && !/<script|<foreignObject|\son\w+\s*=|javascript:|data:/i.test(text);
  if ((file.type === "image/png" && !png) || (file.type === "image/jpeg" && !jpeg) || (file.type === "image/svg+xml" && !svg)) {
    return { ok: false, error: "The file contents do not match a safe supported image format." };
  }
  return { ok: true };
}

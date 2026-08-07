export const MAX_ARTWORK_BYTES = 4 * 1024 * 1024;
export const ARTWORK_MIME_EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg"
});

export function validateArtworkBytes(bytes, declaredType) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_ARTWORK_BYTES) {
    return { ok: false, error: "Logo files must be 4 MB or smaller." };
  }
  const extension = ARTWORK_MIME_EXTENSIONS[declaredType];
  if (!extension) return { ok: false, error: "Logo files must be PNG, JPG/JPEG, or SVG." };
  const png = bytes.length > 8 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const text = declaredType === "image/svg+xml" ? new TextDecoder().decode(bytes) : "";
  const svg = /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)
    && !/<script|<foreignObject|\son\w+\s*=|javascript:|data:|<!ENTITY|<!DOCTYPE/i.test(text);
  const signatureMatches = declaredType === "image/png" ? png : declaredType === "image/jpeg" ? jpeg : svg;
  if (!signatureMatches) return { ok: false, error: "The file contents do not match a safe supported image format." };
  return { ok: true, extension, contentType: declaredType };
}

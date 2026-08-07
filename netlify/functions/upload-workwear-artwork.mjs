import { getServiceClient } from "../lib/supabase-admin.mjs";
import { json, publicError, methodNotAllowed, logServerError } from "../lib/http.mjs";
import { validateArtworkBytes } from "../lib/workwear-artwork.mjs";

export default async function handler(req) {
  if (req.method !== "POST") return methodNotAllowed();
  const service = getServiceClient();
  if (!service) return publicError(503, "Artwork upload is temporarily unavailable.");
  try {
    const form = await req.formData();
    const file = form.get("artwork");
    if (!file || typeof file.arrayBuffer !== "function") return publicError(400, "Choose a logo file to upload.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateArtworkBytes(bytes, file.type);
    if (!validation.ok) return publicError(400, validation.error);
    const artworkReference = `${crypto.randomUUID()}.${validation.extension}`;
    const { error } = await service.storage.from("workwear-artwork").upload(artworkReference, bytes, {
      contentType: validation.contentType,
      cacheControl: "0",
      upsert: false,
      metadata: { original_name: String(file.name || "artwork").slice(0, 120) }
    });
    if (error) throw new Error(`private artwork upload failed: ${error.message}`);
    return json(201, { ok: true, artwork_reference: artworkReference });
  } catch (error) {
    logServerError("workwear-artwork", error, {});
    return publicError(500, "Artwork upload is temporarily unavailable.");
  }
}

export const config = {
  path: "/api/workwear-artwork",
  rateLimit: {
    windowLimit: 5,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};

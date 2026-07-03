const BARCODE_FORMATS = [
  "code_128",
  "code_39",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "qr_code",
  "itf",
  "codabar",
  "data_matrix"
];

export function hasNativeBarcodeDetector() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

// Tries the native BarcodeDetector first, then the bundled zxing reader.
// Always resolves with a string barcode value or null - never throws, so a
// failed detection can never block the intake workflow.
export async function detectBarcodeFromImage(file) {
  if (!file) return null;

  if (hasNativeBarcodeDetector()) {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
      const detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
      const codes = await detector.detect(bitmap);
      if (codes.length > 0 && codes[0].rawValue) return codes[0].rawValue;
    } catch {
      // fall through to zxing
    } finally {
      bitmap?.close?.();
    }
  }

  let objectUrl = "";
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    objectUrl = URL.createObjectURL(file);
    const result = await reader.decodeFromImageUrl(objectUrl);
    return result?.getText() || null;
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

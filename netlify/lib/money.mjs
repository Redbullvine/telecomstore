// Integer-cent money helpers. All Stripe amounts are integer cents; all DB
// amounts are numeric(12,2) serialized as decimal strings. Never do float
// arithmetic on payment amounts.

const DECIMAL_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

// Parses a non-negative decimal amount (string or number) into integer cents.
// Returns null for anything that is not a clean, in-range money value.
export function toCents(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? value.toFixed(2) : String(value).trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const [dollars, fraction = ""] = text.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

export function centsToDecimal(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// Validates that final = subtotal + shipping + tax, all as clean cent values.
// Returns the cent breakdown or null when the arithmetic does not hold.
export function validatedTotals({ productSubtotal, shippingAmount, taxAmount, finalTotal }) {
  const subtotal = toCents(productSubtotal);
  const shipping = toCents(shippingAmount);
  const tax = toCents(taxAmount);
  const total = toCents(finalTotal);
  if (subtotal === null || shipping === null || tax === null || total === null) return null;
  if (subtotal + shipping + tax !== total) return null;
  if (total === 0) return null;
  return { subtotal, shipping, tax, total };
}

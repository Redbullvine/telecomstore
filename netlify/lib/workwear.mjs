export const WORKWEAR_PLACEMENTS = ["Left Chest", "Full Front", "Back", "Front + Back"];
export const WORKWEAR_METHODS = ["Screen Print", "Embroidery", "Heat Transfer", "Review My Artwork"];

const ARTWORK_REF_PATTERN = /^[0-9a-f-]{36}\.(png|jpg|svg)$/i;

export function cleanWorkwearConfiguration(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const text = (value, max = 120) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
  const result = {
    color: text(raw.color),
    size: text(raw.size, 12) || null,
    style: text(raw.style),
    logo_placement: text(raw.logo_placement),
    customization_method: text(raw.customization_method),
    company_name: text(raw.company_name) || null,
    artwork_reference: text(raw.artwork_reference) || null,
    artwork_filename: text(raw.artwork_filename) || null,
    customer_notes: text(raw.customer_notes, 1000) || null
  };
  if (result.artwork_reference && !ARTWORK_REF_PATTERN.test(result.artwork_reference)) return null;
  return result;
}

export function validateWorkwearSelection(row, configuration) {
  if (row?.department !== "custom_workwear" || !configuration) return false;
  if (!row.colors.includes(configuration.color)) return false;
  if (row.sizes.length && !row.sizes.includes(configuration.size)) return false;
  if (!row.sizes.length && configuration.size) return false;
  if (!row.styles.includes(configuration.style)) return false;
  if (row.customizable === false) {
    if (configuration.logo_placement !== "Front Design" || configuration.customization_method !== "Printed Design") return false;
  } else {
    const placements = row.logo_placements || WORKWEAR_PLACEMENTS;
    const methods = row.customization_methods || WORKWEAR_METHODS;
    if (!placements.includes(configuration.logo_placement)) return false;
    if (!methods.includes(configuration.customization_method)) return false;
  }
  return true;
}

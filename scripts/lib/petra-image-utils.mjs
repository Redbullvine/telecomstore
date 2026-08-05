export function normalizePetraImageUrl(value) {
  if (!value) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "";
  }
  if (!/^https?:$/.test(parsed.protocol)) return "";
  if (parsed.hostname.toLowerCase() === "petraimages.com.s3.amazonaws.com") {
    return `https://s3.us-east-2.amazonaws.com/petraimages.com${parsed.pathname}`;
  }
  if (parsed.protocol !== "https:") return "";
  parsed.hash = "";
  return parsed.toString();
}

export function findDuplicateImageUrls(records) {
  return [...records.reduce((map, row) => {
    const rows = map.get(row.photo_main) || [];
    rows.push(row.public_sku);
    map.set(row.photo_main, rows);
    return map;
  }, new Map())]
    .filter(([, skus]) => skus.length > 1)
    .map(([url, skus]) => ({ url, skus }));
}

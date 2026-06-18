import fs from "node:fs";

const csvPath = process.argv[2] || "docs/inventory-intake-template.csv";
const outPath = process.argv[3] || "src/data/products.json";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

const csv = fs.readFileSync(csvPath, "utf8");
const [headers, ...lines] = parseCsv(csv);
const products = lines.map((line, index) => {
  const item = Object.fromEntries(headers.map((header, i) => [header, line[i] || ""]));
  const safeSku = item.sku.replaceAll("/", "-").replaceAll(" ", "-");

  return {
    id: `ts-${String(index + 1).padStart(4, "0")}`,
    sku: item.sku,
    brand: item.brand,
    title: item.title,
    category: item.category,
    condition: item.condition,
    quantityAvailable: item.quantity_available ? `${item.quantity_available} ${item.unit}`.trim() : "Verify quantity",
    unit: item.unit,
    pairCapacity: item.pair_capacity || "Verify from product label",
    warehouseLocation: item.warehouse_location,
    shortDescription: item.notes || `${item.brand} ${item.title}`,
    details: [item.notes].filter(Boolean),
    images: [
      item.photo_main ? `/images/products/${item.photo_main}` : `/images/products/${safeSku}-main.jpg`,
      item.photo_label ? `/images/products/${item.photo_label}` : `/images/products/${safeSku}-label.jpg`
    ],
    status: item.status || "quote"
  };
});

fs.writeFileSync(outPath, `${JSON.stringify(products, null, 2)}\n`);
console.log(`Wrote ${products.length} products to ${outPath}`);

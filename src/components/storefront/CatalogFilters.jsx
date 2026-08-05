import React from "react";

export default function CatalogFilters({ query, category, manufacturer, availability, sort, categories, manufacturers, onQuery, onCategory, onManufacturer, onAvailability, onSort, onReset }) {
  const active = Boolean(query || category !== "All" || manufacturer !== "All" || availability !== "All" || sort !== "brand");
  return (
    <div className="ts-filter-panel" aria-label="Catalog filters">
      <label className="ts-filter-search"><span>Search catalog</span><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Title, MPN, GTIN, brand, or keyword" /></label>
      <label><span>Category</span><select value={category} onChange={(event) => onCategory(event.target.value)}><option value="All">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Manufacturer</span><select value={manufacturer} onChange={(event) => onManufacturer(event.target.value)}><option value="All">All manufacturers</option>{manufacturers.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Availability</span><select value={availability} onChange={(event) => onAvailability(event.target.value)}><option value="All">All quote options</option><option value="fixed">Approved public price</option><option value="request_quote">Request quote</option></select></label>
      <label><span>Sort</span><select value={sort} onChange={(event) => onSort(event.target.value)}><option value="brand">Brand A–Z</option><option value="name">Name A–Z</option><option value="category">Category A–Z</option><option value="availability">Approved prices first</option></select></label>
      <button type="button" className="ts-filter-reset" onClick={onReset} disabled={!active}>Reset filters</button>
    </div>
  );
}

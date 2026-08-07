export const MARKETPLACE_SITE_URL = "https://telecomstore.net";

export const MARKETPLACE_DEPARTMENTS = Object.freeze([
  { slug: "electronics", name: "Electronics" },
  { slug: "home-kitchen", name: "Home & Kitchen" },
  { slug: "tools", name: "Tools & Home Improvement" },
  { slug: "automotive-marine", name: "Automotive & Marine" },
  { slug: "outdoor-fitness", name: "Outdoor & Fitness" },
  { slug: "health-beauty", name: "Health & Beauty" },
  { slug: "appliance-parts", name: "Appliance Parts" },
  { slug: "deals", name: "Deals" },
]);

export function marketplaceDepartment(slug) {
  return MARKETPLACE_DEPARTMENTS.find((department) => department.slug === slug) || null;
}

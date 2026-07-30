export const CONTACT_CONFIG = {
  companyName: "Telecom Store",
  operatorName: "Fatanett, LLC",
  email: "sales@telecomstore.net",
  phone: ""
};

export function contactEmailHref(subject = "") {
  const suffix = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `mailto:${CONTACT_CONFIG.email}${suffix}`;
}

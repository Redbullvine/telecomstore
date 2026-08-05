export function validateQuoteRequest(formData, selectedItems = []) {
  const name = field(formData, "name");
  const email = field(formData, "email");
  const phone = field(formData, "phone");
  const message = field(formData, "message");
  const quantity = field(formData, "quantity");

  if (!name) return "Please add your name so we know who to reply to.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Please add a valid email address.";
  if (phone.replace(/\D/g, "").length < 7) return "Please add a valid phone number.";
  if (!message) return "Please add a message describing what you need.";

  const quantities = selectedItems.length ? selectedItems.map((item) => item.qty) : [quantity];
  if (quantities.some((value) => !Number.isInteger(Number(value)) || Number(value) < 1)) {
    return "Please use a whole-number quantity of at least 1.";
  }
  return "";
}

export function validateGeneralLead(formData) {
  const name = field(formData, "name");
  const email = field(formData, "email");
  const phone = field(formData, "phone");
  if (!name) return "Please add your name so we know who to reply to.";
  if (!email && !phone) return "Please add an email or phone number so we can follow up.";
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return "Please add a valid email address.";
  return "";
}

function field(formData, name) {
  return String(formData.get(name) || "").trim();
}

import crypto from "crypto";
import { validateWooacryAddress } from "./wooacry-utils.js";

// -------------------------------
// CONFIG
// -------------------------------
const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";

// Wooacry SKU → Shopify variant mapping
const SKU_TO_VARIANT = {
  "70": "42832621797489"  // Poster SKU → Shopify Variant ID
};

// -------------------------------
// SIGNATURE BUILDER
// -------------------------------
function buildSign(bodyString, timestamp) {
  const version = "1";

  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${version}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

// -------------------------------
// MAIN HANDLER
// -------------------------------
export default async function handler(req, res) {
  try {
    const order = req.body;
    console.log("[SHOPIFY ORDER] Received:", order.id);

    const third_party_order_sn = String(order.id);
    const third_party_order_created_at = Math.floor(new Date(order.created_at).getTime() / 1000);
    const third_party_user = order.email || "guest";

    const addr = order.shipping_address;
    if (!addr) {
      console.log("[SHOPIFY ORDER] No shipping address → ignore.");
      return res.status(200).json({ ok: true });
    }

    // -----------------------------------------
    // Extract Wooacry customized items
    // -----------------------------------------
    const skus = order.line_items
      .filter(i => i.properties && i.properties.customize_no)
      .map(i => ({
        customize_no: String(i.properties.customize_no),
        count: parseInt(i.quantity, 10) || 1
      }));

    if (skus.length === 0) {
      console.log("[SHOPIFY ORDER] No Wooacry items → nothing to send.");
      return res.status(200).json({ ok: true });
    }

    console.log("[WOEACRY] Found custom items:", skus);

    // -----------------------------------------
    // Normalize address for Wooacry
    // -----------------------------------------
    let normalizedAddress = validateWooacryAddress({
      first_name: addr.first_name || "",
      last_name: addr.last_name || "",
      phone: addr.phone || "",
      country_code: (addr.country_code || "").toUpperCase(),
      province: addr.province || "",
      city: addr.city || "",
      address1: addr.address1 || "",
      address2: addr.address2 || "",
      post_code: addr.zip || "",
      tax_number: addr.tax_number || ""
    });

    // Force all fields to strings
    Object.keys(normalizedAddress).forEach(k => {
      if (typeof normalizedAddress[k] !== "string") {
        normalizedAddress[k] = String(normalizedAddress[k] || "");
      }
    });

    // Tax ID enforcement
    const requiresTaxID = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];
    if (requiresTaxID.includes(normalizedAddress.country_code) && !normalizedAddress.tax_number) {
      return res.status(400).json({
        error: "Missing required tax_number for destination country",
        country: normalizedAddress.country_code
      });
    }

    // Internal domain
    const host = req.headers.host;
    const protocol = r

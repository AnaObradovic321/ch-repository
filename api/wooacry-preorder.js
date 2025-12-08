import { buildHeaders } from "./wooacry-utils.js";

// Countries where tax_number must be strictly validated
const TAX_REQUIRED_COUNTRIES = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];

/**
 * Validate address fields according to Wooacry documentation
 */
function validateAddress(address) {
  const requiredFields = [
    "first_name",
    "last_name",
    "phone",
    "country_code",
    "province",
    "city",
    "address1",
    "address2",
    "post_code",
    "tax_number"
  ];

  for (const field of requiredFields) {
    if (!address[field] || String(address[field]).trim() === "") {
      throw new Error(`Address field missing or empty: ${field}`);
    }
  }

  // Validate tax rules for mandatory countries
  const cc = address.country_code.toUpperCase();
  if (TAX_REQUIRED_COUNTRIES.includes(cc)) {
    if (!address.tax_number || address.tax_number.trim() === "") {
      throw new Error(`tax_number is required for orders shipped to ${cc}`);
    }
  }
}

/**
 * Validate Wooacry SKU structure
 */
function validateSKUs(skus) {
  if (!Array.isArray(skus) || skus.length === 0) {
    throw new Error("Invalid or missing skus");
  }

  for (const sku of skus) {
    if (!sku.customize_no || typeof sku.customize_no !== "string") {
      throw new Error("SKU missing customize_no");
    }

    if (typeof sku.count !== "number" || sku.count <= 0) {
      throw new Error(`SKU missing valid count for customize_no ${sku.customize_no}`);
    }
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { third_party_user, skus, address } = req.body;

    // Required field validations
    if (!third_party_user || typeof third_party_user !== "string") {
      return res.status(400).json({ error: "Missing or invalid third_party_user" });
    }

    try {
      validateSKUs(skus);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!address || typeof address !== "object") {
      return res.status(400).json({ error: "Missing address" });
    }

    try {
      validateAddress(address);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    /**
     * Build Wooacry-compliant preorder body
     */
    const body = {
      third_party_user,
      skus,
      address: {
        first_name: address.first_name,
        last_name: address.last_name,
        phone: address.phone,
        country_code: address.country_code.toUpperCase(),
        province: address.province,
        city: address.city,
        address1: address.address1,
        address2: address.address2,
        post_code: address.post_code,
        tax_number: address.tax_number
      }
    };

    const raw = JSON.stringify(body);

    const response = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create/pre",
      {
        method: "POST",
        headers: buildHeaders(raw), // Signature must match raw exactly
        body: raw
      }
    );

    const result = await response.json();
    console.log("Wooacry Preorder Response:", result);

    return res.status(200).json(result);

  } catch (err) {
    console.error("Preorder Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// api/wooacry-preorder.js
import { buildHeaders } from "./wooacry-utils.js";

// Countries where tax_number must be present (Wooacry list)
const TAX_REQUIRED_COUNTRIES = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];

/**
 * Validate Wooacry address according to documentation.
 * Note: docs list address2 + tax_number as required fields to be present,
 * but tax_number is mandatory (non-empty) only for specific countries.
 */
function validateAddress(address) {
  if (!address || typeof address !== "object") {
    throw new Error("Missing or invalid address");
  }

  // Required fields per Wooacry pre-order docs
  const requiredFields = [
    "first_name",
    "last_name",
    "phone",
    "country_code",
    "province",
    "city",
    "address1",
    "address2",   // required by docs (can be empty string)
    "post_code",
    "tax_number"  // required by docs (can be empty except countries below)
  ];

  for (const field of requiredFields) {
    // We only require the key to exist for address2/tax_number; others must be non-empty.
    if (!(field in address)) {
      throw new Error(`Address field missing: ${field}`);
    }

    const val = address[field];

    if (field !== "address2" && field !== "tax_number") {
      if (!val || String(val).trim() === "") {
        throw new Error(`Address field missing or empty: ${field}`);
      }
    }
  }

  const cc = String(address.country_code).toUpperCase();

  // tax_number must be non-empty for these countries
  if (TAX_REQUIRED_COUNTRIES.includes(cc)) {
    if (!address.tax_number || String(address.tax_number).trim() === "") {
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { third_party_user, skus, address } = req.body || {};

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

    // Normalize required doc fields so the validator can enforce presence
    const normalizedAddress = {
      first_name: address.first_name ?? "",
      last_name: address.last_name ?? "",
      phone: address.phone ?? "",
      country_code: (address.country_code ?? "").toString().toUpperCase(),
      province: address.province ?? "",
      city: address.city ?? "",
      address1: address.address1 ?? "",
      address2: address.address2 ?? "",     // required by docs, allow empty string
      post_code: address.post_code ?? "",
      tax_number: address.tax_number ?? ""  // required by docs, allow empty unless listed countries
    };

    try {
      validateAddress(normalizedAddress);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // Pre-order body per docs :contentReference[oaicite:13]{index=13}
    const body = {
      third_party_user,
      skus,
      address: normalizedAddress
    };

    const raw = JSON.stringify(body);

    const response = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create/pre",
      {
        method: "POST",
        headers: buildHeaders(raw), // must implement Sign/Reseller-Flag/Timestamp/Version/Content-Type per docs
        body: raw
      }
    );

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for order/create/pre",
        wooacry_http_status: response.status,
        body_preview: text.slice(0, 800)
      });
    }

    // Preserve Wooacry status shape; you can decide later if you want to map HTTP codes
    return res.status(200).json(result);
  } catch (err) {
    console.error("Preorder Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

import { buildHeaders } from "./wooacry-utils.js";

const WOOACRY_BASE = process.env.WOOACRY_BASE || "https://api-new.wooacry.com";
const ENDPOINT = `${WOOACRY_BASE}/api/reseller/open/order/address/change`;

// Tax number is mandatory for these countries per Wooacry order docs. :contentReference[oaicite:7]{index=7}
const TAX_REQUIRED_COUNTRIES = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];

function mustBeNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or empty field: ${fieldName}`);
  }
  return value.trim();
}

function normalizeAddress(address) {
  if (!address || typeof address !== "object") {
    throw new Error("Missing address object");
  }

  // Docs (address change): these are required fields. :contentReference[oaicite:8]{index=8}
  const first_name = mustBeNonEmptyString(String(address.first_name ?? ""), "address.first_name");
  const last_name = mustBeNonEmptyString(String(address.last_name ?? ""), "address.last_name");
  const phone = mustBeNonEmptyString(String(address.phone ?? ""), "address.phone");
  const country_code = mustBeNonEmptyString(String(address.country_code ?? ""), "address.country_code").toUpperCase();
  const province = mustBeNonEmptyString(String(address.province ?? ""), "address.province");
  const city = mustBeNonEmptyString(String(address.city ?? ""), "address.city");
  const address1 = mustBeNonEmptyString(String(address.address1 ?? ""), "address.address1");
  const post_code = mustBeNonEmptyString(String(address.post_code ?? ""), "address.post_code");

  // Docs mark address2 as required. We always send it.
  // We will not force it non-empty because many real addresses do not have apt/unit.
  const address2 = String(address.address2 ?? "");

  // Docs mark tax_number as required. We always send it.
  const tax_number = String(address.tax_number ?? "");

  // Enforce tax_number only for these countries
  if (TAX_REQUIRED_COUNTRIES.includes(country_code) && tax_number.trim() === "") {
    throw new Error(`tax_number is required for orders shipped to ${country_code}`);
  }

  return {
    first_name,
    last_name,
    phone,
    country_code,
    province,
    city,
    address1,
    address2,
    post_code,
    tax_number
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  try {
    const third_party_order_sn =
      req.body?.third_party_order_sn ||
      req.body?.order_id ||
      req.body?.shopify_order_id;

    if (!third_party_order_sn || String(third_party_order_sn).trim() === "") {
      return res.status(400).json({
        error: "Missing third_party_order_sn (your Shopify order id)."
      });
    }

    const address = normalizeAddress(req.body?.address);

    const bodyObj = {
      third_party_order_sn: String(third_party_order_sn).trim(),
      address
    };

    const raw = JSON.stringify(bodyObj);

    const wooResp = await fetch(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    });

    const text = await wooResp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Wooacry returned non-JSON",
        wooacry_http_status: wooResp.status,
        body_preview: text.slice(0, 500)
      });
    }

    return res.status(200).json({
      ok: json?.code === 0,
      wooacry_http_status: wooResp.status,
      request: bodyObj,
      response: json
    });
  } catch (err) {
    console.error("Wooacry Address Change ERROR:", err);
    return res.status(500).json({ error: err.message });
  }

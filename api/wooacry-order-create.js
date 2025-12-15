import { buildHeaders } from "./wooacry-utils.js";

/**
 * Wooacry base domain (prod vs pre)
 */
const WOOACRY_BASE = process.env.WOOACRY_API_BASE || "https://api-new.wooacry.com";

/**
 * Countries where tax_number must be present (Wooacry docs)
 */
const TAX_REQUIRED_COUNTRIES = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];

/**
 * Required address keys per Wooacry docs:
 * Pre-order and Create order both mark address2 as required. :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}
 *
 * We require the keys to exist. We allow address2 + tax_number to be empty strings unless rules require otherwise.
 */
function validateAddress(address) {
  if (!address || typeof address !== "object") {
    throw new Error("Missing or invalid address");
  }

  const requiredKeys = [
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

  for (const k of requiredKeys) {
    if (!(k in address)) {
      throw new Error(`Address field missing: ${k}`);
    }
  }

  // These must be non-empty
  const mustBeNonEmpty = [
    "first_name",
    "last_name",
    "phone",
    "country_code",
    "province",
    "city",
    "address1",
    "post_code"
  ];

  for (const k of mustBeNonEmpty) {
    if (!address[k] || String(address[k]).trim() === "") {
      throw new Error(`Address field missing or empty: ${k}`);
    }
  }

  // tax_number must be non-empty for certain countries
  const cc = String(address.country_code).toUpperCase().trim();
  if (TAX_REQUIRED_COUNTRIES.includes(cc)) {
    if (!address.tax_number || String(address.tax_number).trim() === "") {
      throw new Error(`Missing required tax_number for ${cc}`);
    }
  }
}

/**
 * Validate SKUs
 * Docs show customize_no + count in examples. :contentReference[oaicite:4]{index=4}
 */
function validateSkus(skus) {
  if (!Array.isArray(skus) || skus.length === 0) {
    throw new Error("Missing or invalid skus");
  }

  for (const sku of skus) {
    if (!sku || typeof sku !== "object") throw new Error("Invalid sku entry");

    if (!sku.customize_no || typeof sku.customize_no !== "string") {
      throw new Error("SKU missing customize_no");
    }

    const count = Number(sku.count);
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error(`Invalid count for customize_no ${sku.customize_no}`);
    }
  }
}

/**
 * Safe JSON parse helper (Wooacry sometimes returns non-JSON on errors)
 */
async function readWooacryJson(response) {
  const text = await response.text();
  try {
    return { ok: true, json: JSON.parse(text), raw: text };
  } catch {
    return { ok: false, json: null, raw: text };
  }
}

/**
 * Fetch Wooacry customize/info for validation (must succeed with code === 0)
 */
async function fetchCustomizeInfo(customize_no) {
  const raw = JSON.stringify({ customize_no: String(customize_no) });

  const response = await fetch(`${WOOACRY_BASE}/api/reseller/open/customize/info`, {
    method: "POST",
    headers: buildHeaders(raw),
    body: raw
  });

  const parsed = await readWooacryJson(response);

  if (!parsed.ok) {
    throw new Error(
      `Wooacry customize/info returned non-JSON (HTTP ${response.status}): ${parsed.raw.slice(0, 300)}`
    );
  }

  const json = parsed.json;

  // Wooacry common response: code=0 success :contentReference[oaicite:5]{index=5}
  if (!json || json.code !== 0 || !json.data) {
    throw new Error(`Wooacry customize/info failed: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json.data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus,
      address
    } = req.body || {};

    // Required top-level fields per create-order docs :contentReference[oaicite:6]{index=6}
    if (!third_party_order_sn || typeof third_party_order_sn !== "string") {
      return res.status(400).json({ error: "Missing or invalid third_party_order_sn" });
    }

    const createdAt = Number(third_party_order_created_at);
    if (!Number.isInteger(createdAt) || createdAt <= 0) {
      return res.status(400).json({ error: "Missing or invalid third_party_order_created_at (must be int seconds)" });
    }

    if (!third_party_user || typeof third_party_user !== "string") {
      return res.status(400).json({ error: "Missing or invalid third_party_user" });
    }

    if (!shipping_method_id || typeof shipping_method_id !== "string") {
      return res.status(400).json({ error: "Missing or invalid shipping_method_id" });
    }

    try {
      validateSkus(skus);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Normalize address fields, keeping required keys present
    const wooacryAddress = {
      first_name: address?.first_name ?? "",
      last_name: address?.last_name ?? "",
      phone: address?.phone ?? "",
      country_code: String(address?.country_code ?? "").toUpperCase().trim(),
      province: address?.province ?? "",
      city: address?.city ?? "",
      address1: address?.address1 ?? "",
      address2: address?.address2 ?? "", // required by docs, can be ""
      post_code: address?.post_code ?? "",
      tax_number: address?.tax_number ?? "" // required key, content required for specific countries
    };

    try {
      validateAddress(wooacryAddress);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Optional: verify customize_nos exist by calling customize/info
    // Caches within request
    const customizeCache = {};
    for (const sku of skus) {
      const no = sku.customize_no;
      if (!customizeCache[no]) {
        customizeCache[no] = await fetchCustomizeInfo(no);
      }
    }

    // Build SKUs exactly as Wooacry expects for create order
    const orderCreateSKUs = skus.map((s) => ({
      customize_no: String(s.customize_no),
      count: Number(s.count)
    }));

    const body = {
      third_party_order_sn,
      third_party_order_created_at: createdAt,
      third_party_user,
      shipping_method_id,
      skus: orderCreateSKUs,
      address: wooacryAddress
    };

    const raw = JSON.stringify(body);

    const response = await fetch(`${WOOACRY_BASE}/api/reseller/open/order/create`, {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    });

    const parsed = await readWooacryJson(response);

    if (!parsed.ok) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for order/create",
        wooacry_http_status: response.status,
        body_preview: parsed.raw.slice(0, 800)
      });
    }

    return res.status(200).json(parsed.json);
  } catch (err) {
    console.error("Wooacry Order Create ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

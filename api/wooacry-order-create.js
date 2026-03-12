import {
  WOOACRY_API_BASE,
  buildSignedJsonRequest,
  normalizeWooacryAddress,
  readWooacryJson
} from "./wooacry-utils.js";

function validateCreateFields(body) {
  const third_party_order_sn = String(body?.third_party_order_sn || "").trim();
  const third_party_user = String(body?.third_party_user || "").trim();
  const shipping_method_id = String(body?.shipping_method_id || "").trim();

  const createdAt = Number(body?.third_party_order_created_at);

  if (!third_party_order_sn) {
    throw new Error("Missing third_party_order_sn");
  }

  if (!Number.isInteger(createdAt) || createdAt <= 0) {
    throw new Error("Missing or invalid third_party_order_created_at (int seconds)");
  }

  if (!third_party_user) {
    throw new Error("Missing third_party_user");
  }

  if (!shipping_method_id) {
    throw new Error("Missing shipping_method_id");
  }

  return {
    third_party_order_sn,
    third_party_order_created_at: createdAt,
    third_party_user,
    shipping_method_id
  };
}

function validateSkus(skus) {
  if (!Array.isArray(skus) || skus.length === 0) {
    throw new Error("Missing or invalid skus");
  }

  return skus.map((s, index) => {
    const customize_no = String(s?.customize_no || "").trim();
    const rawCount = s?.count;
    const count = Number(rawCount);

    if (!customize_no) {
      throw new Error(`SKU at index ${index} is missing customize_no`);
    }

    if (!Number.isFinite(count) || !Number.isInteger(count) || count <= 0) {
      throw new Error(`Invalid count for customize_no ${customize_no}. Count must be a positive integer.`);
    }

    return { customize_no, count };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    let core;
    try {
      core = validateCreateFields(req.body || {});
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    let skuList;
    try {
      skuList = validateSkus(req.body?.skus);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    let normalizedAddress;
    try {
      normalizedAddress = normalizeWooacryAddress(req.body?.address);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const bodyObj = {
      ...core,
      skus: skuList,
      address: normalizedAddress
    };

    const { raw, headers } = buildSignedJsonRequest(bodyObj);

    const wooResp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/create`, {
      method: "POST",
      headers,
      body: raw
    });

    const parsed = await readWooacryJson(wooResp);

    if (!parsed.ok) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for order/create",
        wooacry_http_status: wooResp.status,
        body_preview: parsed.raw.slice(0, 800)
      });
    }

    const result = parsed.json;

    if (!result || typeof result.code === "undefined") {
      return res.status(502).json({
        error: "Wooacry returned malformed JSON for order/create",
        wooacry_http_status: wooResp.status,
        details: result
      });
    }

    if (result.code !== 0) {
      return res.status(502).json({
        error: "Wooacry order creation failed",
        wooacry_http_status: wooResp.status,
        wooacry_code: result.code,
        wooacry_message: result.message || null,
        details: result
      });
    }

    const data = result.data || {};
    const returnedSkus = Array.isArray(data.skus) ? data.skus : null;

    if (
      !data ||
      !data.order_sn ||
      !Number.isInteger(data.total_amount) ||
      !Number.isInteger(data.sku_amount) ||
      !Number.isInteger(data.postal_amount) ||
      !Number.isInteger(data.tax_amount) ||
      !Number.isInteger(data.tax_service_amount) ||
      !returnedSkus
    ) {
      return res.status(502).json({
        error: "Wooacry create-order response missing required data",
        wooacry_http_status: wooResp.status,
        details: result
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[wooacry-order-create ERROR]", err);
    return res.status(500).json({
      error: err?.message || "Unknown error"
    });
  }
}

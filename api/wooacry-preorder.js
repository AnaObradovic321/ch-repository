import {
  WOOACRY_API_BASE,
  buildSignedJsonRequest,
  normalizeWooacryAddress,
  readWooacryJson
} from "./wooacry-utils.js";

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
    const { third_party_user, skus, address, debug } = req.body || {};

    const tpu = String(third_party_user || "").trim();
    if (!tpu) {
      return res.status(400).json({
        error: "Missing or invalid third_party_user"
      });
    }

    let skuList;
    try {
      skuList = validateSkus(skus);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    let normalizedAddress;
    try {
      normalizedAddress = normalizeWooacryAddress(address);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const bodyObj = {
      third_party_user: tpu,
      skus: skuList,
      address: normalizedAddress
    };

    const { raw, headers } = buildSignedJsonRequest(bodyObj);

    const wooResp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/create/pre`, {
      method: "POST",
      headers,
      body: raw
    });

    const parsed = await readWooacryJson(wooResp);

    if (!parsed.ok) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for order/create/pre",
        wooacry_http_status: wooResp.status,
        body_preview: parsed.raw.slice(0, 800)
      });
    }

    const result = parsed.json;

    if (!result || typeof result.code === "undefined") {
      return res.status(502).json({
        error: "Wooacry returned malformed JSON for order/create/pre",
        wooacry_http_status: wooResp.status,
        details: result
      });
    }

    if (result.code !== 0) {
      return res.status(502).json({
        error: "Wooacry pre-order failed",
        wooacry_http_status: wooResp.status,
        wooacry_code: result.code,
        wooacry_message: result.message || null,
        details: result
      });
    }

    const shippingMethods = Array.isArray(result?.data?.shipping_methods)
      ? result.data.shipping_methods
      : null;

    const returnedSkus = Array.isArray(result?.data?.skus)
      ? result.data.skus
      : null;

    if (!shippingMethods || !returnedSkus) {
      return res.status(502).json({
        error: "Wooacry pre-order response missing required data",
        wooacry_http_status: wooResp.status,
        details: result
      });
    }

    if (String(debug) === "1") {
      return res.status(200).json({
        ok: true,
        request_summary: {
          third_party_user: tpu,
          sku_count: skuList.length,
          destination_country: normalizedAddress.country_code
        },
        shipping_methods_count: shippingMethods.length,
        shipping_methods_preview: shippingMethods.slice(0, 5),
        skus: returnedSkus
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[wooacry-preorder ERROR]", err);
    return res.status(500).json({
      error: err?.message || "Unknown error"
    });
  }
}

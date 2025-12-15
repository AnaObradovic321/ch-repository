import { WOOACRY_API_BASE, buildHeaders, readWooacryJson } from "./wooacry-utils.js";

function pickThirdPartyOrderSn(req) {
  if (req.method === "GET") {
    return req.query.third_party_order_sn || req.query.order_id || req.query.shopify_order_id || null;
  }
  return req.body?.third_party_order_sn || req.body?.order_id || req.body?.shopify_order_id || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const third_party_order_sn = pickThirdPartyOrderSn(req);
    if (!third_party_order_sn || String(third_party_order_sn).trim() === "") {
      return res.status(400).json({ error: "Missing third_party_order_sn (or order_id/shopify_order_id)" });
    }

    const bodyObj = { third_party_order_sn: String(third_party_order_sn).trim() };
    const raw = JSON.stringify(bodyObj);

    const wooResp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/info`, {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    });

    const parsed = await readWooacryJson(wooResp);
    if (!parsed.ok) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for order/info",
        wooacry_http_status: wooResp.status,
        body_preview: parsed.raw.slice(0, 500)
      });
    }

    return res.status(200).json({
      ok: parsed.json?.code === 0,
      wooacry_http_status: wooResp.status,
      request: bodyObj,
      response: parsed.json
    });
  } catch (err) {
    console.error("[wooacry-order-info ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

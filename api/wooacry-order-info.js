import { buildHeaders } from "./wooacry-utils.js";

const WOOACRY_BASE = process.env.WOOACRY_BASE || "https://api-new.wooacry.com";
const ENDPOINT = `${WOOACRY_BASE}/api/reseller/open/order/info`;

function badRequest(res, message, extra = {}) {
  return res.status(400).json({ error: message, ...extra });
}

function pickThirdPartyOrderSn(req) {
  if (req.method === "GET") {
    return (
      req.query.third_party_order_sn ||
      req.query.order_id ||
      req.query.shopify_order_id ||
      null
    );
  }

  return (
    req.body?.third_party_order_sn ||
    req.body?.order_id ||
    req.body?.shopify_order_id ||
    null
  );
}

export default async function handler(req, res) {
  // Docs: Wooacry endpoint is POST, but we can allow GET or POST from our caller.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const third_party_order_sn = pickThirdPartyOrderSn(req);

    if (!third_party_order_sn || String(third_party_order_sn).trim() === "") {
      return badRequest(res, "Missing third_party_order_sn (or order_id/shopify_order_id)");
    }

    // Docs: body must be exactly {"third_party_order_sn":"..."} :contentReference[oaicite:6]{index=6}
    const bodyObj = { third_party_order_sn: String(third_party_order_sn).trim() };
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
    console.error("[wooacry-order-info ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

import {
  WOOACRY_API_BASE,
  buildHeaders,
  normalizeWooacryAddress,
  readWooacryJson
} from "./wooacry-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed. Use POST." });

  try {
    const third_party_order_sn =
      req.body?.third_party_order_sn || req.body?.order_id || req.body?.shopify_order_id;

    if (!third_party_order_sn || String(third_party_order_sn).trim() === "") {
      return res.status(400).json({ error: "Missing third_party_order_sn (your Shopify order id)." });
    }

    let address;
    try {
      address = normalizeWooacryAddress(req.body?.address);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const bodyObj = { third_party_order_sn: String(third_party_order_sn).trim(), address };
    const raw = JSON.stringify(bodyObj);

    const wooResp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/address/change`, {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    });

    const parsed = await readWooacryJson(wooResp);
    if (!parsed.ok) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for order/address/change",
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
    console.error("[wooacry-address-change ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

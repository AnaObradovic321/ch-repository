// /pages/api/wooacry-order-cancel.js
import { buildHeaders } from "./wooacry-utils.js";

export default async function handler(req, res) {
  // Wooacry wants POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  try {
    // We accept a few names so it's harder to break
    const third_party_order_sn =
      req.body?.third_party_order_sn ||
      req.body?.order_id ||
      req.body?.shopify_order_id;

    if (!third_party_order_sn || String(third_party_order_sn).trim() === "") {
      return res.status(400).json({
        error: "Missing third_party_order_sn (your Shopify order id)."
      });
    }

    // Build Wooacry request body
    const body = {
      third_party_order_sn: String(third_party_order_sn).trim()
    };

    // IMPORTANT: the signature is made from the EXACT JSON string
    const raw = JSON.stringify(body);

    // Call Wooacry
    const wooResp = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/cancel",
      {
        method: "POST",
        headers: buildHeaders(raw),
        body: raw
      }
    );

    // Wooacry sometimes returns text first, so parse safely
    const text = await wooResp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON",
        wooacry_http_status: wooResp.status,
        body_preview: text.slice(0, 500)
      });
    }

    // Return Wooacry response to whoever called this endpoint
    return res.status(200).json({
      ok: json?.code === 0,
      wooacry_http_status: wooResp.status,
      request: body,
      response: json
    });
  } catch (err) {
    console.error("Wooacry Order Cancel ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

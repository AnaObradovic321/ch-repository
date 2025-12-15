import { buildHeaders } from "./wooacry-utils.js";

const WOOACRY_BASE = process.env.WOOACRY_API_BASE || "https://api-new.wooacry.com";
const ENDPOINT = `${WOOACRY_BASE}/api/reseller/open/order/cancel`;

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const third_party_order_sn =
    (req.method === "GET" ? req.query?.third_party_order_sn : req.body?.third_party_order_sn) ||
    req.query?.order_id || req.body?.order_id;

  if (!String(third_party_order_sn || "").trim()) {
    return res.status(400).json({ error: "Missing third_party_order_sn" });
  }

  const bodyObj = { third_party_order_sn: String(third_party_order_sn).trim() };
  const raw = JSON.stringify(bodyObj);

  const wooResp = await fetch(ENDPOINT, {
    method: "POST",
    headers: buildHeaders(raw),
    body: raw
  });

  const text = await wooResp.text();
  let json;
  try { json = JSON.parse(text); }
  catch {
    return res.status(502).json({ error: "Wooacry returned non-JSON", wooacry_http_status: wooResp.status, body_preview: text.slice(0, 500) });
  }

  return res.status(200).json({ ok: json?.code === 0, wooacry_http_status: wooResp.status, request: bodyObj, response: json });
}

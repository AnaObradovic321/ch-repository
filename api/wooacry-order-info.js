// /pages/api/wooacry-order-info.js
import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const VERSION = "1";

const WOOACRY_BASE = "https://api-new.wooacry.com";
const ENDPOINT = `${WOOACRY_BASE}/api/reseller/open/order/info`;

/**
 * Remove undefined/null in a deterministic way so JSON.stringify is stable.
 */
function clean(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Wooacry signature:
 * PartnerID\n
 * Timestamp\n
 * Version\n
 * BodyString\n
 * Secret\n
 */
function buildSign(bodyString, timestamp) {
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${VERSION}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

/**
 * Small helper for consistent errors.
 */
function badRequest(res, message, extra = {}) {
  return res.status(400).json({ error: message, ...extra });
}

export default async function handler(req, res) {
  try {
    // Allow GET or POST
    const third_party_order_sn =
      (req.method === "GET" ? req.query.third_party_order_sn : req.body?.third_party_order_sn) ||
      (req.method === "GET" ? req.query.order_id : req.body?.order_id) ||
      (req.method === "GET" ? req.query.shopify_order_id : req.body?.shopify_order_id);

    if (!third_party_order_sn) {
      return badRequest(res, "Missing third_party_order_sn (or order_id/shopify_order_id)");
    }

    // Only allow GET/POST
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const bodyObj = clean({ third_party_order_sn: String(third_party_order_sn) });
    const bodyString = JSON.stringify(bodyObj);

    // IMPORTANT: Wooacry timestamp window is small (<= 5 seconds per docs)
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = buildSign(bodyString, timestamp);

    const wooResp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Reseller-Flag": RESELLER_FLAG,
        "Timestamp": String(timestamp),
        "Version": VERSION,
        "Sign": sign
      },
      body: bodyString
    });

    const text = await wooResp.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON",
        status: wooResp.status,
        body_preview: text.slice(0, 500)
      });
    }

    // If Wooacry returns non-0 code, surface it but keep HTTP 200 so callers can handle deterministically
    // If you prefer strict failure, change this to res.status(500) when json.code !== 0.
    return res.status(200).json({
      ok: json?.code === 0,
      wooacry_http_status: wooResp.status,
      request: { third_party_order_sn: String(third_party_order_sn) },
      response: json
    });
  } catch (err) {
    console.error("[wooacry-order-info ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}


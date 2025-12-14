import crypto from "crypto";

// ------------------------------------------------------------------
// CONFIG
// Best practice: use env vars. Fallbacks keep it working if you paste.
// ------------------------------------------------------------------
const RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "characterhub";
const SECRET = process.env.WOOACRY_SECRET || "3710d71b1608f78948a60602c4a6d9d8";

// Wooacry editor redirect endpoint
const API_URL =
  process.env.WOOACRY_EDITOR_REDIRECT_URL ||
  "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

// ------------------------------------------------------------------
// Shopify product_id -> Wooacry third_party_spu mapping
// IMPORTANT: This value MUST match what Wooacry expects.
// If 453 stopped working, change it here after we confirm the right value.
// ------------------------------------------------------------------
const SPU_MAP = {
  "7551372951665": "453" // Posters
  // Add more mappings here
};

// ------------------------------------------------------------------
// Helper: build base URL for this deployment (works on Vercel + local)
// ------------------------------------------------------------------
function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

// ------------------------------------------------------------------
// Wooacry redirect signature (NOT the same as open API signature)
// sign = MD5("reseller_flag=...&timestamp=...&third_party_user=...&secret=...")
// ------------------------------------------------------------------
function buildRedirectSign({ timestamp, third_party_user }) {
  const sigString =
    `reseller_flag=${RESELLER_FLAG}` +
    `&timestamp=${timestamp}` +
    `&third_party_user=${third_party_user}` +
    `&secret=${SECRET}`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

// ------------------------------------------------------------------
// Main handler
// ------------------------------------------------------------------
export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    // Allow quick testing without code changes:
    // Example:
    // /api/wooacry-customize-init?product_id=...&variant_id=...&spu=24
    const overrideSpu = req.query.spu ? String(req.query.spu) : null;

    // 1) Get the Wooacry SPU to use
    const mappedSpu = SPU_MAP[String(product_id)];
    const third_party_spu = overrideSpu || mappedSpu;

    if (!third_party_spu) {
      return res.status(500).json({
        error: `No SPU configured for product ${product_id}`,
        hint:
          "Add it to SPU_MAP in api/wooacry-customize-init.js or pass &spu=VALUE in the URL to test."
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);

    // This is just an identifier for who is customizing.
    // Keep it simple for now.
    const third_party_user = "guest";

    // 2) Build callback URL on YOUR server.
    // We include variant_id so callback never needs SPU mapping.
    const baseUrl = getBaseUrl(req);
    const redirect_url =
      `${baseUrl}/api/wooacry-callback` +
      `?product_id=${encodeURIComponent(String(product_id))}` +
      `&variant_id=${encodeURIComponent(String(variant_id))}`;

    // 3) Sign the redirect request
    const sign = buildRedirectSign({ timestamp, third_party_user });

    // 4) Build final URL to Wooacry
    const finalUrl =
      `${API_URL}` +
      `?reseller_flag=${encodeURIComponent(RESELLER_FLAG)}` +
      `&timestamp=${encodeURIComponent(String(timestamp))}` +
      `&third_party_user=${encodeURIComponent(third_party_user)}` +
      `&third_party_spu=${encodeURIComponent(String(third_party_spu))}` +
      `&redirect_url=${encodeURIComponent(redirect_url)}` +
      `&sign=${encodeURIComponent(sign)}`;

    console.log("[wooacry-customize-init] product_id =", product_id);
    console.log("[wooacry-customize-init] variant_id =", variant_id);
    console.log("[wooacry-customize-init] third_party_spu =", third_party_spu);
    console.log("[wooacry-customize-init] redirect_url =", redirect_url);

    // 5) Fetch Wooacry redirect endpoint, do not auto-follow
    const wooacryResponse = await fetch(finalUrl, { redirect: "manual" });

    // 6) Wooacry should respond with a redirect Location header
    const editorLocation = wooacryResponse.headers.get("location");

    if (!editorLocation) {
      const body = await wooacryResponse.text();
      console.error("Wooacry did not return a redirect. Status:", wooacryResponse.status);
      console.error("Wooacry body:", body);

      return res.status(500).json({
        error: "Wooacry did not provide redirect location.",
        status: wooacryResponse.status,
        third_party_spu_used: third_party_spu,
        details: body
      });
    }

    // 7) Send the browser to the Wooacry editor
    return res.redirect(302, editorLocation);
  } catch (err) {
    console.error("Wooacry Init ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

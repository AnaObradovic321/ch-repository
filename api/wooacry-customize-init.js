import crypto from "crypto";

// ------------------------------------------------------------------
// CONFIG (must be real env vars in prod; no secret fallback)
// ------------------------------------------------------------------
const RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "characterhub";
const SECRET = process.env.WOOACRY_SECRET; // REQUIRED

// Wooacry editor redirect endpoint (prod vs pre)
const API_URL =
  process.env.WOOACRY_EDITOR_REDIRECT_URL ||
  "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

// Callback style:
// - "query" keeps your current behavior: /api/wooacry-callback?product_id=...&variant_id=...
// - "path" is safer with Wooacry's customize_no append behavior, but requires your callback route to support it.
const CALLBACK_STYLE = (process.env.WOOACRY_CALLBACK_STYLE || "query").toLowerCase();

// Shopify product_id -> Wooacry third_party_spu mapping
const SPU_MAP = {
  "7551372951665": "453" // Posters
  // Add more mappings here
};

// ------------------------------------------------------------------
// Helper: build base URL for this deployment (Vercel + local)
// ------------------------------------------------------------------
function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

// ------------------------------------------------------------------
// Helper: stable-ish guest user id if you don't have auth wired yet
// Priority: explicit query param -> hashed ip+ua
// ------------------------------------------------------------------
function getThirdPartyUser(req) {
  const explicit =
    req.query.third_party_user ||
    req.query.user_id ||
    req.query.customer_id ||
    req.query.user;

  if (explicit) return String(explicit);

  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket?.remoteAddress || "0.0.0.0");
  const ua = (req.headers["user-agent"] || "unknown").toString();

  const raw = `${ip}|${ua}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `guest_${hash}`;
}

// ------------------------------------------------------------------
// Wooacry redirect signature (NOT the open API signature)
// sign = MD5("reseller_flag=...&timestamp=...&third_party_user=...&secret=...")
// Per docs. :contentReference[oaicite:3]{index=3}
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
// Build redirect_url
// Default keeps existing callback shape so other code doesn't break.
// Docs show Wooacry appends customize_no like: callback?customize_no=... :contentReference[oaicite:4]{index=4}
// ------------------------------------------------------------------
function buildRedirectUrl(req, baseUrl, product_id, variant_id) {
  if (CALLBACK_STYLE === "path") {
    // WARNING: requires your callback route to support this path form.
    // Example: /api/wooacry-callback/7551372951665/42832621797489
    return `${baseUrl}/api/wooacry-callback/${encodeURIComponent(
      String(product_id)
    )}/${encodeURIComponent(String(variant_id))}`;
  }

  // Default: query style (backwards compatible with what you have now)
  return (
    `${baseUrl}/api/wooacry-callback` +
    `?product_id=${encodeURIComponent(String(product_id))}` +
    `&variant_id=${encodeURIComponent(String(variant_id))}`
  );
}

// ------------------------------------------------------------------
// Main handler
// ------------------------------------------------------------------
export default async function handler(req, res) {
  try {
    if (!SECRET) {
      return res.status(500).json({
        error: "Missing WOOACRY_SECRET env var. Refusing to run without it."
      });
    }

    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    // Allow quick testing without code changes:
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

    // 2) Build required fields
    const timestamp = Math.floor(Date.now() / 1000); // seconds; must be within 60s drift per docs :contentReference[oaicite:5]{index=5}
    const third_party_user = getThirdPartyUser(req);

    const baseUrl = getBaseUrl(req);
    const redirect_url = buildRedirectUrl(req, baseUrl, product_id, variant_id);

    // 3) Sign the redirect request (per Wooacry redirect rules)
    const sign = buildRedirectSign({ timestamp, third_party_user });

    // 4) Build final URL to Wooacry editor redirect endpoint
    // Required params per docs :contentReference[oaicite:6]{index=6}
    const finalUrl =
      `${API_URL}` +
      `?reseller_flag=${encodeURIComponent(RESELLER_FLAG)}` +
      `&timestamp=${encodeURIComponent(String(timestamp))}` +
      `&redirect_url=${encodeURIComponent(redirect_url)}` +
      `&third_party_user=${encodeURIComponent(third_party_user)}` +
      `&third_party_spu=${encodeURIComponent(String(third_party_spu))}` +
      `&sign=${encodeURIComponent(sign)}`;

    // Logs (no secrets)
    console.log("[wooacry-customize-init] product_id =", product_id);
    console.log("[wooacry-customize-init] variant_id =", variant_id);
    console.log("[wooacry-customize-init] third_party_spu =", third_party_spu);
    console.log("[wooacry-customize-init] third_party_user =", third_party_user);
    console.log("[wooacry-customize-init] redirect_url =", redirect_url);
    console.log("[wooacry-customize-init] callback_style =", CALLBACK_STYLE);

    // 5) Redirect the browser straight to Wooacry
    return res.redirect(302, finalUrl);
  } catch (err) {
    console.error("Wooacry Init ERROR:", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

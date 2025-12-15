import crypto from "crypto";

const RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "characterhub";
const SECRET = process.env.WOOACRY_SECRET; // REQUIRED

const API_URL =
  process.env.WOOACRY_EDITOR_REDIRECT_URL ||
  "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

const CALLBACK_STYLE = (process.env.WOOACRY_CALLBACK_STYLE || "query").toLowerCase();

const SPU_MAP = {
  "7551372951665": "453"
};

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function getThirdPartyUser(req) {
  const explicit = req.query.third_party_user || req.query.user_id || req.query.customer_id || req.query.user;
  if (explicit) return String(explicit);

  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    (req.socket?.remoteAddress || "0.0.0.0");
  const ua = (req.headers["user-agent"] || "unknown").toString();

  const raw = `${ip}|${ua}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `guest_${hash}`;
}

// MD5("reseller_flag=...&timestamp=...&third_party_user=...&secret=...")
function buildRedirectSign({ timestamp, third_party_user }) {
  if (!SECRET) throw new Error("Missing WOOACRY_SECRET env var");

  const sigString =
    `reseller_flag=${RESELLER_FLAG}` +
    `&timestamp=${timestamp}` +
    `&third_party_user=${third_party_user}` +
    `&secret=${SECRET}`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

function buildRedirectUrl(req, baseUrl, product_id, variant_id) {
  if (CALLBACK_STYLE === "path") {
    return `${baseUrl}/api/wooacry-callback/${encodeURIComponent(String(product_id))}/${encodeURIComponent(
      String(variant_id)
    )}`;
  }

  return (
    `${baseUrl}/api/wooacry-callback` +
    `?product_id=${encodeURIComponent(String(product_id))}` +
    `&variant_id=${encodeURIComponent(String(variant_id))}`
  );
}

export default async function handler(req, res) {
  try {
    if (!SECRET) {
      return res.status(500).json({ error: "Missing WOOACRY_SECRET env var. Refusing to run without it." });
    }

    const { product_id, variant_id } = req.query;
    if (!product_id || !variant_id) return res.status(400).json({ error: "Missing product_id or variant_id" });

    const overrideSpu = req.query.spu ? String(req.query.spu) : null;

    const mappedSpu = SPU_MAP[String(product_id)];
    const third_party_spu = overrideSpu || mappedSpu;
    if (!third_party_spu) {
      return res.status(500).json({
        error: `No SPU configured for product ${product_id}`,
        hint: "Add it to SPU_MAP in api/wooacry-customize-init.js or pass &spu=VALUE to test."
      });
    }

    const timestamp = Math.floor(Date.now() / 1000); // redirect endpoint allows 60s drift per docs
    const third_party_user = getThirdPartyUser(req);

    const baseUrl = getBaseUrl(req);
    const redirect_url = buildRedirectUrl(req, baseUrl, product_id, variant_id);

    const sign = buildRedirectSign({ timestamp, third_party_user });

    const finalUrl =
      `${API_URL}` +
      `?reseller_flag=${encodeURIComponent(RESELLER_FLAG)}` +
      `&timestamp=${encodeURIComponent(String(timestamp))}` +
      `&redirect_url=${encodeURIComponent(redirect_url)}` +
      `&third_party_user=${encodeURIComponent(third_party_user)}` +
      `&third_party_spu=${encodeURIComponent(String(third_party_spu))}` +
      `&sign=${encodeURIComponent(sign)}`;

    return res.redirect(302, finalUrl);
  } catch (err) {
    console.error("[wooacry-customize-init ERROR]", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

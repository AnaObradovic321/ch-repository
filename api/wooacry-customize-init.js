import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";

// Wooacry redirect endpoint
const REDIRECT_API = "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

// Your Shopify callback URL
const CALLBACK_BASE = "https://characterhub-merch-store.myshopify.com/pages/wooacry-callback";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id)
      return res.status(400).json({ error: "Missing product_id or variant_id" });

    // SPU = product id from Shopify
    const third_party_spu = product_id;

    // For now, user is guest. Later integrate CH user IDs.
    const third_party_user = "guest";

    // Build callback URL
    const redirect_raw = `${CALLBACK_BASE}?product_id=${product_id}&variant_id=${variant_id}`;
    const redirect_url = encodeURIComponent(redirect_raw);

    const timestamp = Math.floor(Date.now() / 1000);

    // SIGNATURE STRING (simple format)
    const signatureString =
      `reseller_flag=${RESELLER_FLAG}&timestamp=${timestamp}&third_party_user=${third_party_user}&secret=${SECRET}`;

    const sign = crypto.createHash("md5").update(signatureString).digest("hex");

    // FINAL REDIRECT URL
    const finalURL =
      `${REDIRECT_API}?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&redirect_url=${redirect_url}` +
      `&third_party_spu=${third_party_spu}` +
      `&third_party_user=${third_party_user}` +
      `&sign=${sign}`;

    console.log("Redirecting to Wooacry editor:", finalURL);

    return res.redirect(302, finalURL);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}

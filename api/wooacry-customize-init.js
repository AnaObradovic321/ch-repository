import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";

// Wooacry redirect API (required)
const REDIRECT_API =
  "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

// Shopify callback page
const CALLBACK_BASE =
  "https://characterhub-merch-store.myshopify.com/pages/wooacry-callback";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({
        error: "Missing product_id or variant_id"
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const third_party_user = "guest"; // Can be replaced with CH user later
    const third_party_spu = product_id;

    // Build callback URL including ALL parameters
    const callbackRaw =
      `${CALLBACK_BASE}?product_id=${product_id}` +
      `&variant_id=${variant_id}` +
      `&from=wooacry`;

    const redirect_url = encodeURIComponent(callbackRaw);

    // Build signature EXACTLY per Wooacry docs
    const sigString =
      `reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${third_party_user}` +
      `&secret=${SECRET}`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    // Final redirect URL to Wooacry
    const finalURL =
      `${REDIRECT_API}?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&redirect_url=${redirect_url}` +
      `&third_party_spu=${third_party_spu}` +
      `&third_party_user=${third_party_user}` +
      `&sign=${sign}`;

    console.log("Wooacry Redirect URL:", finalURL);

    return res.redirect(302, finalURL);

  } catch (err) {
    console.error("customize-init error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";

// THE ONLY VALID REDIRECT URL (per API docs)
const REDIRECT_API =
  "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

// Your Shopify callback URL
const CALLBACK_BASE =
  "https://characterhub-merch-store.myshopify.com/pages/wooacry-callback";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res
        .status(400)
        .json({ error: "Missing product_id or variant_id" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const third_party_user = "guest"; // temporary
    const third_party_spu = product_id;

    // Build Shopify callback URL
    const rawCallback = `${CALLBACK_BASE}?product_id=${product_id}&variant_id=${variant_id}`;
    const redirect_url = encodeURIComponent(rawCallback);

    // Build signature EXACTLY per documentation
    const sigString = `reseller_flag=${RESELLER_FLAG}&timestamp=${timestamp}&third_party_user=${third_party_user}&secret=${SECRET}`;
    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    // FINAL URL (the ONLY correct redirect URL)
    const finalURL =
      `${REDIRECT_API}?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&redirect_url=${redirect_url}` +
      `&third_party_spu=${third_party_spu}` +
      `&third_party_user=${third_party_user}` +
      `&sign=${sign}`;

    console.log("Correct Redirect URL:", finalURL);

    // Redirect user to Wooacry API, not the editor
    return res.redirect(302, finalURL);
  } catch (err) {
    console.error("customize-init error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
// force deploy test

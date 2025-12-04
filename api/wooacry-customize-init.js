import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const WOOACRY_EDITOR_URL = "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

const SHOPIFY_CALLBACK = "https://characterhub-merch-store.myshopify.com/pages/wooacry-callback";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const third_party_user = "characterhub_user";

    const signatureString =
      `reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${third_party_user}` +
      `&secret=${SECRET}`;

    const sign = crypto.createHash("md5").update(signatureString).digest("hex");

    const redirectUrl = encodeURIComponent(
      `${SHOPIFY_CALLBACK}?variant_id=${variant_id}&product_id=${product_id}`
    );

    const finalUrl =
      `${WOOACRY_EDITOR_URL}` +
      `?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&redirect_url=${redirectUrl}` +
      `&third_party_spu=${product_id}` +
      `&third_party_user=${third_party_user}` +
      `&sign=${sign}`;

    res.writeHead(302, { Location: finalUrl });
    res.end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to initialize customization" });
  }
}

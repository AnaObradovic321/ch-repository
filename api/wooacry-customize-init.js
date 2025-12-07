import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";

const REDIRECT_API =
  "https://api-new.wooacry.com/api/reseller/open/web/editor/redirect";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const third_party_user = "guest";
    const third_party_spu = product_id;

    const callbackUrl =
      `https://characterhub-merch-store.myshopify.com/pages/wooacry-callback?product_id=${product_id}&variant_id=${variant_id}`;

    const redirect_url = encodeURIComponent(callbackUrl);

    const sigString =
      `reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${third_party_user}` +
      `&secret=${SECRET}`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    // CALL Wooacry
    const url =
      `${REDIRECT_API}?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&redirect_url=${redirect_url}` +
      `&third_party_spu=${third_party_spu}` +
      `&third_party_user=${third_party_user}` +
      `&sign=${sign}`;

    const wooacryResp = await fetch(url);
    const data = await wooacryResp.json();

    if (!data?.data?.redirect_url) {
      console.error("Wooacry redirect error:", data);
      return res.status(500).json({ error: "Wooacry redirect failed", data });
    }

    return res.redirect(302, data.data.redirect_url);

  } catch (err) {
    console.error("Init error:", err);
    return res.status(500).json({ error: err.message });
  }
}

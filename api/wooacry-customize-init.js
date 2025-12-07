import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const API_URL = "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const version = "1";

    const body = {
      third_party_user: "guest",
      third_party_spu: product_id,
      redirect_url: `https://characterhub-merch-store.myshopify.com/pages/wooacry-callback?product_id=${product_id}&variant_id=${variant_id}`
    };

    // EXACT signature required by documentation
    const sigString =
      `${RESELLER_FLAG}\n${timestamp}\n${version}\n${JSON.stringify(body)}\n${SECRET}\n`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Reseller-Flag": RESELLER_FLAG,
        "Timestamp": String(timestamp),
        "Version": version,
        "Sign": sign
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!data?.data?.redirect_url) {
      console.error("Wooacry Error:", data);
      return res.status(500).json({ error: "Wooacry redirect failed", details: data });
    }

    return res.redirect(302, data.data.redirect_url);

  } catch (err) {
    console.error("Customize-Init ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

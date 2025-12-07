import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";

const API_URL =
  "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const version = "1";

    const third_party_user = "guest";
    const third_party_spu = product_id;

    const redirect_url =
      `https://characterhub-merch-store.myshopify.com/pages/wooacry-callback`
      + `?product_id=${product_id}`
      + `&variant_id=${variant_id}`;

    // Correct signature used by Wooacry redirect API
    const sigString =
      `${RESELLER_FLAG}\n${timestamp}\n${version}\n${SECRET}\n`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    // All params must be GET
    const finalUrl =
      `${API_URL}?reseller_flag=${RESELLER_FLAG}`
      + `&timestamp=${timestamp}`
      + `&version=${version}`
      + `&third_party_user=${encodeURIComponent(third_party_user)}`
      + `&third_party_spu=${encodeURIComponent(third_party_spu)}`
      + `&redirect_url=${encodeURIComponent(redirect_url)}`
      + `&sign=${sign}`;

    console.log("Requesting Wooacry Redirect:", finalUrl);

    // Wooacry redirects with 302 HTML, not JSON → we must NOT parse JSON
    const response = await fetch(finalUrl, { method: "GET" });

    const text = await response.text();

    // If Wooacry returns HTML with JS redirect, send it directly
    if (text.startsWith("<")) {
      return res.status(200).send(text);
    }

    // Otherwise attempt JSON
    try {
      const data = JSON.parse(text);
      if (data?.data?.redirect_url) {
        return res.redirect(302, data.data.redirect_url);
      }
      return res.status(500).json({ error: "Unexpected Wooacry response", data });
    } catch {
      return res.status(500).send(text);
    }

  } catch (err) {
    console.error("Error in customize-init:", err);
    return res.status(500).json({ error: err.message });
  }
}

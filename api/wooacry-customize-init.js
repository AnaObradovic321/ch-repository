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

    const third_party_user = "guest";
    const third_party_spu = product_id;

    const redirect_url =
      `https://characterhub-merch-store.myshopify.com/pages/wooacry-callback` +
      `?product_id=${product_id}` +
      `&variant_id=${variant_id}`;

    // Wooacry rule: body is EMPTY for this endpoint
    const EMPTY_BODY = "";

    const sigString =
      `${RESELLER_FLAG}\n${timestamp}\n${version}\n${EMPTY_BODY}\n${SECRET}\n`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    const finalUrl =
      `${API_URL}` +
      `?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&version=${version}` +
      `&third_party_user=${encodeURIComponent(third_party_user)}` +
      `&third_party_spu=${encodeURIComponent(third_party_spu)}` +
      `&redirect_url=${encodeURIComponent(redirect_url)}` +
      `&sign=${sign}`;

    console.log("Wooacry Redirect URL:", finalUrl);

    // Call Wooacry endpoint
    const wooacryResponse = await fetch(finalUrl);

    const contentType = wooacryResponse.headers.get("content-type") || "";

    // CASE 1: Wooacry returns HTML editor page
    if (contentType.includes("text/html")) {
      const html = await wooacryResponse.text();
      return res.status(200).send(html);
    }

    // CASE 2: Wooacry returns a redirect header
    if (wooacryResponse.status >= 300 && wooacryResponse.status < 400) {
      const location = wooacryResponse.headers.get("location");
      if (location) return res.redirect(302, location);
    }

    // CASE 3: Wooacry returned JSON or text
    const text = await wooacryResponse.text();
    return res.status(200).send(text);

  } catch (err) {
    console.error("Wooacry Init ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

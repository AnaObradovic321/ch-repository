import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const API_URL = "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

// HARD CODE SPU MAPPING HERE
const SPU_MAP = {
  "7551372951665": "453" // Posters
  // Add more product_id → SPU mappings here
};

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    // 1. Hardcode SPU lookup
    const third_party_spu = SPU_MAP[product_id];

    if (!third_party_spu) {
      return res.status(500).json({
        error: `No SPU configured for product ${product_id}`,
        hint: "Add it to SPU_MAP in the code"
      });
    }

    // 2. Timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    console.log("[wooacry-customize-init] timestamp =", timestamp);
    console.log("[wooacry-customize-init] product_id =", product_id);
    console.log("[wooacry-customize-init] SPU =", third_party_spu);

    const third_party_user = "guest";

    // 3. Callback URL
    const redirect_url =
      `https://characterhub-merch-store.myshopify.com/pages/wooacry-callback` +
      `?product_id=${product_id}` +
      `&variant_id=${variant_id}`;

    // 4. Signature
    const sigString =
      `reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${third_party_user}` +
      `&secret=${SECRET}`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    // 5. Final Wooacry URL
    const finalUrl =
      `${API_URL}` +
      `?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${encodeURIComponent(third_party_user)}` +
      `&third_party_spu=${encodeURIComponent(third_party_spu)}` +
      `&redirect_url=${encodeURIComponent(redirect_url)}` +
      `&sign=${sign}`;

    console.log("Wooacry Redirect URL:", finalUrl);

    const wooacryResponse = await fetch(finalUrl);
    const contentType = wooacryResponse.headers.get("content-type") || "";

    if (contentType.includes("text/html")) {
      const html = await wooacryResponse.text();
      return res.status(200).send(html);
    }

    if (wooacryResponse.status >= 300 && wooacryResponse.status < 400) {
      const location = wooacryResponse.headers.get("location");
      if (location) return res.redirect(302, location);
    }

    const text = await wooacryResponse.text();
    return res.status(200).send(text);

  } catch (err) {
    console.error("Wooacry Init ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

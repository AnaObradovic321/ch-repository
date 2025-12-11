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

    // 1. Hardcoded SPU lookup
    const third_party_spu = SPU_MAP[product_id];
    if (!third_party_spu) {
      return res.status(500).json({
        error: `No SPU configured for product ${product_id}`,
        hint: "Add it to SPU_MAP in the code"
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const third_party_user = "guest";

    console.log("[wooacry-customize-init] timestamp =", timestamp);
    console.log("[wooacry-customize-init] product_id =", product_id);
    console.log("[wooacry-customize-init] SPU =", third_party_spu);

    // 2. CALLBACK MUST BE AN API ROUTE — NOT A SHOPIFY PAGE
    const redirect_url =
      `https://ch-repository.vercel.app/api/wooacry-callback?product_id=${product_id}&variant_id=${variant_id}`;

    // 3. Build signature (matches Wooacry docs exactly)
    const sigString =
      `reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${third_party_user}` +
      `&secret=${SECRET}`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    // 4. Construct redirect request URL
    const finalUrl =
      `${API_URL}` +
      `?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${encodeURIComponent(third_party_user)}` +
      `&third_party_spu=${encodeURIComponent(third_party_spu)}` +
      `&redirect_url=${encodeURIComponent(redirect_url)}` +
      `&sign=${sign}`;

    console.log("Wooacry Final Redirect URL:", finalUrl);

    // 5. IMPORTANT: Prevent automatic redirect-following
    const wooacryResponse = await fetch(finalUrl, { redirect: "manual" });

    // 6. Extract Wooacry redirect destination
    const editorLocation = wooacryResponse.headers.get("location");

    if (!editorLocation) {
      const body = await wooacryResponse.text();
      console.error("Wooacry did not return a redirect. Body:", body);
      return res.status(500).json({
        error: "Wooacry did not provide redirect location.",
        details: body
      });
    }

    console.log("Redirecting user to Wooacry editor:", editorLocation);

    // 7. Send the user directly to Wooacry editor (fixes infinite spinner)
    return res.redirect(302, editorLocation);

  } catch (err) {
    console.error("Wooacry Init ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

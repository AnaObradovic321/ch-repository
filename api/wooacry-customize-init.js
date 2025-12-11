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
    console.log("[wooacry-customize-init] timestamp =", timestamp);

    const third_party_user = "guest";

    // 1. Fetch metafields from Shopify
    const shopifyMetaRes = await fetch(
      `https://characterhub-merch-store.myshopify.com/admin/api/2024-01/products/${product_id}/metafields.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const metaData = await shopifyMetaRes.json();

    if (!metaData.metafields) {
      throw new Error("No metafields returned from Shopify");
    }

    // 2. Find Wooacry SPU metafield
    const spuMeta = metaData.metafields.find(
      (m) => m.namespace === "wooacry" && m.key === "spu"
    );

    if (!spuMeta || !spuMeta.value) {
      console.error("SPU metafields returned:", metaData.metafields);
      throw new Error("Wooacry SPU metafield missing for this product");
    }

    const third_party_spu = spuMeta.value;

    // Build redirect url
    const redirect_url =
      `https://characterhub-merch-store.myshopify.com/pages/wooacry-callback` +
      `?product_id=${product_id}` +
      `&variant_id=${variant_id}`;

    // Signature
    const sigString =
      `reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${third_party_user}` +
      `&secret=${SECRET}`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    const finalUrl =
      `${API_URL}` +
      `?reseller_flag=${RESELLER_FLAG}` +
      `&timestamp=${timestamp}` +
      `&third_party_user=${encodeURIComponent(third_party_user)}` +
      `&third_party_spu=${encodeURIComponent(third_party_spu)}` +
      `&redirect_url=${encodeURIComponent(redirect_url)}` +
      `&sign=${sign}`;

    console.log("Wooacry Redirect URL:", finalUrl);

    // Wooacry request
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

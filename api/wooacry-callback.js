import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";

// Wooacry SKU → Shopify Variant ID mapping
const SKU_TO_VARIANT = {
  "70": "42832621797489"   // Poster
};

// Helper to generate Wooacry API signature
function generateSignature(body, timestamp) {
  const version = "1";
  const signatureString =
    `${RESELLER_FLAG}\n${timestamp}\n${version}\n${body}\n${SECRET}\n`;

  return crypto.createHash("md5").update(signatureString).digest("hex");
}

export default async function handler(req, res) {
  try {
    const { customize_no } = req.query;

    if (!customize_no) {
      return res.status(400).json({ error: "Missing customize_no" });
    }

    // 1. Fetch Wooacry customize-info to get SKU
    const bodyJSON = JSON.stringify({ customize_no });
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSignature(bodyJSON, timestamp);

    const wooacryResp = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/customize/info",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Reseller-Flag": RESELLER_FLAG,
          "Timestamp": timestamp,
          "Version": "1",
          "Sign": sign
        },
        body: bodyJSON
      }
    );

    const data = await wooacryResp.json();

    if (data.code !== 0) {
      return res.status(500).json({
        error: "Wooacry customize/info failed",
        wooacry: data
      });
    }

    const skuId = data.data.sku.id.toString();

    // 2. Map Wooacry SKU → Shopify Variant
    const shopifyVariantId = SKU_TO_VARIANT[skuId];

    if (!shopifyVariantId) {
      return res.status(500).json({
        error: "Missing SKU → Shopify Variant mapping",
        skuId,
        message: "Add this SKU to SKU_TO_VARIANT"
      });
    }

    // 3. Redirect user to Shopify's ONLY supported property-add endpoint
    const redirectUrl =
      `https://characterhub-merch-store.myshopify.com/cart/add` +
      `?id=${shopifyVariantId}` +
      `&quantity=1` +
      `&properties[customize_no]=${encodeURIComponent(customize_no)}`;

    return res.redirect(302, redirectUrl);

  } catch (err) {
    console.error("CALLBACK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

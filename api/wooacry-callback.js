import crypto from "crypto";

const API_BASE = "https://api-new.wooacry.com";
const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const VERSION = "1";

// Wooacry SKU → Shopify Variant mapping
const SKU_TO_VARIANT = {
  "54": "42832621797489" // example
};

function generateSignature(body, timestamp) {
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${VERSION}\n` +
    `${body}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

export default async function handler(req, res) {
  try {
    const customize_no = req.query.customize_no;
    if (!customize_no) {
      return res.status(400).send("Missing customize_no");
    }

    // 1 — Build body for Wooacry request
    const bodyObj = { customize_no };
    const bodyStr = JSON.stringify(bodyObj);

    const timestamp = Math.floor(Date.now() / 1000);
    const sign = generateSignature(bodyStr, timestamp);

    // 2 — Call Wooacry customize info API
    const wooacryResponse = await fetch(`${API_BASE}/api/reseller/open/customize/info`, {
      method: "POST",
      headers: {
        "Reseller-Flag": RESELLER_FLAG,
        "Timestamp": String(timestamp),
        "Version": VERSION,
        "Sign": sign,
        "Content-Type": "application/json"
      },
      body: bodyStr
    });

    const data = await wooacryResponse.json();

    if (data.code !== 0) {
      console.error("Wooacry customize info error:", data);
      return res.status(500).json({ error: "Wooacry customize info failed", details: data });
    }

    const skuId = String(data.data.sku.id);
    const variantId = SKU_TO_VARIANT[skuId];

    if (!variantId) {
      return res.status(500).json({
        error: "Missing SKU → Shopify Variant mapping",
        skuId,
        message: "Add this SKU to your SKU_TO_VARIANT map"
      });
    }

    // 3 — Add to Shopify cart using AJAX API
    const cartAddResponse = await fetch(
      "https://characterhub-merch-store.myshopify.com/cart/add.js",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: variantId,
          quantity: 1,
          properties: {
            customize_no
          }
        })
      }
    );

    if (!cartAddResponse.ok) {
      const txt = await cartAddResponse.text();
      return res.status(500).json({
        error: "Failed to add to Shopify cart",
        details: txt
      });
    }

    // 4 — Redirect user to Shopify cart page
    return res.redirect(302, "https://characterhub-merch-store.myshopify.com/cart");

  } catch (err) {
    console.error("Callback error:", err);
    return res.status(500).json({ error: err.message });
  }
}

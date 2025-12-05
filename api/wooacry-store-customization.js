// api/wooacry-store-customization.js
import crypto from "crypto";

const SHOPIFY_DOMAIN = "characterhub-merch-store.myshopify.com";

export default async function handler(req, res) {
  try {
    const { customize_no, variant_id } = req.query;

    if (!customize_no) {
      return res.status(400).json({ error: "Missing customize_no" });
    }

    if (!variant_id) {
      return res.status(400).json({ error: "Missing variant_id" });
    }

    // 1. Fetch Wooacry customization details
    const infoResponse = await fetch(
      `https://ch-repository.vercel.app/api/wooacry-customize-info`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customize_no })
      }
    );

    const info = await infoResponse.json();

    if (!info.data) {
      return res.status(500).json({
        error: "Failed retrieving customize info",
        details: info
      });
    }

    const sku = info.data.sku;
    const renderImages = info.data.render_images || [];

    // 2. Prepare Shopify cart payload
    const payload = {
      items: [
        {
          id: variant_id,   // ✔ CORRECT: Shopify variant ID
          quantity: 1,
          properties: {
            customize_no: customize_no,
            custom_mockup: renderImages[0] || "",
            custom_spu: info.data.spu.name,
            custom_sku_name: sku.name
          }
        }
      ]
    };

    // 3. POST to Shopify cart/add.js
    const cartResponse = await fetch(
      `https://${SHOPIFY_DOMAIN}/cart/add.js`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!cartResponse.ok) {
      const errText = await cartResponse.text();
      console.error("Shopify error:", errText);
      return res.status(500).json({ error: "Shopify rejected item", details: errText });
    }

    // 4. Redirect user to Shopify cart page
    return res.redirect(
      302,
      `https://${SHOPIFY_DOMAIN}/cart`
    );

  } catch (err) {
    console.error("store-customization error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}

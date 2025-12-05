// api/wooacry-store-customization.js

const SHOPIFY_DOMAIN = "characterhub-merch-store.myshopify.com";

export default async function handler(req, res) {
  try {
    const { customize_no, variant_id } = req.query;

    // Validate required params
    if (!customize_no) {
      return res.status(400).json({ error: "Missing customize_no" });
    }

    if (!variant_id) {
      return res.status(400).json({ error: "Missing variant_id" });
    }

    // 1. Fetch Wooacry customization details (via our proxy)
    const infoResponse = await fetch(
      "https://ch-repository.vercel.app/api/wooacry-customize-info",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customize_no })
      }
    );

    const info = await infoResponse.json();

    if (!info || !info.data) {
      return res.status(500).json({
        error: "Failed retrieving customize info",
        details: info
      });
    }

    const sku = info.data.sku;
    const mockups = info.data.render_images || [];

    // 2. Build the correct Shopify cart payload
    const payload = {
      items: [
        {
          id: Number(variant_id),   // MUST be Shopify variant ID
          quantity: 1,
          properties: {
            customize_no,
            custom_mockup: mockups[0] || "",
            custom_spu: info.data.spu?.name || "",
            custom_sku_name: sku?.name || ""
          }
        }
      ]
    };

    // 3. Send item into Shopify cart
    const cartResponse = await fetch(
      `https://${SHOPIFY_DOMAIN}/cart/add.js`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!cartResponse.ok) {
      const errText = await cartResponse.text();
      console.error("Shopify rejected cart item:", errText);
      return res.status(500).json({
        error: "Shopify cart/add.js rejected item",
        details: errText
      });
    }

    // 4. Redirect user into Shopify cart page
    return res.redirect(302, `https://${SHOPIFY_DOMAIN}/cart`);

  } catch (err) {
    console.error("store-customization ERROR:", err);
    return res.status(500).json({
      error: "Server failure in store-customization",
      details: err.message
    });
  }
}

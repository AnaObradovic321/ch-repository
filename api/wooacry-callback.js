export default async function handler(req, res) {
  const { customize_no, product_id, variant_id } = req.query;

  if (!customize_no) {
    return res.status(200).send("Callback OK: Waiting for customize_no");
  }

  // Add product to cart via Shopify AJAX API
  const shopifyCartAddUrl = "https://characterhub-merch-store.myshopify.com/cart/add.js";

  const body = JSON.stringify({
    id: variant_id,
    quantity: 1,
    properties: {
      customize_no
    }
  });

  const result = await fetch(shopifyCartAddUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  if (!result.ok) {
    const text = await result.text();
    console.error("Add to cart error:", text);
    return res.status(500).send("Failed to add product to cart");
  }

  return res.redirect(302, "/cart");
}

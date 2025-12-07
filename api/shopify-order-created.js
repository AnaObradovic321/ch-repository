export default async function handler(req, res) {
  try {
    const order = req.body;
    console.log("Shopify order received:", order);

    const third_party_order_sn = order.id.toString();
    const third_party_order_created_at = Math.floor(new Date(order.created_at).getTime() / 1000);

    const third_party_user = order.email || "guest";
    const addr = order.shipping_address;

    const baseAddress = {
      first_name: addr.first_name,
      last_name: addr.last_name,
      phone: addr.phone,
      province: addr.province,
      city: addr.city,
      post_code: addr.zip,
      address1: addr.address1,
      address2: addr.address2 ?? "",
      country_code: addr.country_code,
      tax_number: "" // TODO: add tax logic
    };

    // Extract SKUs
    let skus = order.line_items
      .filter(i => i.properties?.customize_no)
      .map(i => ({
        customize_no: i.properties.customize_no,
        count: i.quantity
      }));

    if (skus.length === 0)
      return res.status(200).json({ ok: true });

    // Build base URL
    const BASE = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    // Preorder
    const preorderResponse = await fetch(`${BASE}/api/wooacry-preorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        third_party_user,
        skus,
        address: baseAddress
      })
    }).then(r => r.json());

    const shipping_method_id =
      preorderResponse?.data?.shipping_methods?.[0]?.id;

    if (!shipping_method_id)
      return res.status(500).json({ error: "Wooacry returned no shipping method" });

    // Create order
    const createOrderResponse = await fetch(`${BASE}/api/wooacry-order-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        third_party_order_sn,
        third_party_order_created_at,
        third_party_user,
        shipping_method_id,
        skus,
        address: baseAddress
      })
    }).then(r => r.json());

    console.log("Wooacry final order:", createOrderResponse);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Order processing failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

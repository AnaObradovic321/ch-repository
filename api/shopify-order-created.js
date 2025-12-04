import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const order = req.body;

    console.log("Shopify order received:", order.id);

    // 1. Extract shipping address
    const shipping = order.shipping_address;
    if (!shipping) {
      console.error("No shipping address found");
      return res.status(400).json({ error: "Missing shipping address" });
    }

    const address = {
      first_name: shipping.first_name || "",
      last_name: shipping.last_name || "",
      phone: shipping.phone || "",
      country_code: shipping.country_code,
      province: shipping.province,
      city: shipping.city,
      address1: shipping.address1,
      address2: shipping.address2 || "",
      post_code: shipping.zip,
      tax_number: "" // optional for most countries
    };

    // 2. Extract customization numbers from Shopify line items
    const skus = [];

    for (const item of order.line_items) {
      const props = item.properties || [];

      const customizeNoProp = props.find(p => p.name === "customize_no");

      if (customizeNoProp) {
        skus.push({
          customize_no: customizeNoProp.value,
          count: item.quantity
        });
      }
    }

    if (skus.length === 0) {
      console.error("No customize_no found in order items.");
      return res.status(400).json({ error: "No customized products found" });
    }

    console.log("SKUS for Wooacry:", skus);

    // 3. Call Wooacry PREORDER API
    const preorderRes = await fetch(
      "https://ch-repository.vercel.app/api/wooacry-preorder",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          third_party_user: order.email,
          skus,
          address
        })
      }
    );

    const preorderData = await preorderRes.json();

    if (!preorderData?.data?.shipping_methods) {
      console.error("Preorder failed:", preorderData);
      return res.status(500).json({ error: "Wooacry preorder failed" });
    }

    const shippingMethod = preorderData.data.shipping_methods[0]; // pick 1st method automatically

    console.log("Selected shipping method:", shippingMethod);

    // 4. Create a Wooacry order
    const createRes = await fetch(
      "https://ch-repository.vercel.app/api/wooacry-order-create",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          third_party_order_sn: `shopify_${order.id}`,
          third_party_order_created_at: Math.floor(Date.now() / 1000),
          third_party_user: order.email,
          shipping_method_id: shippingMethod.id,
          skus,
          address
        })
      }
    );

    const createData = await createRes.json();

    console.log("Wooacry ORDER CREATED:", createData);

    return res.status(200).json({ ok: true, wooacry: createData });

  } catch (err) {
    console.error("Order pipeline error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
}

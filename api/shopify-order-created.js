import { createPreorder } from "./wooacry-preorder.js";
import { createOrder } from "./wooacry-order-create.js";

export default async function handler(req, res) {
  try {
    const order = req.body;
    console.log("Shopify order received:", order);

    // 1. Extract Shopify order number
    const third_party_order_sn = order.id.toString();
    const third_party_order_created_at = Math.floor(
      new Date(order.created_at).getTime() / 1000
    );

    // 2. Extract shipping address
    const addr = order.shipping_address;

    const address = {
      first_name: addr.first_name,
      last_name: addr.last_name,
      phone: addr.phone,
      province: addr.province,
      city: addr.city,
      post_code: addr.zip,
      address1: addr.address1,
      address2: addr.address2 || "",
      country_code: addr.country_code,
      tax_number: "" // NOT USED
    };

    // 3. Extract customized SKUs
    let skus = [];

    for (const item of order.line_items) {
      const customizeNo = item.properties?.find(
        p => p.name === "customize_no"
      )?.value;

      if (!customizeNo) continue;

      skus.push({
        customize_no: customizeNo,
        count: item.quantity
      });
    }

    if (skus.length === 0) {
      console.log("No custom products in this order. Ignoring.");
      return res.status(200).json({ ok: true });
    }

    // 4. Run PRE-ORDER call first (needed to get shipping options)
    const preorderResponse = await createPreorder({
      third_party_user: "characterhub_user",
      address,
      skus
    });

    const shipping_method_id =
      preorderResponse?.data?.shipping_methods?.[0]?.id;

    if (!shipping_method_id) {
      console.error("No shipping method returned by Wooacry.");
      return res.status(500).json({ error: "Wooacry returned no shipping." });
    }

    // 5. Create final order in Wooacry
    const orderCreateResponse = await createOrder({
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user: "characterhub_user",
      shipping_method_id,
      skus,
      address
    });

    console.log("Wooacry final order created:", orderCreateResponse);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Order processing failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

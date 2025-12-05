// api/shopify-order-created.js

import createPreorder from "./wooacry-preorder.js";
import createOrder from "./wooacry-order-create.js";

export default async function handler(req, res) {
  try {
    const order = req.body;
    console.log("Shopify order received:", order);

    const third_party_order_sn = order.id.toString();
    const third_party_order_created_at = Math.floor(
      new Date(order.created_at).getTime() / 1000
    );

    // Use buyer email as third_party_user
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
      address2: addr.address2 || "",
      country_code: addr.country_code,
      tax_number: "" // dynamic later
    };

    // STEP 1 extract SKUs correctly
    let skus = [];

    for (const item of order.line_items) {
      const customizeNo = item.properties?.customize_no;
      if (!customizeNo) continue;

      skus.push({
        customize_no: customizeNo,
        count: item.quantity
      });
    }

    if (skus.length === 0) {
      console.log("No customization found, no Wooacry call needed.");
      return res.status(200).json({ ok: true });
    }

    // For now: only 1 SKU is supported by Wooacry
    const singleSKU = skus[0];

    // STEP 2: Preorder
    const preorderRequest = {
      third_party_user,
      customize_no: singleSKU.customize_no,
      count: singleSKU.count,
      address: baseAddress
    };

    const preorderResponse = await createPreorder(preorderRequest);

    const shipping_method_id =
      preorderResponse?.data?.shipping_methods?.[0]?.id;

    if (!shipping_method_id) {
      console.error("Wooacry returned no shipping method.");
      return res.status(500).json({ error: "No shipping from Wooacry" });
    }

    // STEP 3: Final Wooacry Order
    const createOrderRequest = {
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus: [singleSKU],
      address: baseAddress
    };

    const orderCreateResponse = await createOrder(createOrderRequest);

    console.log("Wooacry final order created:", orderCreateResponse);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Order processing failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

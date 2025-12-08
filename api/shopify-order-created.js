// api/shopify-order-created.js

import { validateWooacryAddress } from "./wooacry-utils.js";

export default async function handler(req, res) {
  try {
    const order = req.body;
    console.log("Shopify order received:", order);

    const third_party_order_sn = order.id.toString();
    const third_party_order_created_at = Math.floor(
      new Date(order.created_at).getTime() / 1000
    );

    const third_party_user = order.email || "guest";
    const addr = order.shipping_address;

    if (!addr) {
      return res.status(400).json({
        error: "Missing shipping address in Shopify order"
      });
    }

    /* ----------------------------------------------------
       STEP 1: Normalize Shopify → Wooacry address
       Guarantee the structure produces stable JSON
       ---------------------------------------------------- */
    const normalizedAddress = validateWooacryAddress({
      first_name: addr.first_name ?? "",
      last_name: addr.last_name ?? "",
      phone: addr.phone ?? "",
      country_code: addr.country_code ?? "",
      province: addr.province ?? "",
      city: addr.city ?? "",
      address1: addr.address1 ?? "",
      address2: addr.address2 ?? "",
      post_code: addr.zip ?? "",
      tax_number: addr.tax_number ?? ""
    });

    /* ----------------------------------------------------
       STEP 2: Build SKUs for Wooacry
       Must be stable and clean
       ---------------------------------------------------- */
    const skus = order.line_items
      .filter((i) => i.properties?.customize_no)
      .map((i) => ({
        customize_no: String(i.properties.customize_no),
        count: Number(i.quantity)
      }));

    if (skus.length === 0) {
      console.log("Order contains no Wooacry custom items. Skipping.");
      return res.status(200).json({ ok: true });
    }

    /* ----------------------------------------------------
       STEP 3: Internal API base URL
       ---------------------------------------------------- */
    const BASE = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    /* ----------------------------------------------------
       STEP 4: PREORDER REQUEST
       MUST pass stable JSON to Wooacry
       ---------------------------------------------------- */
    const preorderBody = {
      third_party_user,
      skus,
      address: normalizedAddress
    };

    console.log("Sending preorder to Wooacry…");

    const preorderResponse = await fetch(`${BASE}/api/wooacry-preorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },

      // Fix #5: Shopify → Wooacry must use the exact JSON structure
      body: JSON.stringify(preorderBody)
    }).then((r) => r.json());

    console.log("Wooacry Preorder Result:", preorderResponse);

    const shipping_method_id =
      preorderResponse?.data?.shipping_methods?.[0]?.id;

    if (!shipping_method_id) {
      return res.status(500).json({
        error: "Wooacry returned no shipping methods",
        details: preorderResponse
      });
    }

    /* ----------------------------------------------------
       STEP 5: CREATE ORDER REQUEST
       MUST also pass stable JSON
       ---------------------------------------------------- */
    const createOrderBody = {
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus,
      address: normalizedAddress
    };

    console.log("Creating Wooacry order…");

    const createOrderResponse = await fetch(`${BASE}/api/wooacry-order-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },

      // Fix #5 applied again
      body: JSON.stringify(createOrderBody)
    }).then((r) => r.json());

    console.log("Wooacry Final Order Result:", createOrderResponse);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("Shopify → Wooacry Order Pipeline ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

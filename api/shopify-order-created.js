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
      return res.status(400).json({ error: "Missing shipping address in Shopify order" });
    }

    /**
     * Build Wooacry-compliant address.
     * All fields are required by Wooacry; tax_number is validated downstream.
     */
const baseAddress = {
  first_name: addr.first_name,
  last_name: addr.last_name,
  phone: addr.phone,
  province: addr.province,
  city: addr.city,
  post_code: addr.zip,
  address1: addr.address1,
  address2: addr.address2 ?? "",
  country_code: addr.country_code?.toUpperCase(), 
  tax_number: addr.tax_number ?? ""
};

    /**
     * Extract SKUs containing customize_no.
     * This ensures only Wooacry-customized products enter preorder/create-order pipeline.
     */
    const skus = order.line_items
      .filter((i) => i.properties?.customize_no)
      .map((i) => ({
        customize_no: i.properties.customize_no,
        count: i.quantity
      }));

    if (skus.length === 0) {
      console.log("Order contains no Wooacry custom items. Skipping.");
      return res.status(200).json({ ok: true });
    }

    /**
     * Determine base URL for internal API calls.
     * Allows local dev vs Vercel production environments.
     */
    const BASE = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    // STEP 1: PREORDER
    console.log("Sending preorder to Wooacry…");

    const preorderResponse = await fetch(`${BASE}/api/wooacry-preorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        third_party_user,
        skus,
        address: baseAddress
      })
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

    // STEP 2: CREATE ORDER
    console.log("Creating Wooacry order…");

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
    }).then((r) => r.json());

    console.log("Wooacry Final Order Result:", createOrderResponse);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Shopify → Wooacry Order Pipeline ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

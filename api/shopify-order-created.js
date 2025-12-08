import { validateWooacryAddress } from "./wooacry-utils.js";

export default async function handler(req, res) {
  try {
    const order = req.body;
    console.log("Shopify order received:", order.id);

    const third_party_order_sn = String(order.id);
    const third_party_order_created_at = Math.floor(new Date(order.created_at).getTime() / 1000);
    const third_party_user = order.email || "guest";
    const addr = order.shipping_address;

    if (!addr) {
      console.log("No shipping address, skipping.");
      return res.status(200).json({ ok: true });
    }

    // 1. Extract only Wooacry custom items
    const skus = order.line_items
      .filter(i => i.properties && i.properties.customize_no)
      .map(i => ({
        customize_no: String(i.properties.customize_no),
        count: parseInt(i.quantity, 10) || 1
      }));

    if (skus.length === 0) {
      console.log("No Wooacry custom items.");
      return res.status(200).json({ ok: true });
    }

    // 2. Normalize address
    let normalizedAddress = validateWooacryAddress({
      first_name: addr.first_name || "",
      last_name: addr.last_name || "",
      phone: addr.phone || "",
      country_code: (addr.country_code || "").toUpperCase(),
      province: addr.province || "",
      city: addr.city || "",
      address1: addr.address1 || "",
      address2: addr.address2 || "",
      post_code: addr.zip || "",
      tax_number: addr.tax_number || ""
    });

    // Force body fields to correct types for Wooacry signature rules
    Object.keys(normalizedAddress).forEach(k => {
      if (typeof normalizedAddress[k] !== "string") {
        normalizedAddress[k] = String(normalizedAddress[k] || "");
      }
    });

    // 3. Tax number enforcement for mandatory countries
    const requiresTaxID = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];
    if (requiresTaxID.includes(normalizedAddress.country_code) && !normalizedAddress.tax_number) {
      return res.status(400).json({
        error: "Missing required tax_number for destination country",
        country: normalizedAddress.country_code
      });
    }

    // 4. Internal endpoint base URL
    const host = req.headers.host;
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const BASE = `${protocol}://${host}`;

    // 5. PREORDER
    const preorderResponse = await fetch(`${BASE}/api/wooacry-preorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        third_party_user,
        skus,
        address: normalizedAddress
      })
    }).then(r => r.json());

    if (
      !preorderResponse ||
      !preorderResponse.data ||
      !Array.isArray(preorderResponse.data.shipping_methods) ||
      preorderResponse.data.shipping_methods.length === 0
    ) {
      console.error("Wooacry Preorder error:", preorderResponse);
      return res.status(500).json({ error: "Preorder failed", details: preorderResponse });
    }

    const shipping_method_id = preorderResponse.data.shipping_methods[0].id;

    // 6. CREATE ORDER
    const createOrderResponse = await fetch(`${BASE}/api/wooacry-order-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        third_party_order_sn,
        third_party_order_created_at,
        third_party_user,
        shipping_method_id,
        skus,
        address: normalizedAddress
      })
    }).then(r => r.json());

    console.log("Wooacry Final Order:", createOrderResponse);

    if (createOrderResponse.code !== 0) {
      return res.status(500).json({
        error: "Wooacry Create Order Error",
        details: createOrderResponse
      });
    }

    return res.status(200).json({
      ok: true,
      wooacry_sn: createOrderResponse.data.order_sn
    });

  } catch (err) {
    console.error("Pipeline Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

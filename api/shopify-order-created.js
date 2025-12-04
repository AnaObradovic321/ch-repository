import crypto from "crypto";

const SECRET = process.env.WOOACRY_SECRET;
const FLAG = process.env.WOOACRY_RESELLER_FLAG;

// Helper to generate MD5 signature
function generateSignature(body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const version = 1;

  const signatureString =
    FLAG + "\n" +
    timestamp + "\n" +
    version + "\n" +
    JSON.stringify(body) + "\n" +
    SECRET + "\n";

  const sign = crypto.createHash("md5").update(signatureString).digest("hex");

  return { sign, timestamp };
}

export default async function handler(req, res) {
  try {
    const shopifyOrder = req.body;
    console.log("Shopify order received:", shopifyOrder);

    // 1. Extract customize_no from line items
    const skus = [];

    for (const item of shopifyOrder.line_items) {
      if (item.properties && item.properties.find(p => p.name === "customize_no")) {
        const customizeProp = item.properties.find(p => p.name === "customize_no");
        skus.push({
          customize_no: customizeProp.value,
          count: item.quantity
        });
      }
    }

    if (skus.length === 0) {
      console.log("No customize_no found in order — skipping Wooacry");
      return res.status(200).json({ ok: true });
    }

    // 2. Build user shipping address from Shopify
    const address = shopifyOrder.shipping_address;

    const wooAddress = {
      first_name: address.first_name || "",
      last_name: address.last_name || "",
      phone: address.phone || "",
      country_code: address.country_code,
      province: address.province || "",
      city: address.city || "",
      address1: address.address1 || "",
      address2: address.address2 || "",
      post_code: address.zip,
      tax_number: "" // optional
    };

    // 3. Pre-order step (get shipping method)
    const preOrderBody = {
      skus,
      address: wooAddress,
      third_party_user: shopifyOrder.customer?.id?.toString() || "unknown"
    };

    const { sign: preSign, timestamp: preTs } = generateSignature(preOrderBody);

    const preResp = await fetch("https://api-new.wooacry.com/api/reseller/open/order/create/pre", {
      method: "POST",
      headers: {
        "Sign": preSign,
        "Reseller-Flag": FLAG,
        "Timestamp": preTs,
        "Version": "1",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preOrderBody)
    });

    const preData = await preResp.json();
    console.log("Pre-order response:", preData);

    if (preData.code !== 0) {
      throw new Error("Wooacry pre-order failed: " + preData.message);
    }

    const shippingMethodId = preData.data.shipping_methods[0].id;

    // 4. Create the actual Wooacry production order
    const finalOrderBody = {
      third_party_order_sn: shopifyOrder.id.toString(),
      third_party_order_created_at: Math.floor(new Date(shopifyOrder.created_at).getTime() / 1000),
      third_party_user: shopifyOrder.customer?.id?.toString() || "unknown",
      shipping_method_id: shippingMethodId,
      skus,
      address: wooAddress
    };

    const { sign: orderSign, timestamp: orderTs } = generateSignature(finalOrderBody);

    const orderResp = await fetch("https://api-new.wooacry.com/api/reseller/open/order/create", {
      method: "POST",
      headers: {
        "Sign": orderSign,
        "Reseller-Flag": FLAG,
        "Timestamp": orderTs,
        "Version": "1",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(finalOrderBody)
    });

    const orderData = await orderResp.json();
    console.log("Order created:", orderData);

    return res.status(200).json({ ok: true, wooacry: orderData });

  } catch (err) {
    console.error("Error inside shopify-order-created:", err);
    return res.status(500).json({ error: err.message });
  }
}

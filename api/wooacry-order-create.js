import { buildHeaders } from "./wooacry-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus,
      address
    } = req.body;

    if (!third_party_order_sn || !shipping_method_id || !skus || !address) {
      return res.status(400).json({
        error:
          "Missing required fields: third_party_order_sn, shipping_method_id, skus, address"
      });
    }

    const body = {
      third_party_order_sn,
      third_party_order_created_at:
        third_party_order_created_at || Math.floor(Date.now() / 1000),
      third_party_user: third_party_user || "characterhub_user",
      shipping_method_id,

      skus,

      address
    };

    const wooacryResponse = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create",
      {
        method: "POST",
        headers: buildHeaders(body),
        body: JSON.stringify(body)
      }
    );

    const result = await wooacryResponse.json();
    console.log("Wooacry Order Create Response:", result);

    return res.status(200).json(result);
  } catch (err) {
    console.error("Wooacry Order Create ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

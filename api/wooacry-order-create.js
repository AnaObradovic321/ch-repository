// api/wooacry-order-create.js
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

    // Validate required fields
    if (
      !third_party_order_sn ||
      !third_party_order_created_at ||
      !third_party_user ||
      !shipping_method_id ||
      !skus ||
      !Array.isArray(skus) ||
      skus.length === 0 ||
      !address
    ) {
      return res.status(400).json({
        error: "Missing required fields for Wooacry order-create"
      });
    }

    // Transform Shopify address → Wooacry address
const wooacryAddress = {
  first_name: address.first_name,
  last_name: address.last_name,
  phone: address.phone,
  country_code: address.country_code,
  province: address.province,
  city: address.city,
  address1: address.address1,
  address2: address.address2 || "",
  post_code: address.post_code,
  tax_number: address.tax_number || ""
};

    const body = {
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus,
      address: wooacryAddress
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

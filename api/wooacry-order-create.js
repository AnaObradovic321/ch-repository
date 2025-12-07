import { buildHeaders } from "./wooacry-utils.js";

/**
 * Fetches Wooacry customize info so we can enrich SKUs
 */
async function fetchCustomizeInfo(customize_no) {
  const response = await fetch(
    "https://api-new.wooacry.com/api/reseller/open/customize/info",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customize_no })
    }
  );

  const json = await response.json();
  if (!json || !json.data) {
    throw new Error("Failed to retrieve customize info from Wooacry");
  }

  return json.data;
}

/**
 * Tax number enforcement according to Wooacry documentation
 */
function validateTaxNumber(country_code, tax_number) {
  const mustHaveTax = [
    "TR", // Turkey
    "MX", // Mexico
    "CL", // Chile
    "BR", // Brazil
    "ZA", // South Africa
    "KR", // Korea
    "AR"  // Argentina
  ];

  if (mustHaveTax.includes(country_code.toUpperCase())) {
    if (!tax_number || tax_number.trim() === "") {
      throw new Error(`Missing required tax_number for ${country_code}`);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const {
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus,
      address
    } = req.body;

    if (
      !third_party_order_sn ||
      !third_party_order_created_at ||
      !third_party_user ||
      !shipping_method_id ||
      !Array.isArray(skus) ||
      skus.length === 0 ||
      !address
    ) {
      return res.status(400).json({
        error: "Missing required fields for Wooacry order-create"
      });
    }

    // Validate tax number rules
    validateTaxNumber(address.country_code, address.tax_number);

    // Convert address to Wooacry's required format
    const wooacryAddress = {
      first_name: address.first_name,
      last_name: address.last_name,
      phone: address.phone,
      country_code: address.country_code,
      province: address.province,
      city: address.city,
      address1: address.address1,
      address2: address.address2 ?? "",
      post_code: address.post_code,
      tax_number: address.tax_number ?? ""
    };

    /**
     * Build enriched SKUs:
     * Wooacry requires:
     *  - customize_no
     *  - count
     *  - unit_sale_price
     *  - unit_package_price
     */
    const enrichedSKUs = [];

    for (const sku of skus) {
      const customizeData = await fetchCustomizeInfo(sku.customize_no);

      enrichedSKUs.push({
        customize_no: sku.customize_no,
        count: sku.count,
        unit_sale_price: customizeData.sku.sale_price,
        unit_package_price: customizeData.sku.package_price
      });
    }

    // Build body exactly as Wooacry expects
    const body = {
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus: enrichedSKUs,
      address: wooacryAddress
    };

    const raw = JSON.stringify(body);

    const response = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create",
      {
        method: "POST",
        headers: buildHeaders(raw),
        body: raw
      }
    );

    const result = await response.json();
    console.log("Wooacry Final Order Response:", result);

    return res.status(200).json(result);

  } catch (err) {
    console.error("Wooacry Order Create ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

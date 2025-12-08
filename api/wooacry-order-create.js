import { buildHeaders } from "./wooacry-utils.js";

/**
 * Signed Wooacry customize/info fetch
 */
async function fetchCustomizeInfo(customize_no) {
  const body = { customize_no };
  const raw = JSON.stringify(body);

  const response = await fetch(
    "https://api-new.wooacry.com/api/reseller/open/customize/info",
    {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    }
  );

  const json = await response.json();

  if (!json || !json.data) {
    throw new Error("Failed to retrieve customize info from Wooacry");
  }

  return json.data;
}

/**
 * Validate mandatory tax field
 */
function validateTaxNumber(country_code, tax_number) {
  const mustHaveTax = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];
  const cc = (country_code || "").toUpperCase();

  if (mustHaveTax.includes(cc)) {
    if (!tax_number || tax_number.trim() === "") {
      throw new Error(`Missing required tax_number for ${cc}`);
    }
  }
}

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

    // Validate tax number
    validateTaxNumber(address.country_code, address.tax_number);

    // Normalize address for Wooacry
    const wooacryAddress = {
      first_name: address.first_name ?? "",
      last_name: address.last_name ?? "",
      phone: address.phone ?? "",
      country_code: (address.country_code || "").toUpperCase(),
      province: address.province ?? "",
      city: address.city ?? "",
      address1: address.address1 ?? "",
      address2: address.address2 ?? "",
      post_code: address.post_code ?? "",
      tax_number: address.tax_number ?? ""
    };

    // Cache customize info to avoid multiple external calls
    const customizeCache = {};

    async function getCustomize(no) {
      if (!customizeCache[no]) {
        customizeCache[no] = await fetchCustomizeInfo(no);
      }
      return customizeCache[no];
    }

    // Build enriched SKUs
    const enrichedSKUs = [];

    for (const sku of skus) {
      const customizeData = await getCustomize(sku.customize_no);

      enrichedSKUs.push({
        customize_no: sku.customize_no,
        count: sku.count,
        unit_sale_price: customizeData.sku.sale_price,
        unit_package_price: customizeData.sku.package_price
      });
    }

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

// /pages/api/wooacry-address-change.js
import { buildHeaders, validateWooacryAddress } from "./wooacry-utils.js";

// Mandatory tax number rules by country (Wooacry requirement)
function validateTaxNumber(country_code, tax_number) {
  const mustHaveTax = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];
  const cc = (country_code || "").toUpperCase();

  if (mustHaveTax.includes(cc)) {
    if (!tax_number || String(tax_number).trim() === "") {
      throw new Error(`Missing required tax_number for ${cc}`);
    }
  }
}

export default async function handler(req, res) {
  // Wooacry wants POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed. Use POST." });
  }

  try {
    const third_party_order_sn =
      req.body?.third_party_order_sn ||
      req.body?.order_id ||
      req.body?.shopify_order_id;

    const address = req.body?.address;

    if (!third_party_order_sn || String(third_party_order_sn).trim() === "") {
      return res.status(400).json({
        error: "Missing third_party_order_sn (your Shopify order id)."
      });
    }

    if (!address || typeof address !== "object") {
      return res.status(400).json({
        error: "Missing address object."
      });
    }

    // Normalize address into the shape Wooacry expects
    const wooacryAddress = validateWooacryAddress(address);

    // Enforce Wooacry tax number rules for certain countries
    validateTaxNumber(wooacryAddress.country_code, wooacryAddress.tax_number);

    const body = {
      third_party_order_sn: String(third_party_order_sn).trim(),
      address: wooacryAddress
    };

    const raw = JSON.stringify(body);

    const wooResp = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/address/change",
      {
        method: "POST",
        headers: buildHeaders(raw),
        body: raw
      }
    );

    const text = await wooResp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON",
        wooacry_http_status: wooResp.status,
        body_preview: text.slice(0, 500)
      });
    }

    return res.status(200).json({
      ok: json?.code === 0,
      wooacry_http_status: wooResp.status,
      request: body,
      response: json
    });
  } catch (err) {
    console.error("Wooacry Address Change ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

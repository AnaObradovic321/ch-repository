import { buildHeaders } from "./wooacry-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { third_party_user, skus, address } = req.body;

    // Validate required fields
    if (!third_party_user)
      return res.status(400).json({ error: "Missing third_party_user" });

    if (!Array.isArray(skus) || skus.length === 0)
      return res.status(400).json({ error: "Invalid or missing skus" });

    if (!address)
      return res.status(400).json({ error: "Missing address" });

    /**
     * Wooacry Preorder expected request body:
     * {
     *   "third_party_user": "string",
     *   "skus": [
     *      { "customize_no": "string", "count": 0 }
     *   ],
     *   "address": {
     *      first_name, last_name, phone, country_code,
     *      province, city, address1, address2, post_code, tax_number
     *   }
     * }
     */

    const body = { third_party_user, skus, address };
    const raw = JSON.stringify(body);

    const response = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create/pre",
      {
        method: "POST",
        headers: buildHeaders(raw), // 100% correct signature generation
        body: raw                   // Must match signature exactly
      }
    );

    const result = await response.json();
    console.log("Wooacry Preorder Response:", result);

    return res.status(200).json(result);

  } catch (err) {
    console.error("Preorder Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

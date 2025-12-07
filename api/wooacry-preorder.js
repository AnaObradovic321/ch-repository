// api/wooacry-preorder.js
import { buildHeaders } from "./wooacry-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { third_party_user, skus, address } = req.body;

    if (!third_party_user) {
      return res.status(400).json({ error: "Missing third_party_user" });
    }

    if (!skus || !Array.isArray(skus) || skus.length === 0) {
      return res.status(400).json({ error: "Invalid or missing skus[]" });
    }

    if (!address) {
      return res.status(400).json({ error: "Missing address" });
    }

    // EXACT Wooacry structure
    const body = {
      third_party_user,
      skus,
      address
    };

    const response = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create/pre",
      {
        method: "POST",
        headers: buildHeaders(body),
        body: JSON.stringify(body)
      }
    );

    const result = await response.json();
    console.log("Wooacry Pre-order Response:", result);

    return res.status(200).json(result);
  } catch (err) {
    console.error("Preorder Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

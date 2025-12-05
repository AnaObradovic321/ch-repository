// api/wooacry-preorder.js
import { buildHeaders } from "./wooacry-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { skus, address, third_party_user } = req.body;

    // Validate skus[] array
    if (!skus || !Array.isArray(skus) || skus.length === 0) {
      return res.status(400).json({
        error: "Missing or invalid skus array"
      });
    }

    if (!address) {
      return res.status(400).json({
        error: "Missing address"
      });
    }

    // Build Wooacry preorder body EXACTLY per API
    const body = {
      third_party_user: third_party_user || "characterhub_user",
      skus,      // ← ✔ Direct pass-through
      address    // ← ✔ Matches API schema
    };

    const wooacryResponse = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create/pre",
      {
        method: "POST",
        headers: buildHeaders(body),
        body: JSON.stringify(body)
      }
    );

    const result = await wooacryResponse.json();

    console.log("Wooacry Preorder Response:", result);

    return res.status(200).json(result);
  } catch (e) {
    console.error("Preorder Error:", e);
    return res.status(500).json({ error: e.message });
  }
}

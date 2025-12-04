import { buildHeaders } from "./wooacry-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { customize_no, count, address, third_party_user } = req.body;

    if (!customize_no || !count || !address) {
      return res.status(400).json({
        error: "Missing required fields: customize_no, count, address"
      });
    }

    const body = {
      third_party_user: third_party_user || "characterhub_user",
      skus: [
        {
          customize_no,
          count
        }
      ],
      address
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

import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const API_URL = "https://api-new.wooacry.com/api/reseller/open/order/create/pre";

export default async function handler(req, res) {
  try {
    const { skus, address, third_party_user } = req.body;

    if (!skus || !Array.isArray(skus)) {
      return res.status(400).json({ error: "Missing or invalid skus array" });
    }

    if (!address) {
      return res.status(400).json({ error: "Missing address" });
    }

    if (!third_party_user) {
      return res.status(400).json({ error: "Missing third_party_user" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const version = "1";

    const body = JSON.stringify({
      skus,
      address,
      third_party_user
    });

    // Construct signature string
    const sigString = 
      `${RESELLER_FLAG}\n${timestamp}\n${version}\n${body}\n${SECRET}\n`;

    const sign = crypto.createHash("md5").update(sigString).digest("hex");

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Sign": sign,
        "Reseller-Flag": RESELLER_FLAG,
        "Timestamp": timestamp,
        "Version": version,
        "Content-Type": "application/json"
      },
      body
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error", details: e.message });
  }
}

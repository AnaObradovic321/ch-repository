import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const API_URL = "https://api-new.wooacry.com/api/reseller/open/customize/info";

export default async function handler(req, res) {
  try {
    const { customize_no } = req.body;
    if (!customize_no) return res.status(400).json({ error: "Missing customize_no" });

    const timestamp = Math.floor(Date.now() / 1000);
    const version = "1";
    const body = JSON.stringify({ customize_no });

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

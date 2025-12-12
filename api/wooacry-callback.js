import crypto from "crypto";

const SHOPIFY_STORE = "characterhub-merch-store";

export default async function handler(req, res) {
  const { customize_no } = req.query;

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  try {
    // 1. CALL WOOACRY customize/info
    const bodyJSON = JSON.stringify({ customize_no });
    const timestamp = Math.floor(Date.now() / 1000);

    const signatureString =
      `characterhub\n${timestamp}\n1\n${bodyJSON}\n3710d71b1608f78948a60602c4a6d9d8\n`;

    const sign = crypto.createHash("md5").update(signatureString).digest("hex");

    const infoResp = await fetch("https://api-new.wooacry.com/api/reseller/open/customize/info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Reseller-Flag": "characterhub",
        "Timestamp": timestamp,
        "Version": "1",
        "Sign": sign
      },
      body: bodyJSON
    });

    const info = await infoResp.json();

    if (!info || info.code !== 0) {
      return res.status(500).json({ error: "Wooacry customize/info failed", info });
    }

    const mockups = info.data.render_images || [];

    // 2. SEND ALL MOCKUPS AS CART LINE ITEM PROPERTIES
    // Shopify will store these automatically on the order.
    const props = encodeURIComponent(JSON.stringify(mockups));

    const redirectUrl =
      `https://${SHOPIFY_STORE}.myshopify.com/cart?` +
      `properties[customize_no]=${customize_no}` +
      `&properties[mockups]=${props}`;

    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("CALLBACK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

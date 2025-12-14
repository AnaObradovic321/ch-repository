import crypto from "crypto";

const RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "characterhub";
const SECRET = process.env.WOOACRY_SECRET || "3710d71b1608f78948a60602c4a6d9d8";
const VERSION = process.env.WOOACRY_VERSION || "1";
const SHOP = process.env.SHOPIFY_SHOP_HANDLE || "characterhub-merch-store";

function signRequest(bodyString, timestamp) {
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${VERSION}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const { customize_no, variant_id, debug } = req.query;

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  if (!variant_id) {
    return res.status(400).json({
      error: "Missing variant_id",
      how_to_fix:
        "wooacry-customize-init must build redirect_url like /api/wooacry-callback?variant_id=SHOPIFY_VARIANT_ID"
    });
  }

  try {
    // 1) Call Wooacry customize/info to get mockups
    const bodyJSON = JSON.stringify({ customize_no: String(customize_no) });
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signRequest(bodyJSON, timestamp);

    const infoResp = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/customize/info",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Reseller-Flag": RESELLER_FLAG,
          "Timestamp": String(timestamp),
          "Version": VERSION,
          "Sign": sign
        },
        body: bodyJSON
      }
    );

    const text = await infoResp.text();
    let info;
    try {
      info = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for customize/info",
        wooacry_http_status: infoResp.status,
        body_preview: text.slice(0, 500)
      });
    }

    if (!info || info.code !== 0) {
      return res.status(500).json({
        error: "Wooacry customize/info failed",
        wooacry_http_status: infoResp.status,
        details: info
      });
    }

    const mockups = info?.data?.render_images || [];
    const m1 = mockups[0] || "";
    const m2 = mockups[1] || "";

    // Debug mode to verify what we received without redirecting
    if (String(debug) === "1") {
      return res.status(200).json({
        ok: true,
        customize_no: String(customize_no),
        variant_id: String(variant_id),
        mockups_count: mockups.length,
        mockups_preview: mockups.slice(0, 2)
      });
    }

    // 2) Use Shopify /cart/add (NOT /cart/<variant>:1) and only include non-empty properties
    const params = new URLSearchParams();
    params.set("id", String(variant_id));
    params.set("quantity", "1");
    params.set("properties[customize_no]", String(customize_no));

    if (m1) params.set("properties[mockup_1]", m1);
    if (m2) params.set("properties[mockup_2]", m2);

    const addUrl = `https://${SHOP}.myshopify.com/cart/add?${params.toString()}`;

    console.log("[wooacry-callback] Redirecting to Shopify cart/add:", addUrl);

    return res.redirect(302, addUrl);
  } catch (err) {
    console.error("WOOACRY CALLBACK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

import crypto from "crypto";

// ------------------------------------------------------------
// CONFIG
// Best practice: use environment variables.
// Fallbacks are included so it still works if you paste it as-is.
// ------------------------------------------------------------
const RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "characterhub";
const SECRET = process.env.WOOACRY_SECRET || "3710d71b1608f78948a60602c4a6d9d8";
const VERSION = process.env.WOOACRY_VERSION || "1";
const SHOP = process.env.SHOPIFY_SHOP_HANDLE || "characterhub-merch-store"; // just the handle, no .myshopify.com

// ------------------------------------------------------------
// Signature builder for Wooacry OPEN API calls
// IMPORTANT: bodyString must be EXACTLY what you send as body.
// ------------------------------------------------------------
function signRequest(bodyString, timestamp) {
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${VERSION}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

// ------------------------------------------------------------
// Main Callback Handler
// ------------------------------------------------------------
export default async function handler(req, res) {
  const { customize_no, variant_id } = req.query;

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  // This is the key change: do NOT rely on Wooacry SPU IDs.
  // We need the Shopify variant_id to be passed into this callback URL.
  if (!variant_id) {
    return res.status(400).json({
      error: "Missing variant_id",
      how_to_fix:
        "When you build the Wooacry redirect_url in wooacry-customize-init, append ?variant_id=YOUR_SHOPIFY_VARIANT_ID to the callback URL."
    });
  }

  try {
    // ----------------------------------------------------------
    // STEP 1: Call Wooacry customize/info to get mockups
    // ----------------------------------------------------------
    const bodyObj = { customize_no: String(customize_no) };
    const bodyJSON = JSON.stringify(bodyObj);

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

    // Parse safely (Wooacry sometimes returns non-JSON on errors)
    const text = await infoResp.text();
    let info;
    try {
      info = JSON.parse(text);
    } catch (e) {
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

    // Extract mockups
    const mockups = info?.data?.render_images || [];

    // ----------------------------------------------------------
    // STEP 2: Redirect user to Shopify cart with properties
    // ----------------------------------------------------------
    const safeVariantId = String(variant_id);

    // Shopify line item properties must be in the URL query
    const encodedMockups = encodeURIComponent(JSON.stringify(mockups));

    const redirectUrl =
      `https://${SHOP}.myshopify.com/cart/${safeVariantId}:1` +
      `?properties[customize_no]=${encodeURIComponent(String(customize_no))}` +
      `&properties[mockups]=${encodedMockups}`;

    console.log("[REDIRECT TO SHOPIFY CART]:", redirectUrl);

    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("WOOACRY CALLBACK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const VERSION = "1";
const SHOP = "characterhub-merch-store";

// -----------------------------------------------------------------------------------
// 1. SPU → Shopify Variant mapping
// Add more products here as you onboard them.
// -----------------------------------------------------------------------------------
const SPU_TO_VARIANT = {
  "453": "42832621797489"   // Poster → variant ID
};

// -----------------------------------------------------------------------------------
// 2. Signature builder
// -----------------------------------------------------------------------------------
function signRequest(bodyString, timestamp) {
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${VERSION}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

// -----------------------------------------------------------------------------------
// 3. Main Callback Handler
// -----------------------------------------------------------------------------------
export default async function handler(req, res) {
  const { customize_no } = req.query;

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  try {
    // ------------------------------------------------------------------
    // STEP 1: Call Wooacry customize/info to get SPU + mockups
    // ------------------------------------------------------------------
    const bodyJSON = JSON.stringify({ customize_no });
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

    const info = await infoResp.json();

    if (!info || info.code !== 0) {
      return res.status(500).json({
        error: "Wooacry customize/info failed",
        details: info
      });
    }

    // Extract SPU & mockups
    const spuId = String(info.data.spu.id);
    const mockups = info.data.render_images || [];

    // ------------------------------------------------------------------
    // STEP 2: Map SPU → SHOPIFY VARIANT
    // ------------------------------------------------------------------
    const variantId = SPU_TO_VARIANT[spuId];

    if (!variantId) {
      return res.status(500).json({
        error: "Missing SPU → Variant mapping",
        missing_spu: spuId
      });
    }

    // ------------------------------------------------------------------
    // STEP 3: Prepare properties for Shopify
    // ------------------------------------------------------------------
    const encodedMockups = encodeURIComponent(JSON.stringify(mockups));

    const redirectUrl =
      `https://${SHOP}.myshopify.com/cart/${variantId}:1` +
      `?properties[customize_no]=${customize_no}` +
      `&properties[mockups]=${encodedMockups}`;

    console.log("[REDIRECT TO SHOPIFY CART]:", redirectUrl);

    return res.redirect(302, redirectUrl);

  } catch (err) {
    console.error("WOOACRY CALLBACK ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

import crypto from "crypto";

const RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "characterhub";
const SECRET = process.env.WOOACRY_SECRET || "3710d71b1608f78948a60602c4a6d9d8";
const VERSION = process.env.WOOACRY_VERSION || "1";
const SHOP = process.env.SHOPIFY_SHOP_HANDLE || "characterhub-merch-store";

const BUILD_ID = "wooacry-callback-2025-12-14-v1";

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
  // Prevent caching (helps avoid weird stale behavior)
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-CH-Build", BUILD_ID);

  const { customize_no, variant_id, debug } = req.query;

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no", build: BUILD_ID });
  }
  if (!variant_id) {
    return res.status(400).json({
      error: "Missing variant_id",
      build: BUILD_ID,
      how_to_fix:
        "Make sure api/wooacry-customize-init builds redirect_url like: /api/wooacry-callback?variant_id=YOUR_SHOPIFY_VARIANT_ID"
    });
  }

  try {
    // 1) Fetch customize info (for mockups)
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

    const text = await infoResp.text();
    let info;
    try {
      info = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for customize/info",
        build: BUILD_ID,
        wooacry_http_status: infoResp.status,
        body_preview: text.slice(0, 500)
      });
    }

    if (!info || info.code !== 0) {
      return res.status(500).json({
        error: "Wooacry customize/info failed",
        build: BUILD_ID,
        wooacry_http_status: infoResp.status,
        details: info
      });
    }

    const mockups = info?.data?.render_images || [];
    const spuId = info?.data?.spu?.id; // internal, can change
    const thirdPartSpu = info?.data?.spu?.third_part_spu; // partner-facing in their response shape

    // Debug mode: lets you confirm deployment without redirecting
    if (String(debug) === "1") {
      return res.status(200).json({
        ok: true,
        build: BUILD_ID,
        customize_no: String(customize_no),
        variant_id: String(variant_id),
        wooacry_spu_id: spuId,
        wooacry_third_part_spu: thirdPartSpu,
        mockups_count: mockups.length,
        mockups_preview: mockups.slice(0, 2)
      });
    }

    // 2) Redirect into Shopify cart using Shopify variant_id (NOT Wooacry spu.id)
    const safeVariantId = String(variant_id);
    const m1 = mockups[0] ? encodeURIComponent(mockups[0]) : "";
    const m2 = mockups[1] ? encodeURIComponent(mockups[1]) : "";

    const redirectUrl =
      `https://${SHOP}.myshopify.com/cart/${safeVariantId}:1` +
      `?properties[customize_no]=${encodeURIComponent(String(customize_no))}` +
      `&properties[mockup_1]=${m1}` +
      `&properties[mockup_2]=${m2}`;

    console.log("[wooacry-callback] build =", BUILD_ID);
    console.log("[wooacry-callback] redirecting to Shopify cart:", redirectUrl);

    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("WOOACRY CALLBACK ERROR:", err);
    return res.status(500).json({ error: err.message, build: BUILD_ID });
  }
}

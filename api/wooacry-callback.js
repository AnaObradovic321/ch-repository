import crypto from "crypto";

const RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "characterhub";
const SECRET = process.env.WOOACRY_SECRET; // REQUIRED
const VERSION = process.env.WOOACRY_VERSION || "1";
const SHOP = process.env.SHOPIFY_SHOP_HANDLE || "characterhub-merch-store";

// Allow switching between prod and pre without code changes
const WOOACRY_BASE =
  process.env.WOOACRY_API_BASE || "https://api-new.wooacry.com";

function signRequest(bodyString, timestamp) {
  // Per docs: 5 lines, each ends with \n, including last line. :contentReference[oaicite:3]{index=3}
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${VERSION}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

// Wooacry guarantees customize_no is attached on callback. :contentReference[oaicite:4]{index=4}
// This makes us resilient if the final callback URL query string gets malformed.
function getCustomizeNo(req) {
  if (req.query?.customize_no) return String(req.query.customize_no);

  const url = req.url || "";
  const idx = url.indexOf("customize_no=");
  if (idx === -1) return "";
  const tail = url.slice(idx + "customize_no=".length);
  const raw = tail.split("&")[0];

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!SECRET) {
    return res.status(500).json({
      error: "Missing WOOACRY_SECRET env var. Refusing to run without it."
    });
  }

  const { variant_id, debug } = req.query;
  const customize_no = getCustomizeNo(req);

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  // Keep your current behavior: callback expects variant_id from redirect_url you constructed
  if (!variant_id) {
    return res.status(400).json({
      error: "Missing variant_id",
      how_to_fix:
        "wooacry-customize-init must build redirect_url like /api/wooacry-callback?variant_id=SHOPIFY_VARIANT_ID"
    });
  }

  try {
    // 1) Call Wooacry customize/info to get mockups. :contentReference[oaicite:5]{index=5}
    const bodyJSON = JSON.stringify({ customize_no: String(customize_no) });
    const timestamp = Math.floor(Date.now() / 1000); // 5-second window per docs :contentReference[oaicite:6]{index=6}
    const sign = signRequest(bodyJSON, timestamp);

    const infoResp = await fetch(
      `${WOOACRY_BASE}/api/reseller/open/customize/info`,
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

    // Keep this for later steps (shipping quote + create order)
    const third_party_user = info?.data?.third_part_user || "";

    if (String(debug) === "1") {
      return res.status(200).json({
        ok: true,
        customize_no: String(customize_no),
        variant_id: String(variant_id),
        third_party_user: third_party_user || null,
        mockups_count: mockups.length,
        mockups_preview: mockups.slice(0, 2)
      });
    }

    // 2) Add to Shopify cart/add and include the properties
    const params = new URLSearchParams();
    params.set("id", String(variant_id));
    params.set("quantity", "1");
    params.set("properties[customize_no]", String(customize_no));

    // Keep mockups exactly as you’re doing now
    if (m1) params.set("properties[mockup_1]", m1);
    if (m2) params.set("properties[mockup_2]", m2);

    // Store user id too (does not change behavior, helps later)
    if (third_party_user) {
      params.set("properties[third_party_user]", String(third_party_user));
    }

    const addUrl = `https://${SHOP}.myshopify.com/cart/add?${params.toString()}`;

    console.log("[wooacry-callback] Redirecting to Shopify cart/add:", addUrl);

    return res.redirect(302, addUrl);
  } catch (err) {
    console.error("WOOACRY CALLBACK ERROR:", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

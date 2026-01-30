import { WOOACRY_API_BASE, buildHeaders, readWooacryJson } from "./wooacry-utils.js";

const SHOP =
  process.env.SHOPIFY_STORE_HANDLE ||
  process.env.SHOPIFY_SHOP_HANDLE ||
  "characterhub-merch-store";

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

  const { variant_id, debug } = req.query;
  const customize_no = getCustomizeNo(req);

  if (!customize_no) return res.status(400).json({ error: "Missing customize_no" });
  if (!variant_id) return res.status(400).json({ error: "Missing variant_id" });

  try {
    const bodyObj = { customize_no: String(customize_no) };
    const raw = JSON.stringify(bodyObj);

    const infoResp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/customize/info`, {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    });

    const parsed = await readWooacryJson(infoResp);
    if (!parsed.ok) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for customize/info",
        wooacry_http_status: infoResp.status,
        body_preview: parsed.raw.slice(0, 500)
      });
    }

    const info = parsed.json;
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

    // FIX: correct key name
    const third_party_user = info?.data?.third_party_user || "";

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

    const params = new URLSearchParams();
    params.set("id", String(variant_id));
    params.set("quantity", "1");
    params.set("properties[customize_no]", String(customize_no));

    if (m1) params.set("properties[mockup_1]", m1);
    if (m2) params.set("properties[mockup_2]", m2);
    if (third_party_user) params.set("properties[third_party_user]", String(third_party_user));

    const addUrl = `https://${SHOP}.myshopify.com/cart/add?${params.toString()}`;
    return res.redirect(302, addUrl);
  } catch (err) {
    console.error("[wooacry-callback ERROR]", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

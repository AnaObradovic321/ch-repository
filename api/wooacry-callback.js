import {
  WOOACRY_API_BASE,
  buildSignedJsonRequest,
  readWooacryJson
} from "./wooacry-utils.js";

const SHOP =
  process.env.SHOPIFY_STORE_HANDLE ||
  process.env.SHOPIFY_SHOP_HANDLE ||
  "";

function getCustomizeNo(req) {
  if (req.query?.customize_no) return String(req.query.customize_no).trim();

  const url = req.url || "";
  const idx = url.indexOf("customize_no=");
  if (idx === -1) return "";
  const tail = url.slice(idx + "customize_no=".length);
  const raw = tail.split("&")[0];

  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const { variant_id, debug, product_id } = req.query;
  const customize_no = getCustomizeNo(req);

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  if (!variant_id) {
    return res.status(400).json({
      error: "Missing variant_id",
      hint: "Make sure wooacry-customize-init adds variant_id into redirect_url."
    });
  }

  if (!SHOP) {
    return res.status(500).json({
      error: "Missing SHOPIFY_STORE_HANDLE or SHOPIFY_SHOP_HANDLE env var"
    });
  }

  try {
    const bodyObj = { customize_no: String(customize_no) };
    const { raw, headers } = buildSignedJsonRequest(bodyObj);

    const infoResp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/customize/info`, {
      method: "POST",
      headers,
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

    if (!info || info.code !== 0 || !info.data) {
      return res.status(502).json({
        error: "Wooacry customize/info failed",
        wooacry_http_status: infoResp.status,
        details: info
      });
    }

    const data = info.data;
    const mockups = Array.isArray(data.render_images) ? data.render_images : [];
    const m1 = mockups[0] || "";
    const m2 = mockups[1] || "";

    // Wooacry docs use "third_part_user" in customize/info response
    const third_part_user = data.third_part_user || "";

    // Useful for debugging and later order validation
    const wooacry_spu = data?.spu?.third_part_spu || "";
    const wooacry_spu_name = data?.spu?.name || "";
    const wooacry_sku_id = data?.sku?.id || null;
    const wooacry_sku_name = data?.sku?.name || "";
    const wooacry_sku_state = data?.sku?.state ?? null;

    if (String(debug) === "1") {
      return res.status(200).json({
        ok: true,
        customize_no: String(customize_no),
        product_id: product_id ? String(product_id) : null,
        variant_id: String(variant_id),
        third_part_user: third_part_user || null,
        wooacry_spu: wooacry_spu || null,
        wooacry_spu_name: wooacry_spu_name || null,
        wooacry_sku_id,
        wooacry_sku_name: wooacry_sku_name || null,
        wooacry_sku_state,
        mockups_count: mockups.length,
        mockups_preview: mockups.slice(0, 2),
        note: "Wooacry render_images are temporary and should be saved to your own server before relying on them long term."
      });
    }

    const params = new URLSearchParams();
    params.set("id", String(variant_id));
    params.set("quantity", "1");
    params.set("properties[customize_no]", String(customize_no));

    if (third_part_user) {
      params.set("properties[third_party_user]", String(third_part_user));
    }

    if (wooacry_spu) {
      params.set("properties[wooacry_spu]", String(wooacry_spu));
    }

    if (wooacry_spu_name) {
      params.set("properties[wooacry_product]", String(wooacry_spu_name));
    }

    if (wooacry_sku_id !== null && wooacry_sku_id !== undefined) {
      params.set("properties[wooacry_sku_id]", String(wooacry_sku_id));
    }

    if (wooacry_sku_name) {
      params.set("properties[wooacry_sku_name]", String(wooacry_sku_name));
    }

    // These URLs are temporary per Wooacry docs.
    // Keep them for immediate UX, but do not treat them as permanent storage.
    if (m1) params.set("properties[mockup_1]", m1);
    if (m2) params.set("properties[mockup_2]", m2);

    const addUrl = `https://${SHOP}.myshopify.com/cart/add?${params.toString()}`;
    return res.redirect(302, addUrl);
  } catch (err) {
    console.error("[wooacry-callback ERROR]", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

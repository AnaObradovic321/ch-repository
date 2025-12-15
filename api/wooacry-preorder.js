import {
  WOOACRY_API_BASE,
  buildHeaders,
  normalizeWooacryAddress,
  readWooacryJson
} from "./wooacry-utils.js";

function validateSkus(skus) {
  if (!Array.isArray(skus) || skus.length === 0) {
    throw new Error("Missing or invalid skus");
  }

  return skus.map((s) => {
    const customize_no = String(s?.customize_no || "").trim();
    const count = Number(s?.count);

    if (!customize_no) throw new Error("SKU missing customize_no");
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error(`Invalid count for customize_no ${customize_no}`);
    }

    return { customize_no, count: Math.trunc(count) };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { third_party_user, skus, address } = req.body || {};

    const tpu = String(third_party_user || "").trim();
    if (!tpu) return res.status(400).json({ error: "Missing or invalid third_party_user" });

    let skuList;
    try {
      skuList = validateSkus(skus);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    let normalizedAddress;
    try {
      normalizedAddress = normalizeWooacryAddress(address);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const bodyObj = { third_party_user: tpu, skus: skuList, address: normalizedAddress };
    const raw = JSON.stringify(bodyObj);

    const wooResp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/create/pre`, {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    });

    const parsed = await readWooacryJson(wooResp);
    if (!parsed.ok) {
      return res.status(502).json({
        error: "Wooacry returned non-JSON for order/create/pre",
        wooacry_http_status: wooResp.status,
        body_preview: parsed.raw.slice(0, 800)
      });
    }

    return res.status(200).json(parsed.json);
  } catch (err) {
    console.error("[wooacry-preorder ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

import {
  WOOACRY_API_BASE,
  buildHeaders,
  normalizeWooacryAddress,
  readWooacryJson
} from "./wooacry-utils.js";

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_HANDLE || "characterhub-merch-store";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";

const SHOPIFY_ADMIN_API_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_TOKEN;

const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;

const WOOACRY_DRY_RUN = String(process.env.WOOACRY_DRY_RUN || "").trim() === "1";

function asString(x) {
  if (x === null || x === undefined) return "";
  return String(x);
}

// Shopify line item properties can be:
// Array: [{name:"customize_no", value:"..."}, ...]
// Object: { customize_no: "..." }
function getLineItemProperty(lineItem, key) {
  const p = lineItem?.properties;
  if (!p) return null;

  if (Array.isArray(p)) {
    const hit = p.find((x) => x && x.name === key);
    return hit ? hit.value : null;
  }

  if (typeof p === "object") return p[key] ?? null;

  return null;
}

function pickCheapestShippingMethod(preJSON) {
  const methods = preJSON?.data?.shipping_methods || [];
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new Error("Wooacry preorder returned no shipping_methods");
  }

  methods.sort((a, b) => {
    const pa = Number(a.postal_amount);
    const pb = Number(b.postal_amount);
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id));
  });

  return String(methods[0].id);
}

async function wooacryPreorder({ third_party_user, skus, address }) {
  const bodyObj = { third_party_user, skus, address };
  const raw = JSON.stringify(bodyObj);

  const resp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/create/pre`, {
    method: "POST",
    headers: buildHeaders(raw),
    body: raw
  });

  const parsed = await readWooacryJson(resp);
  if (!parsed.ok) throw new Error(`Wooacry preorder returned non-JSON (HTTP ${resp.status})`);
  if (!parsed.json || parsed.json.code !== 0) {
    throw new Error(`Wooacry preorder failed: ${JSON.stringify(parsed.json).slice(0, 500)}`);
  }
  return parsed.json;
}

async function wooacryCreateOrder({
  third_party_order_sn,
  third_party_order_created_at,
  third_party_user,
  shipping_method_id,
  skus,
  address
}) {
  const bodyObj = {
    third_party_order_sn,
    third_party_order_created_at,
    third_party_user,
    shipping_method_id,
    skus,
    address
  };

  const raw = JSON.stringify(bodyObj);

  const resp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/create`, {
    method: "POST",
    headers: buildHeaders(raw),
    body: raw
  });

  const parsed = await readWooacryJson(resp);
  if (!parsed.ok) throw new Error(`Wooacry order/create returned non-JSON (HTTP ${resp.status})`);
  if (!parsed.json || parsed.json.code !== 0) {
    throw new Error(`Wooacry order/create failed: ${JSON.stringify(parsed.json).slice(0, 500)}`);
  }

  return parsed.json;
}

async function listOrderMetafields(orderId) {
  if (!SHOPIFY_ADMIN_API_TOKEN) return [];

  const resp = await fetch(`${SHOPIFY_ADMIN_API}/orders/${orderId}/metafields.json`, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
      "Content-Type": "application/json"
    }
  });

  const json = await resp.json();
  return json?.metafields || [];
}

async function upsertOrderMetafield(orderId, namespace, key, value, type) {
  if (!SHOPIFY_ADMIN_API_TOKEN) return null;

  const all = await listOrderMetafields(orderId);
  const existing = all.find((m) => m.namespace === namespace && m.key === key);

  if (existing?.id) {
    const payload = {
      metafield: {
        id: existing.id,
        value: asString(value),
        type: type || existing.type || "single_line_text_field"
      }
    };

    const resp = await fetch(`${SHOPIFY_ADMIN_API}/metafields/${existing.id}.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const json = await resp.json();
    return json?.metafield || null;
  }

  const payload = {
    metafield: {
      namespace,
      key,
      value: asString(value),
      type: type || "single_line_text_field"
    }
  };

  const resp = await fetch(`${SHOPIFY_ADMIN_API}/orders/${orderId}/metafields.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = await resp.json();
  return json?.metafield || null;
}

export default async function handler(req, res) {
  try {
    const order = req.body;

    if (!order || !order.id) {
      return res.status(400).json({ error: "Invalid Shopify order webhook payload" });
    }

    const metafields = await listOrderMetafields(order.id);
    const already = metafields.find((m) => m.namespace === "wooacry" && m.key === "order_sn");
    if (already?.value) {
      return res.status(200).json({ ok: true, already_created: true, wooacry_order_sn: already.value });
    }

    const third_party_order_sn = asString(order.id).trim();
    const createdAt = order.created_at || order.processed_at || new Date().toISOString();
    const third_party_order_created_at = Math.floor(new Date(createdAt).getTime() / 1000);
const email = asString(order.email).trim().toLowerCase();
const third_party_user = email || `guest_${asString(order.id).trim()}`;

// Persist so other flows can reuse it
await upsertOrderMetafield(order.id, "wooacry", "third_party_user", third_party_user, "single_line_text_field");
    const wooItems = [];
    for (const item of order.line_items || []) {
      const customize_no = getLineItemProperty(item, "customize_no");
      if (customize_no) {
        wooItems.push({
          customize_no: asString(customize_no).trim(),
          count: Math.trunc(Number(item.quantity || 1))
        });
      }
    }

    if (wooItems.length === 0) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const ship = order.shipping_address || order.billing_address;
    if (!ship) return res.status(400).json({ error: "Missing shipping_address on order" });

    let normalizedAddress;
    try {
      normalizedAddress = normalizeWooacryAddress({
        first_name: ship.first_name || "",
        last_name: ship.last_name || "",
        phone: ship.phone || order.phone || (order.billing_address && order.billing_address.phone) || "",
        country_code: (ship.country_code || "").toUpperCase(),
        province: ship.province || "",
        city: ship.city || "",
        address1: ship.address1 || "",
        address2: ship.address2 || "",
        post_code: ship.zip || "",
        tax_number: ship.tax_number || ""
      });
    } catch (e) {
      await upsertOrderMetafield(order.id, "wooacry", "status", `FAILED: ${e.message}`, "single_line_text_field");
      return res.status(400).json({ error: e.message });
    }

    if (WOOACRY_DRY_RUN) {
      await upsertOrderMetafield(order.id, "wooacry", "status", "DRY RUN: Production Started", "single_line_text_field");
      return res.status(200).json({ ok: true, dry_run: true, woo_items: wooItems, normalized_address: normalizedAddress });
    }

    const preJSON = await wooacryPreorder({
      third_party_user,
      skus: wooItems,
      address: normalizedAddress
    });

    const shipping_method_id = pickCheapestShippingMethod(preJSON);

    const createJSON = await wooacryCreateOrder({
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus: wooItems,
      address: normalizedAddress
    });

    const wooacry_order_sn = createJSON?.data?.order_sn || null;

    if (wooacry_order_sn) {
      await upsertOrderMetafield(order.id, "wooacry", "order_sn", wooacry_order_sn, "single_line_text_field");
    }
    await upsertOrderMetafield(order.id, "wooacry", "status", "Production Started", "single_line_text_field");

    return res.status(200).json({ ok: true, wooacry_order_sn, wooacry_create_response: createJSON });
  } catch (err) {
    console.error("[shopify-order-created ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

import { buildHeaders } from "./wooacry-utils.js";

// -------------------------
// Config
// -------------------------
const WOOACRY_BASE =
  process.env.WOOACRY_BASE_URL ||
  process.env.WOOACRY_BASE ||
  "https://api-new.wooacry.com";

const SHOPIFY_STORE =
  process.env.SHOPIFY_STORE_HANDLE || "characterhub-merch-store";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";

const SHOPIFY_ADMIN_API_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_TOKEN;

const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;

// Safe testing toggle
const WOOACRY_DRY_RUN = String(process.env.WOOACRY_DRY_RUN || "").trim() === "1";

// Wooacry: tax_number mandatory for these countries
const TAX_REQUIRED_COUNTRIES = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];

function asString(x) {
  if (x === null || x === undefined) return "";
  return String(x);
}

// Shopify line item properties can be either:
// 1) Array: [{name:"customize_no", value:"PDDOLZN1"}, ...]
// 2) Object: { customize_no: "PDDOLZN1" }
function getLineItemProperty(lineItem, key) {
  const p = lineItem?.properties;
  if (!p) return null;

  if (Array.isArray(p)) {
    const hit = p.find((x) => x && x.name === key);
    return hit ? hit.value : null;
  }

  if (typeof p === "object") {
    return p[key] ?? null;
  }

  return null;
}

function requireNonEmpty(value, fieldName) {
  const v = asString(value).trim();
  if (!v) throw new Error(`Missing required field: ${fieldName}`);
  return v;
}

function requireTaxNumberIfNeeded(countryCode, taxNumber) {
  const cc = asString(countryCode).toUpperCase();
  if (TAX_REQUIRED_COUNTRIES.includes(cc)) {
    if (!asString(taxNumber).trim()) {
      throw new Error(`Missing tax_number for destination country ${cc}`);
    }
  }
}

/**
 * Wooacry requires address2 and tax_number keys to exist in request bodies
 * (Pre-order + Create order). :contentReference[oaicite:8]{index=8}
 * We allow address2 to be "" if customer has no unit/apartment.
 */
function normalizeWooacryAddressFromShopify(order) {
  const ship = order.shipping_address || order.billing_address;
  if (!ship) throw new Error("Missing shipping_address on order");

  const countryCode =
    (ship.country_code || ship.country_code_v2 || ship.country || "").toString().toUpperCase();

  const normalized = {
    first_name: requireNonEmpty(ship.first_name, "address.first_name"),
    last_name: requireNonEmpty(ship.last_name, "address.last_name"),
    phone: requireNonEmpty(
      ship.phone || order.phone || order?.billing_address?.phone,
      "address.phone"
    ),
    country_code: requireNonEmpty(countryCode, "address.country_code"),
    province: requireNonEmpty(ship.province || ship.province_code, "address.province"),
    city: requireNonEmpty(ship.city, "address.city"),
    address1: requireNonEmpty(ship.address1, "address.address1"),
    address2: asString(ship.address2 ?? ""), // required key, may be empty string
    post_code: requireNonEmpty(ship.zip, "address.post_code"),
    tax_number: asString(ship.tax_number ?? "") // required key, may be empty except required countries
  };

  requireTaxNumberIfNeeded(normalized.country_code, normalized.tax_number);
  return normalized;
}

async function readWooacryJson(resp, label) {
  const text = await resp.text();
  try {
    const json = JSON.parse(text);
    return { json, raw: text };
  } catch {
    throw new Error(`${label} returned non-JSON (HTTP ${resp.status}): ${text.slice(0, 500)}`);
  }
}

/**
 * Choose a shipping_method_id from pre-order response.
 * Docs: response has shipping_methods with id + postal_amount. :contentReference[oaicite:9]{index=9}
 */
function pickCheapestShippingMethod(preJSON) {
  const methods = preJSON?.data?.shipping_methods || [];
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new Error("Wooacry preorder returned no shipping_methods");
  }

  // Cheapest by total of fees we can see (postal + tax + tax_service)
  methods.sort((a, b) => {
    const ta = Number(a.postal_amount || 0) + Number(a.tax_amount || 0) + Number(a.tax_service_amount || 0);
    const tb = Number(b.postal_amount || 0) + Number(b.tax_amount || 0) + Number(b.tax_service_amount || 0);
    return ta - tb;
  });

  return methods[0].id;
}

async function wooacryPreorder({ third_party_user, skus, address }) {
  // Docs: third_party_user + skus + address required. :contentReference[oaicite:10]{index=10}
  const bodyObj = { third_party_user, skus, address };
  const body = JSON.stringify(bodyObj);

  const resp = await fetch(`${WOOACRY_BASE}/api/reseller/open/order/create/pre`, {
    method: "POST",
    headers: buildHeaders(body),
    body
  });

  const { json } = await readWooacryJson(resp, "Wooacry order/create/pre");

  if (!json || json.code !== 0) {
    throw new Error(`Wooacry preorder failed: ${JSON.stringify(json).slice(0, 800)}`);
  }

  return json;
}

async function wooacryCreateOrder({
  third_party_order_sn,
  third_party_order_created_at,
  third_party_user,
  shipping_method_id,
  skus,
  address
}) {
  // Docs: create order requires shipping_method_id from pre-order. :contentReference[oaicite:11]{index=11}
  const bodyObj = {
    third_party_order_sn,
    third_party_order_created_at,
    third_party_user,
    shipping_method_id,
    skus,
    address
  };

  const body = JSON.stringify(bodyObj);

  const resp = await fetch(`${WOOACRY_BASE}/api/reseller/open/order/create`, {
    method: "POST",
    headers: buildHeaders(body),
    body
  });

  const { json } = await readWooacryJson(resp, "Wooacry order/create");

  if (!json || json.code !== 0) {
    throw new Error(`Wooacry order/create failed: ${JSON.stringify(json).slice(0, 800)}`);
  }

  return json;
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
  if (!SHOPIFY_ADMIN_API_TOKEN) {
    console.log("[shopify-order-created] Missing SHOPIFY_ADMIN_API_TOKEN, skipping metafield upsert");
    return null;
  }

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

    console.log("[shopify-order-created] New Shopify order:", order.id, "dry_run:", WOOACRY_DRY_RUN);

    // Idempotency: if wooacry.order_sn already exists, do nothing
    const metafields = await listOrderMetafields(order.id);
    const already = metafields.find((m) => m.namespace === "wooacry" && m.key === "order_sn");
    if (already?.value) {
      console.log("[shopify-order-created] Wooacry already created. order_sn:", already.value);
      return res.status(200).json({ ok: true, already_created: true, wooacry_order_sn: already.value });
    }

    const third_party_order_sn = asString(order.id).trim();

    const createdAt = order.created_at || order.processed_at || new Date().toISOString();
    const third_party_order_created_at = Math.floor(new Date(createdAt).getTime() / 1000);

    // Build Wooacry SKUs from line item customize_no
    const countsByCustomize = new Map();
    let third_party_user_from_items = "";

    for (const item of order.line_items || []) {
      const customize_no = getLineItemProperty(item, "customize_no");
      if (!customize_no) continue;

      // If you ever start passing a real third_party_user into the editor,
      // store it in line-item properties and we will use it here.
      if (!third_party_user_from_items) {
        third_party_user_from_items = asString(getLineItemProperty(item, "third_party_user")).trim();
      }

      const no = asString(customize_no).trim();
      const qty = Math.max(1, parseInt(item.quantity || 1, 10));

      countsByCustomize.set(no, (countsByCustomize.get(no) || 0) + qty);
    }

    if (countsByCustomize.size === 0) {
      console.log("[shopify-order-created] No customize_no items found. Ignoring.");
      return res.status(200).json({ ok: true, skipped: true });
    }

    const wooItems = Array.from(countsByCustomize.entries()).map(([customize_no, count]) => ({
      customize_no,
      count
    }));

    // IMPORTANT: keep third_party_user consistent with your editor flow.
    // Your current editor redirect uses "guest", so this default is safest.
    const third_party_user = third_party_user_from_items || "guest";

    console.log("[shopify-order-created] Wooacry items:", wooItems);

    // Normalize address for Wooacry
    const normalizedAddress = normalizeWooacryAddressFromShopify(order);

    // DRY RUN: do not call Wooacry
    if (WOOACRY_DRY_RUN) {
      await upsertOrderMetafield(order.id, "wooacry", "status", "DRY RUN: Production Started", "single_line_text_field");
      return res.status(200).json({
        ok: true,
        dry_run: true,
        woo_items: wooItems,
        normalized_address: normalizedAddress
      });
    }

    // 1) Preorder to get shipping methods
    const preJSON = await wooacryPreorder({
      third_party_user,
      skus: wooItems,
      address: normalizedAddress
    });

    const shipping_method_id = pickCheapestShippingMethod(preJSON);

    // 2) Create manufacturing order
    const createJSON = await wooacryCreateOrder({
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus: wooItems,
      address: normalizedAddress
    });

    const wooacry_order_sn = createJSON?.data?.order_sn || "";

    // Save Wooacry order_sn + status into Shopify metafields
    if (wooacry_order_sn) {
      await upsertOrderMetafield(order.id, "wooacry", "order_sn", wooacry_order_sn, "single_line_text_field");
    }
    await upsertOrderMetafield(order.id, "wooacry", "status", "Production Started", "single_line_text_field");

    return res.status(200).json({
      ok: true,
      wooacry_order_sn,
      wooacry_create_response: createJSON
    });
  } catch (err) {
    console.error("[shopify-order-created ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

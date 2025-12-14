
import { buildHeaders, validateWooacryAddress } from "./wooacry-utils.js";

// Config
const WOOACRY_BASE =
  process.env.WOOACRY_BASE_URL || "https://api-new.wooacry.com";

const SHOPIFY_STORE =
  process.env.SHOPIFY_STORE_HANDLE || "characterhub-merch-store";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";

// IMPORTANT: Your shipping webhook uses SHOPIFY_ADMIN_API_TOKEN.
// Your old code used SHOPIFY_TOKEN.
// This supports both so you do not get stuck.
const SHOPIFY_ADMIN_API_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_TOKEN;

const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;

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

function requireTaxNumberIfNeeded(countryCode, taxNumber) {
  const cc = asString(countryCode).toUpperCase();
  if (TAX_REQUIRED_COUNTRIES.includes(cc)) {
    if (!asString(taxNumber).trim()) {
      throw new Error(`Missing tax_number for destination country ${cc}`);
    }
  }
}

function pickCheapestShippingMethod(preJSON) {
  const methods = preJSON?.data?.shipping_methods || [];
  if (!Array.isArray(methods) || methods.length === 0) {
    throw new Error("Wooacry preorder returned no shipping_methods");
  }

  // postal_amount might be number or string, force Number()
  methods.sort((a, b) => Number(a.postal_amount) - Number(b.postal_amount));
  return methods[0].id;
}

async function wooacryPreorder({ third_party_user, skus, address }) {
  const body = JSON.stringify({
    third_party_user,
    skus,
    address
  });

  const resp = await fetch(`${WOOACRY_BASE}/api/reseller/open/order/create/pre`, {
    method: "POST",
    headers: buildHeaders(body),
    body
  });

  const json = await resp.json();
  if (!json || json.code !== 0) {
    throw new Error(
      `Wooacry preorder failed: ${JSON.stringify(json)?.slice(0, 500)}`
    );
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
  const body = JSON.stringify({
    third_party_order_sn,
    third_party_order_created_at,
    third_party_user,
    shipping_method_id,
    skus,
    address
  });

  const resp = await fetch(`${WOOACRY_BASE}/api/reseller/open/order/create`, {
    method: "POST",
    headers: buildHeaders(body),
    body
  });

  const json = await resp.json();
  if (!json || json.code !== 0) {
    throw new Error(
      `Wooacry order/create failed: ${JSON.stringify(json)?.slice(0, 500)}`
    );
  }
  return json;
}

async function getExistingWooacryMetafield(orderId) {
  if (!SHOPIFY_ADMIN_API_TOKEN) return null;

  const resp = await fetch(`${SHOPIFY_ADMIN_API}/orders/${orderId}/metafields.json`, {
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
      "Content-Type": "application/json"
    }
  });

  const json = await resp.json();
  const list = json?.metafields || [];
  const hit = list.find((m) => m.namespace === "wooacry" && m.key === "order_sn");
  return hit || null;
}

async function saveWooacryOrderSnMetafield(orderId, wooacryOrderSn) {
  if (!SHOPIFY_ADMIN_API_TOKEN) {
    console.log("[shopify-order-created] Missing SHOPIFY_ADMIN_API_TOKEN, skipping metafield save");
    return;
  }

  const payload = {
    metafield: {
      namespace: "wooacry",
      key: "order_sn",
      value: asString(wooacryOrderSn),
      type: "single_line_text_field"
    }
  };

  await fetch(`${SHOPIFY_ADMIN_API}/orders/${orderId}/metafields.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_API_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export default async function handler(req, res) {
  try {
    const order = req.body;

    if (!order || !order.id) {
      return res.status(400).json({ error: "Invalid Shopify order webhook payload" });
    }

    console.log("[shopify-order-created] New Shopify order:", order.id);

    // Idempotency: if we already saved wooacry order_sn, do nothing
    const existing = await getExistingWooacryMetafield(order.id);
    if (existing?.value) {
      console.log("[shopify-order-created] Wooacry already created for this order. order_sn:", existing.value);
      return res.status(200).json({ ok: true, already_created: true, wooacry_order_sn: existing.value });
    }

    const third_party_order_sn = asString(order.id);
    const createdAt = order.created_at || order.processed_at || new Date().toISOString();
    const third_party_order_created_at = Math.floor(new Date(createdAt).getTime() / 1000);

    const third_party_user = asString(order.email).trim() || "guest";

    // 1) Find Wooacry items from line item properties
    const wooItems = [];

    for (const item of order.line_items || []) {
      const customize_no = getLineItemProperty(item, "customize_no");
      if (customize_no) {
        wooItems.push({
          customize_no: asString(customize_no),
          count: Number(item.quantity || 1)
        });
      }
    }

    if (wooItems.length === 0) {
      console.log("[shopify-order-created] No customize_no items found. Ignoring.");
      return res.status(200).json({ ok: true, skipped: true });
    }

    console.log("[shopify-order-created] Wooacry items:", wooItems);

    // 2) Normalize address (Wooacry requires most of these fields)
    const ship = order.shipping_address || order.billing_address;
    if (!ship) {
      return res.status(400).json({ error: "Missing shipping_address on order" });
    }

    const normalized = validateWooacryAddress({
      first_name: ship.first_name || "",
      last_name: ship.last_name || "",
      phone: ship.phone || order.phone || (order.billing_address && order.billing_address.phone) || "",
      country_code: (ship.country_code || "").toUpperCase(),
      province: ship.province || "",
      city: ship.city || "",
      address1: ship.address1 || "",
      address2: ship.address2 || "",
      post_code: ship.zip || "",
      // Shopify does not provide this normally unless you collect it yourself
      tax_number: ship.tax_number || ""
    });

    // Wooacry requires tax_number for certain countries
    requireTaxNumberIfNeeded(normalized.country_code, normalized.tax_number);

    // 3) Preorder to get shipping methods
    const preJSON = await wooacryPreorder({
      third_party_user,
      skus: wooItems,
      address: normalized
    });

    const shipping_method_id = pickCheapestShippingMethod(preJSON);

    // 4) Create manufacturing order
    const createJSON = await wooacryCreateOrder({
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus: wooItems,
      address: normalized
    });

    const wooacry_order_sn = createJSON?.data?.order_sn;

    // 5) Save Wooacry order_sn into Shopify metafield
    if (wooacry_order_sn) {
      await saveWooacryOrderSnMetafield(order.id, wooacry_order_sn);
    }

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

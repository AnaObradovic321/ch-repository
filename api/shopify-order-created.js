import crypto from "crypto";
import getRawBody from "raw-body";
import {
  WOOACRY_API_BASE,
  buildSignedJsonRequest,
  normalizeWooacryAddress,
  readWooacryJson
} from "./wooacry-utils.js";

export const config = {
  api: {
    bodyParser: false
  }
};

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_HANDLE || process.env.SHOPIFY_SHOP_HANDLE || "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";
const SHOPIFY_ADMIN_API_TOKEN =
  process.env.SHOPIFY_ADMIN_API_TOKEN || process.env.SHOPIFY_TOKEN || "";
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || "";

const SHOPIFY_ADMIN_API = SHOPIFY_STORE
  ? `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`
  : "";

const WOOACRY_DRY_RUN = String(process.env.WOOACRY_DRY_RUN || "").trim() === "1";

function asString(x) {
  if (x === null || x === undefined) return "";
  return String(x);
}

function safeCompare(a, b) {
  const abuf = Buffer.from(a || "", "utf8");
  const bbuf = Buffer.from(b || "", "utf8");
  if (abuf.length !== bbuf.length) return false;
  return crypto.timingSafeEqual(abuf, bbuf);
}

async function readRawBody(req) {
  const raw = await getRawBody(req);
  return raw.toString("utf8");
}

function verifyShopifyWebhook(rawBody, hmacHeader) {
  if (!SHOPIFY_WEBHOOK_SECRET) {
    throw new Error("Missing SHOPIFY_WEBHOOK_SECRET env var");
  }

  if (!hmacHeader || !rawBody) return false;

  const digest = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  return safeCompare(digest, String(hmacHeader));
}

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
  const { raw, headers } = buildSignedJsonRequest(bodyObj);

  const resp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/create/pre`, {
    method: "POST",
    headers,
    body: raw
  });

  const parsed = await readWooacryJson(resp);
  if (!parsed.ok) {
    throw new Error(`Wooacry preorder returned non-JSON (HTTP ${resp.status})`);
  }

  const result = parsed.json;
  if (!result || result.code !== 0) {
    throw new Error(`Wooacry preorder failed: ${JSON.stringify(result).slice(0, 500)}`);
  }

  if (
    !Array.isArray(result?.data?.shipping_methods) ||
    !Array.isArray(result?.data?.skus)
  ) {
    throw new Error("Wooacry preorder response missing shipping_methods or skus");
  }

  return result;
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

  const { raw, headers } = buildSignedJsonRequest(bodyObj);

  const resp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/order/create`, {
    method: "POST",
    headers,
    body: raw
  });

  const parsed = await readWooacryJson(resp);
  if (!parsed.ok) {
    throw new Error(`Wooacry order/create returned non-JSON (HTTP ${resp.status})`);
  }

  const result = parsed.json;
  if (!result || result.code !== 0) {
    throw new Error(`Wooacry order/create failed: ${JSON.stringify(result).slice(0, 500)}`);
  }

  if (!result?.data?.order_sn || !Array.isArray(result?.data?.skus)) {
    throw new Error("Wooacry order/create response missing order_sn or skus");
  }

  return result;
}

async function listOrderMetafields(orderId) {
  if (!SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_ADMIN_API) return [];

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
  if (!SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_ADMIN_API) return null;

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

async function getExistingThirdPartyUser(orderId) {
  const metafields = await listOrderMetafields(orderId);
  const hit = metafields.find(
    (m) => m.namespace === "wooacry" && m.key === "third_party_user"
  );
  return hit?.value ? String(hit.value).trim() : "";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_API_TOKEN || !SHOPIFY_ADMIN_API) {
      return res.status(500).json({
        error: "Missing Shopify admin configuration env vars"
      });
    }

    const rawBody = await readRawBody(req);
    const hmacHeader = req.headers["x-shopify-hmac-sha256"];

    if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
      return res.status(401).json({ error: "Invalid Shopify webhook signature" });
    }

    let order;
    try {
      order = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    if (!order || !order.id) {
      return res.status(400).json({ error: "Invalid Shopify order webhook payload" });
    }

    const metafields = await listOrderMetafields(order.id);

    const already = metafields.find(
      (m) => m.namespace === "wooacry" && m.key === "order_sn"
    );
    if (already?.value) {
      return res.status(200).json({
        ok: true,
        already_created: true,
        wooacry_order_sn: already.value
      });
    }

    const statusField = metafields.find(
      (m) => m.namespace === "wooacry" && m.key === "status"
    );
    if (statusField?.value === "CREATING") {
      return res.status(200).json({
        ok: true,
        already_processing: true
      });
    }

    await upsertOrderMetafield(
      order.id,
      "wooacry",
      "status",
      "CREATING",
      "single_line_text_field"
    );

    const third_party_order_sn = asString(order.id).trim();
    const createdAt = order.created_at || order.processed_at || new Date().toISOString();
    const third_party_order_created_at = Math.floor(new Date(createdAt).getTime() / 1000);

    const savedThirdPartyUser = await getExistingThirdPartyUser(order.id);
    const email = asString(order.email).trim().toLowerCase();
    const third_party_user = savedThirdPartyUser || email || `guest_${third_party_order_sn}`;

    await upsertOrderMetafield(
      order.id,
      "wooacry",
      "third_party_user",
      third_party_user,
      "single_line_text_field"
    );

    const wooItems = [];
    for (const item of order.line_items || []) {
      const customize_no = getLineItemProperty(item, "customize_no");
      if (customize_no) {
        const count = Math.trunc(Number(item.quantity || 1));
        if (count <= 0) continue;

        wooItems.push({
          customize_no: asString(customize_no).trim(),
          count
        });
      }
    }

    if (wooItems.length === 0) {
      await upsertOrderMetafield(
        order.id,
        "wooacry",
        "status",
        "SKIPPED_NO_WOOACRY_ITEMS",
        "single_line_text_field"
      );
      return res.status(200).json({ ok: true, skipped: true });
    }

    const ship = order.shipping_address || order.billing_address;
    if (!ship) {
      await upsertOrderMetafield(
        order.id,
        "wooacry",
        "status",
        "FAILED: Missing shipping_address on order",
        "single_line_text_field"
      );
      return res.status(400).json({ error: "Missing shipping_address on order" });
    }

    let normalizedAddress;
    try {
      normalizedAddress = normalizeWooacryAddress({
        first_name: ship.first_name || "",
        last_name: ship.last_name || "",
        phone: ship.phone || order.phone || order.billing_address?.phone || "",
        country_code: (ship.country_code || "").toUpperCase(),
        province: ship.province || "",
        city: ship.city || "",
        address1: ship.address1 || "",
        address2: ship.address2 || "",
        post_code: ship.zip || "",
        tax_number: ship.tax_number || ""
      });
    } catch (e) {
      await upsertOrderMetafield(
        order.id,
        "wooacry",
        "status",
        `FAILED: ${e.message}`,
        "single_line_text_field"
      );
      return res.status(400).json({ error: e.message });
    }

    if (WOOACRY_DRY_RUN) {
      await upsertOrderMetafield(
        order.id,
        "wooacry",
        "status",
        "DRY_RUN_READY",
        "single_line_text_field"
      );
      return res.status(200).json({
        ok: true,
        dry_run: true,
        woo_items: wooItems,
        normalized_address: normalizedAddress
      });
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
      await upsertOrderMetafield(
        order.id,
        "wooacry",
        "order_sn",
        wooacry_order_sn,
        "single_line_text_field"
      );
    }

    await upsertOrderMetafield(
      order.id,
      "wooacry",
      "status",
      "PRODUCTION_STARTED",
      "single_line_text_field"
    );

    return res.status(200).json({
      ok: true,
      wooacry_order_sn,
      wooacry_create_response: createJSON
    });
  } catch (err) {
    console.error("[shopify-order-created ERROR]", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

::contentReference[oaicite:1]{index=1}

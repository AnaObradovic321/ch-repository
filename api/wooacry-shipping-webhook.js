/**
 * api/wooacry-shipping-webhook.js
 *
 * Wooacry -> Shopify Shipping Notice callback
 *
 * Responsibilities:
 * 1) Validate payload contains third_party_order_sn
 * 2) Find Shopify order by ID (third_party_order_sn must be Shopify order.id or contain it)
 * 3) Fetch fulfillment orders for the order
 * 4) If no fulfillment exists, create fulfillment with tracking
 * 5) If fulfillment exists, update tracking
 *
 * Notes:
 * - Shopify "create fulfillment" commonly requires fulfillment_order_line_items (ids + quantities)
 * - Do NOT rely on order.fulfillment_orders being present on /orders/{id}.json
 */

const SHOPIFY_STORE = "characterhub-merch-store";
const SHOPIFY_API_VERSION = "2024-01";
const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// Optional: protect this endpoint so random people cannot spoof tracking updates.
const WOOACRY_WEBHOOK_SECRET = process.env.WOOACRY_WEBHOOK_SECRET;

function extractShopifyOrderId(thirdPartyOrderSn) {
  if (!thirdPartyOrderSn) return null;

  // Accept:
  // - "1234567890"
  // - "#1001 (1234567890)" style
  // - "gid://shopify/Order/1234567890"
  const match = String(thirdPartyOrderSn).match(/(\d{6,})/);
  if (!match) return null;

  return match[1];
}

async function shopifyFetch(path, options = {}) {
  const resp = await fetch(`${SHOPIFY_ADMIN_API}${path}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave json null
  }

  if (!resp.ok) {
    const err = new Error(
      `Shopify API error ${resp.status} on ${path}: ${text || resp.statusText}`
    );
    err.status = resp.status;
    err.details = json || text;
    throw err;
  }

  return json;
}

function normalizeWooacryBody(req) {
  // Next.js usually parses JSON already. But we guard anyway.
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!SHOPIFY_TOKEN) {
      return res.status(500).json({ error: "Missing SHOPIFY_ADMIN_API_TOKEN" });
    }

    // Optional shared secret check (recommended)
    if (WOOACRY_WEBHOOK_SECRET) {
      const provided =
        req.headers["x-wooacry-secret"] ||
        req.headers["x-webhook-secret"] ||
        req.query.secret;

      if (String(provided || "") !== String(WOOACRY_WEBHOOK_SECRET)) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const body = normalizeWooacryBody(req);

    console.log("[WOOACRY SHIPPING NOTICE RECEIVED]", JSON.stringify(body));

    if (!body || !body.third_party_order_sn) {
      return res.status(400).json({ error: "Missing third_party_order_sn" });
    }

    const orderId = extractShopifyOrderId(body.third_party_order_sn);
    if (!orderId) {
      return res.status(400).json({
        error:
          "third_party_order_sn did not contain a Shopify order id. It must be Shopify order.id (numeric) or include it."
      });
    }

    const express = body.express || {};
    const trackingNumber = express.express_number || "";
    const trackingCompany =
      express.express_company_name || express.express_company || "Carrier";

    // If Wooacry doesn't provide a direct tracking URL, give a universal one
    const trackingUrl = trackingNumber
      ? `https://t.17track.net/en#nums=${encodeURIComponent(trackingNumber)}`
      : "";

    // 1) Load order
    const orderData = await shopifyFetch(`/orders/${orderId}.json`);
    const order = orderData?.order;
    if (!order) {
      return res.status(404).json({ error: "Shopify order not found", orderId });
    }

    // 2) Get fulfillment orders (required for creating a fulfillment reliably)
    const foData = await shopifyFetch(
      `/orders/${orderId}/fulfillment_orders.json`
    );

    const fulfillmentOrders = foData?.fulfillment_orders || [];
    const openFulfillmentOrders = fulfillmentOrders.filter((fo) => {
      const status = String(fo.status || "").toLowerCase();
      return status !== "closed" && status !== "cancelled";
    });

    if (openFulfillmentOrders.length === 0) {
      // Could already be fulfilled/cancelled, or nothing fulfillable.
      console.log("[WOOACRY SHIPPING] No open fulfillment orders", {
        orderId,
        fulfillmentOrdersCount: fulfillmentOrders.length
      });
      return res.status(200).json({
        ok: true,
        action: "noop",
        reason: "No open fulfillment orders",
        orderId
      });
    }

    // 3) Get existing fulfillments on order
    const existingFulfillment =
      (order.fulfillments || []).find((f) => f.status !== "cancelled") || null;

    const tracking_info = {
      number: trackingNumber || null,
      company: trackingCompany || null,
      url: trackingUrl || null
    };

    // Build the required line_items_by_fulfillment_order payload with line item ids
    const line_items_by_fulfillment_order = openFulfillmentOrders.map((fo) => ({
      fulfillment_order_id: fo.id,
      fulfillment_order_line_items: (fo.line_items || []).map((li) => ({
        id: li.id,
        quantity: li.quantity
      }))
    }));

    // 4A) Create fulfillment if none exists
    if (!existingFulfillment) {
      console.log("[FULFILLMENT] None exists. Creating fulfillment.", {
        orderId,
        trackingNumber
      });

      // Some shops require location_id. Use assigned_location_id when present.
      const locationId =
        openFulfillmentOrders[0]?.assigned_location_id ||
        openFulfillmentOrders[0]?.assigned_location?.location_id ||
        null;

      const payload = {
        fulfillment: {
          notify_customer: true,
          tracking_info,
          line_items_by_fulfillment_order,
          ...(locationId ? { location_id: locationId } : {})
        }
      };

      const created = await shopifyFetch(`/fulfillments.json`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      console.log("[FULFILLMENT CREATED]", JSON.stringify(created));

      return res.status(200).json({
        ok: true,
        action: "created",
        orderId,
        fulfillment_id: created?.fulfillment?.id || null
      });
    }

    // 4B) Update existing fulfillment tracking
    console.log("[FULFILLMENT] Exists. Updating tracking.", {
      orderId,
      fulfillmentId: existingFulfillment.id,
      trackingNumber
    });

    const updatePayload = {
      fulfillment: {
        notify_customer: true,
        tracking_info
      }
    };

    const updated = await shopifyFetch(
      `/fulfillments/${existingFulfillment.id}.json`,
      {
        method: "PUT",
        body: JSON.stringify(updatePayload)
      }
    );

    console.log("[FULFILLMENT UPDATED]", JSON.stringify(updated));

    return res.status(200).json({
      ok: true,
      action: "updated",
      orderId,
      fulfillment_id: existingFulfillment.id
    });
  } catch (err) {
    console.error("[WOOACRY SHIPPING WEBHOOK ERROR]", err);
    return res.status(err.status || 500).json({
      error: err.message || "Server error",
      details: err.details || null
    });
  }
}

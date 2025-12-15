/**
 * Wooacry -> Partner Shipping Notice webhook
 * Docs: POST to partner URL, payload includes third_party_order_sn + express object.
 * Docs: respond with { data: [], code: 0, message: "success" }.
 */
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_HANDLE || "characterhub-merch-store";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";
const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

const WOOACRY_WEBHOOK_SECRET = process.env.WOOACRY_WEBHOOK_SECRET;

function extractShopifyOrderId(thirdPartyOrderSn) {
  if (!thirdPartyOrderSn) return null;
  const match = String(thirdPartyOrderSn).match(/(\d{6,})/);
  return match ? match[1] : null;
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
    // ignore
  }

  if (!resp.ok) {
    const err = new Error(`Shopify API error ${resp.status} on ${path}: ${text || resp.statusText}`);
    err.status = resp.status;
    err.details = json || text;
    throw err;
  }

  return json;
}

function normalizeWooacryBody(req) {
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
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (!SHOPIFY_TOKEN) return res.status(500).json({ error: "Missing SHOPIFY_ADMIN_API_TOKEN" });

    if (WOOACRY_WEBHOOK_SECRET) {
      const provided = req.headers["x-wooacry-secret"] || req.headers["x-webhook-secret"] || req.query.secret;
      if (String(provided || "") !== String(WOOACRY_WEBHOOK_SECRET)) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const body = normalizeWooacryBody(req);

    if (!body || !body.third_party_order_sn) {
      return res.status(400).json({ error: "Missing third_party_order_sn" });
    }

    const orderId = extractShopifyOrderId(body.third_party_order_sn);
    if (!orderId) {
      return res.status(400).json({
        error: "third_party_order_sn did not contain a Shopify order id (numeric)."
      });
    }

    const express = body.express || {};
    const trackingNumber = express.express_number || "";
    const trackingCompany = express.express_company_name || express.express_company || "Carrier";
    const trackingUrl = trackingNumber
      ? `https://t.17track.net/en#nums=${encodeURIComponent(trackingNumber)}`
      : "";

    const orderData = await shopifyFetch(`/orders/${orderId}.json`);
    const order = orderData?.order;
    if (!order) return res.status(404).json({ error: "Shopify order not found", orderId });

    const foData = await shopifyFetch(`/orders/${orderId}/fulfillment_orders.json`);
    const fulfillmentOrders = foData?.fulfillment_orders || [];
    const openFulfillmentOrders = fulfillmentOrders.filter((fo) => {
      const status = String(fo.status || "").toLowerCase();
      return status !== "closed" && status !== "cancelled";
    });

    if (openFulfillmentOrders.length === 0) {
      return res.status(200).json({ data: [], code: 0, message: "success" });
    }

    const existingFulfillment =
      (order.fulfillments || []).find((f) => f.status !== "cancelled") || null;

    const tracking_info = {
      number: trackingNumber || null,
      company: trackingCompany || null,
      url: trackingUrl || null
    };

    const line_items_by_fulfillment_order = openFulfillmentOrders.map((fo) => ({
      fulfillment_order_id: fo.id,
      fulfillment_order_line_items: (fo.line_items || []).map((li) => ({
        id: li.id,
        quantity: li.quantity
      }))
    }));

    if (!existingFulfillment) {
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

      await shopifyFetch(`/fulfillments.json`, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      return res.status(200).json({ data: [], code: 0, message: "success" });
    }

    const updatePayload = {
      fulfillment: {
        notify_customer: true,
        tracking_info
      }
    };

    await shopifyFetch(`/fulfillments/${existingFulfillment.id}.json`, {
      method: "PUT",
      body: JSON.stringify(updatePayload)
    });

    return res.status(200).json({ data: [], code: 0, message: "success" });
  } catch (err) {
    console.error("[wooacry-shipping-webhook ERROR]", err);
    // Still return non-0? Docs show success response. For failures, surface HTTP error to help you debug.
    return res.status(err.status || 500).json({ error: err.message || "Server error", details: err.details || null });
  }
}

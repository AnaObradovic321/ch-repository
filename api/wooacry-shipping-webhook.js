const SHOPIFY_STORE = process.env.SHOPIFY_STORE_HANDLE || "characterhub-merch-store";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";
const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

const WOOACRY_WEBHOOK_SECRET = process.env.WOOACRY_WEBHOOK_SECRET;

const WOO_SUCCESS = { data: [], code: 0, message: "success" };

// If you want Wooacry to treat failures as failures while still returning 200,
// you can flip this to a non-zero code. Default keeps it simple.
function wooError(message, code = 0) {
  return { data: [], code, message: message || "success" };
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
    // ignore non-json
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
    if (req.method !== "POST") return res.status(200).json(WOO_SUCCESS);
    if (!SHOPIFY_TOKEN) {
      console.error("[wooacry-shipping-webhook] Missing SHOPIFY_ADMIN_API_TOKEN");
      return res.status(200).json(WOO_SUCCESS);
    }

    if (WOOACRY_WEBHOOK_SECRET) {
      const provided =
        req.headers["x-wooacry-secret"] ||
        req.headers["x-webhook-secret"] ||
        req.query.secret;

      if (String(provided || "") !== String(WOOACRY_WEBHOOK_SECRET)) {
        console.error("[wooacry-shipping-webhook] Unauthorized: bad secret");
        return res.status(200).json(WOO_SUCCESS);
      }
    }

    const body = normalizeWooacryBody(req);

    const thirdPartyOrderSn = body?.third_party_order_sn;
    if (!thirdPartyOrderSn) {
      console.error("[wooacry-shipping-webhook] Missing third_party_order_sn");
      return res.status(200).json(WOO_SUCCESS);
    }

    // IMPORTANT: You set third_party_order_sn = Shopify order.id during order creation.
    // So use it directly and do not regex-extract digits.
    const orderId = String(thirdPartyOrderSn).trim();
    if (!/^\d+$/.test(orderId)) {
      console.error("[wooacry-shipping-webhook] third_party_order_sn is not a numeric Shopify order id", {
        third_party_order_sn: thirdPartyOrderSn
      });
      return res.status(200).json(WOO_SUCCESS);
    }

    const express = body?.express || {};
    const trackingNumber = String(express?.express_number || "").trim();
    const trackingCompany =
      String(express?.express_company_name || "").trim() ||
      String(express?.express_company || "").trim() ||
      "Carrier";

    const shippingStatus = Number(express?.shipping_status || 0);

    const trackingUrl = trackingNumber
      ? `https://t.17track.net/en#nums=${encodeURIComponent(trackingNumber)}`
      : "";

    // Gate fulfillment creation:
    // Only create a fulfillment when we have tracking OR status indicates picked up/in transit.
    const canCreateFulfillment = Boolean(trackingNumber) || shippingStatus >= 10;

    const orderData = await shopifyFetch(`/orders/${orderId}.json`);
    const order = orderData?.order;
    if (!order) {
      console.error("[wooacry-shipping-webhook] Shopify order not found", { orderId });
      return res.status(200).json(WOO_SUCCESS);
    }

    const foData = await shopifyFetch(`/orders/${orderId}/fulfillment_orders.json`);
    const fulfillmentOrders = foData?.fulfillment_orders || [];
    const openFulfillmentOrders = fulfillmentOrders.filter((fo) => {
      const status = String(fo.status || "").toLowerCase();
      return status !== "closed" && status !== "cancelled";
    });

    if (openFulfillmentOrders.length === 0) {
      return res.status(200).json(WOO_SUCCESS);
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

    // If there's no fulfillment yet and we don't have enough signal that it's shipped, do nothing.
    if (!existingFulfillment && !canCreateFulfillment) {
      return res.status(200).json(WOO_SUCCESS);
    }

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

      return res.status(200).json(WOO_SUCCESS);
    }

    // Update existing fulfillment tracking.
    // Avoid spamming customer emails on repeated webhook updates.
    const updatePayload = {
      fulfillment: {
        notify_customer: false,
        tracking_info
      }
    };

    await shopifyFetch(`/fulfillments/${existingFulfillment.id}.json`, {
      method: "PUT",
      body: JSON.stringify(updatePayload)
    });

    return res.status(200).json(WOO_SUCCESS);
  } catch (err) {
    console.error("[wooacry-shipping-webhook ERROR]", err);
    // Keep Wooacry response format to avoid breaking webhook expectations.
    return res.status(200).json(WOO_SUCCESS);
  }
}

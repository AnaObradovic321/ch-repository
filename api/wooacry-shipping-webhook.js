const SHOPIFY_STORE =
  process.env.SHOPIFY_STORE_HANDLE ||
  process.env.SHOPIFY_SHOP_HANDLE ||
  "";

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";
const SHOPIFY_ADMIN_API = SHOPIFY_STORE
  ? `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`
  : "";

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || "";
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";

const WOOACRY_WEBHOOK_SECRET = process.env.WOOACRY_WEBHOOK_SECRET || "";

const WOO_SUCCESS = { data: [], code: 0, message: "success" };

let cachedShopifyToken = "";
let cachedShopifyTokenExpiresAt = 0;

async function getShopifyAccessToken() {
  if (!SHOPIFY_STORE || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    throw new Error("Missing Shopify client credential env vars");
  }

  const now = Date.now();

  // Refresh a little early to avoid edge expiry failures
  if (cachedShopifyToken && cachedShopifyTokenExpiresAt > now + 60 * 1000) {
    return cachedShopifyToken;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", SHOPIFY_CLIENT_ID);
  body.set("client_secret", SHOPIFY_CLIENT_SECRET);

  const resp = await fetch(`https://${SHOPIFY_STORE}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: body.toString()
  });

  const text = await resp.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok || !json?.access_token) {
    throw new Error(
      `Failed to fetch Shopify access token (${resp.status}): ${text || resp.statusText}`
    );
  }

  const expiresIn = Number(json.expires_in || 0);
  cachedShopifyToken = String(json.access_token);
  cachedShopifyTokenExpiresAt = now + Math.max(expiresIn, 60) * 1000;

  return cachedShopifyToken;
}

async function shopifyFetch(path, options = {}) {
  const token = await getShopifyAccessToken();

  const resp = await fetch(`${SHOPIFY_ADMIN_API}${path}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await resp.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
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

function getProvidedWebhookSecret(req) {
  return (
    req.headers["x-wooacry-secret"] ||
    req.headers["x-webhook-secret"] ||
    req.query.secret ||
    ""
  );
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json(WOO_SUCCESS);
    }

    if (!SHOPIFY_STORE || !SHOPIFY_ADMIN_API || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
      console.error("[wooacry-shipping-webhook] Missing Shopify client credential env vars");
      return res.status(200).json(WOO_SUCCESS);
    }

    if (WOOACRY_WEBHOOK_SECRET) {
      const provided = String(getProvidedWebhookSecret(req)).trim();
      if (!provided || provided !== String(WOOACRY_WEBHOOK_SECRET).trim()) {
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
    const traces = Array.isArray(express?.traces) ? express.traces : [];

    const trackingUrl = trackingNumber
      ? `https://t.17track.net/en#nums=${encodeURIComponent(trackingNumber)}`
      : "";

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
    } else {
      const existingTrackingNumber = String(existingFulfillment?.tracking_number || "").trim();
      const existingTrackingCompany = String(existingFulfillment?.tracking_company || "").trim();

      const trackingChanged =
        trackingNumber !== existingTrackingNumber ||
        trackingCompany !== existingTrackingCompany;

      if (trackingChanged) {
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
      }
    }

    void shippingStatus;
    void traces;

    return res.status(200).json(WOO_SUCCESS);
  } catch (err) {
    console.error("[wooacry-shipping-webhook ERROR]", err);
    return res.status(200).json(WOO_SUCCESS);
  }
}

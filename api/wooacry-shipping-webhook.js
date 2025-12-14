// api/wooacry-shipping-webhook.js

/**
 * Wooacry -> Shopify Shipping Webhook Handler
 *
 * Wooacry "Shipping Notice" (per their API doc):
 * - Request Method: POST
 * - Partner provides the request URL
 * - Payload includes:
 *   - third_party_order_sn (this is what WE sent when creating the order; we use Shopify order.id)
 *   - express: { express_number, express_company_name, shipping_status, traces... }
 *
 * Wooacry "Response Example" shows:
 * { "data": {}, "code": 0 }
 *
 * So we return that on success.
 */

const SHOPIFY_STORE = "characterhub-merch-store";
const SHOPIFY_API_VERSION = "2024-01";
const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// Wooacry shipping_status mapping per their doc
const SHIPPING_STATUS_MAP = {
  1: "awaiting_pickup",
  2: "delivery_suspended",
  10: "picked_up",
  15: "in_transit",
  20: "out_for_delivery",
  25: "delivered",
  30: "returned",
  35: "lost",
  40: "undeliverable",
  45: "rejected",
  50: "returned_to_sender"
};

function okResponse(res) {
  return res.status(200).json({ data: {}, code: 0 });
}

function errorResponse(res, httpStatus, message, extra = {}) {
  // Non-200 helps Wooacry retry if they do retries on failure.
  return res.status(httpStatus).json({
    data: {},
    code: 1,
    message,
    ...extra
  });
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
  } catch (e) {
    // keep raw
  }

  return { resp, text, json };
}

async function getOrder(orderId) {
  const { resp, json, text } = await shopifyFetch(`/orders/${orderId}.json`, {
    method: "GET"
  });

  if (!resp.ok || !json?.order) {
    throw new Error(
      `Failed to load Shopify order ${orderId}. HTTP ${resp.status}. Body: ${text?.slice(0, 500)}`
    );
  }

  return json.order;
}

async function getFulfillmentOrders(orderId) {
  const { resp, json, text } = await shopifyFetch(
    `/orders/${orderId}/fulfillment_orders.json`,
    { method: "GET" }
  );

  if (!resp.ok || !json?.fulfillment_orders) {
    throw new Error(
      `Failed to load fulfillment_orders for order ${orderId}. HTTP ${resp.status}. Body: ${text?.slice(0, 500)}`
    );
  }

  return json.fulfillment_orders;
}

function findBestExistingFulfillment(order, trackingNumber) {
  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  const active = fulfillments.filter((f) => f.status !== "cancelled");

  if (active.length === 0) return null;

  if (trackingNumber) {
    // Shopify can store tracking_number as string and/or tracking_numbers array
    const match = active.find((f) => {
      const tn = f.tracking_number;
      const tns = Array.isArray(f.tracking_numbers) ? f.tracking_numbers : [];
      return tn === trackingNumber || tns.includes(trackingNumber);
    });
    if (match) return match;
  }

  // If there is one active fulfillment, update that.
  if (active.length === 1) return active[0];

  // Otherwise pick the most recent active fulfillment
  return active[0];
}

async function createFulfillment(orderId, trackingInfo, notifyCustomer) {
  const fulfillmentOrders = await getFulfillmentOrders(orderId);

  // Prefer open fulfillment orders
  const openFOs = fulfillmentOrders.filter(
    (fo) => fo.status !== "closed" && fo.status !== "cancelled"
  );

  const targetFOs = openFOs.length > 0 ? openFOs : fulfillmentOrders;

  if (targetFOs.length === 0) {
    throw new Error(`No fulfillment orders available for Shopify order ${orderId}`);
  }

  const payload = {
    fulfillment: {
      notify_customer: !!notifyCustomer,
      tracking_info: trackingInfo,
      line_items_by_fulfillment_order: targetFOs.map((fo) => ({
        fulfillment_order_id: fo.id
      }))
    }
  };

  const { resp, json, text } = await shopifyFetch(`/fulfillments.json`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  if (!resp.ok || !json?.fulfillment) {
    throw new Error(
      `Failed to create fulfillment. HTTP ${resp.status}. Body: ${text?.slice(0, 800)}`
    );
  }

  return json.fulfillment;
}

async function updateFulfillment(fulfillmentId, trackingInfo, notifyCustomer) {
  const payload = {
    fulfillment: {
      notify_customer: !!notifyCustomer,
      tracking_info: trackingInfo
    }
  };

  const { resp, json, text } = await shopifyFetch(`/fulfillments/${fulfillmentId}.json`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });

  if (!resp.ok || !json?.fulfillment) {
    throw new Error(
      `Failed to update fulfillment ${fulfillmentId}. HTTP ${resp.status}. Body: ${text?.slice(0, 800)}`
    );
  }

  return json.fulfillment;
}

export default async function handler(req, res) {
  // Wooacry Shipping Notice is POST
  if (req.method !== "POST") {
    return errorResponse(res, 405, "Method Not Allowed. Use POST.");
  }

  if (!SHOPIFY_TOKEN) {
    return errorResponse(res, 500, "Missing SHOPIFY_ADMIN_API_TOKEN env var.");
  }

  try {
    const body = req.body || {};

    console.log("[WOOACRY SHIPPING WEBHOOK RECEIVED]", JSON.stringify(body));

    const thirdPartyOrderSn = body.third_party_order_sn;

    if (!thirdPartyOrderSn || String(thirdPartyOrderSn).trim() === "") {
      return errorResponse(res, 400, "Missing third_party_order_sn");
    }

    // We set third_party_order_sn = Shopify order.id (numeric). Use it directly.
    const shopifyOrderId = String(thirdPartyOrderSn).replace(/[^0-9]/g, "");

    if (!shopifyOrderId) {
      return errorResponse(res, 400, "third_party_order_sn did not contain a valid Shopify order id", {
        third_party_order_sn: thirdPartyOrderSn
      });
    }

    const express = body.express || {};
    const trackingNumber = express.express_number || null;

    // Wooacry provides both express_company and express_company_name in examples
    const trackingCompany =
      express.express_company_name ||
      express.express_company ||
      "Carrier";

    // You do not get a guaranteed carrier URL from Wooacry, so use a universal tracker.
    const trackingUrl = trackingNumber
      ? `https://t.17track.net/en#nums=${encodeURIComponent(trackingNumber)}`
      : null;

    const shippingStatusCode = Number(express.shipping_status);
    const shippingStatus =
      SHIPPING_STATUS_MAP[shippingStatusCode] || "in_transit";

    console.log("[WOOACRY SHIPPING]", {
      shopifyOrderId,
      trackingNumber,
      trackingCompany,
      trackingUrl,
      shippingStatusCode,
      shippingStatus
    });

    // If Wooacry has not assigned a tracking number yet, do NOT create a Shopify fulfillment.
    // This avoids "fulfilled" orders with no tracking.
    if (!trackingNumber) {
      console.log("[WOOACRY SHIPPING] No tracking number yet. Acknowledging without fulfillment.");
      return okResponse(res);
    }

    // Load Shopify order
    const order = await getOrder(shopifyOrderId);

    const trackingInfo = {
      number: trackingNumber,
      company: trackingCompany,
      url: trackingUrl
    };

    // If fulfillment exists, update it. Otherwise create.
    const existingFulfillment = findBestExistingFulfillment(order, trackingNumber);

    if (!existingFulfillment) {
      console.log("[FULFILLMENT] None exists. Creating new fulfillment.");
      await createFulfillment(shopifyOrderId, trackingInfo, true);
      return okResponse(res);
    }

    console.log("[FULFILLMENT] Exists. Updating fulfillment:", existingFulfillment.id);
    await updateFulfillment(existingFulfillment.id, trackingInfo, true);

    return okResponse(res);
  } catch (err) {
    console.error("[WOOACRY SHIPPING WEBHOOK ERROR]", err);
    return errorResponse(res, 500, err.message);
  }
}
/**
 * Wooacry → Shopify Shipping Webhook Handler
 *
 * Wooacry calls this endpoint whenever:
 * - A package is created
 * - A tracking number is assigned
 * - A shipping status is updated
 *
 * This webhook will:
 * 1. Look up the Shopify order by Wooacry's `third_party_order_sn`
 * 2. Create a fulfillment if none exists
 * 3. Update fulfillment tracking if it already exists
 * 4. Notify customer via Shopify email
 */

const SHOPIFY_STORE = "characterhub-merch-store";
const SHOPIFY_API_VERSION = "2024-01";
const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}`;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// Optional mapping Wooacry status → human readable status
const STATUS_MAP = {
  1: "pending",
  10: "in_transit",
  15: "in_transit",
  20: "out_for_delivery",
  25: "delivered",
  30: "returned",
  35: "lost",
  40: "undeliverable",
  45: "rejected",
  50: "returned_to_sender"
};

export default async function handler(req, res) {
  try {
    const body = req.body;

    console.log("[WOOACRY SHIPPING WEBHOOK RECEIVED]", body);

    if (!body || !body.third_party_order_sn) {
      return res.status(400).json({ error: "Missing third_party_order_sn" });
    }

    // Shopify order number is numeric
    const shopifyOrderId = body.third_party_order_sn.replace(/[^0-9]/g, "");
    const express = body.express || {};

    const tracking_number = express.express_number || null;
    const tracking_company = express.express_company_name || "Carrier";
    const tracking_url = tracking_number
      ? `https://t.17track.net/en#nums=${tracking_number}`
      : null;

    const shipping_status = STATUS_MAP[express.shipping_status] || "in_transit";

    // ------------------------------------------------------------------
    // STEP 1: Load Shopify Order
    // ------------------------------------------------------------------
    const orderResp = await fetch(
      `${SHOPIFY_ADMIN_API}/orders/${shopifyOrderId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const orderData = await orderResp.json();

    if (!orderData || !orderData.order) {
      console.error("[ERROR] Shopify order not found:", shopifyOrderId);
      return res.status(404).json({ error: "Shopify order not found" });
    }

    const order = orderData.order;

    // If fulfillment exists, update it
    const existingFulfillment =
      order.fulfillments?.find((f) => f.status !== "cancelled") || null;

    // ------------------------------------------------------------------
    // STEP 2A: Create a New Fulfillment
    // ------------------------------------------------------------------
    if (!existingFulfillment) {
      console.log("[FULFILLMENT] None exists → creating new fulfillment");

      const payload = {
        fulfillment: {
          notify_customer: true,
          tracking_info: {
            number: tracking_number,
            company: tracking_company,
            url: tracking_url
          },
          line_items_by_fulfillment_order: order.fulfillment_orders.map((fo) => ({
            fulfillment_order_id: fo.id
          }))
        }
      };

      const createResp = await fetch(
        `${SHOPIFY_ADMIN_API}/fulfillments.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_TOKEN,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      const createJSON = await createResp.json();
      console.log("[FULFILLMENT CREATED]", createJSON);

      return res.status(200).json({
        ok: true,
        action: "created",
        status: shipping_status,
        data: createJSON
      });
    }

    // ------------------------------------------------------------------
    // STEP 2B: Update Existing Fulfillment
    // ------------------------------------------------------------------
    console.log("[FULFILLMENT] Exists → updating fulfillment");

    const payload = {
      fulfillment: {
        notify_customer: true,
        tracking_info: {
          number: tracking_number,
          company: tracking_company,
          url: tracking_url
        }
      }
    };

    const updateResp = await fetch(
      `${SHOPIFY_ADMIN_API}/fulfillments/${existingFulfillment.id}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const updateJSON = await updateResp.json();
    console.log("[FULFILLMENT UPDATED]", updateJSON);

    return res.status(200).json({
      ok: true,
      action: "updated",
      status: shipping_status,
      data: updateJSON
    });

  } catch (err) {
    console.error("[WOOACRY SHIPPING WEBHOOK ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

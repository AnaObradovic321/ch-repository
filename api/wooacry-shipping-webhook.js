// api/wooacry-shipping-webhook.js

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

/**
 * Wooacry → Shopify Fulfillment Updater
 * This endpoint is called by Wooacry when:
 * - package created
 * - tracking number assigned
 * - shipping status updates
 */

const SHOPIFY_STORE = "characterhub-merch-store";
const SHOPIFY_ADMIN_API = `https://${SHOPIFY_STORE}.myshopify.com/admin/api/2024-01`;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// Map Wooacry → Shopify shipping status (optional enhancement)
const STATUS_MAP = {
  1: "pending",
  10: "in_transit",
  15: "in_transit",
  20: "out_for_delivery",
  25: "delivered"
};

export default async function handler(req, res) {
  try {
    const body = req.body;
    console.log("[WOOACRY SHIPPING WEBHOOK]", body);

    if (!body || !body.third_party_order_sn) {
      return res.status(400).json({ error: "Missing third_party_order_sn" });
    }

    const shopifyOrderId = body.third_party_order_sn.replace(/[^0-9]/g, "");

    const express = body.express || {};
    const tracking_number = express.express_number || null;
    const tracking_company = express.express_company_name || "Carrier";
    const tracking_url = express.express_number
      ? `https://t.17track.net/en#nums=${express.express_number}`
      : null;

    // -------------------------------------------
    // 1. Fetch Shopify order
    // -------------------------------------------
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
    const lineItemIds = order.line_items.map((li) => li.id);

    // -------------------------------------------
    // 2. Check if fulfillment already exists
    // -------------------------------------------
    let existingFulfillment = null;

    if (order.fulfillments && order.fulfillments.length > 0) {
      existingFulfillment = order.fulfillments.find((f) => f.status !== "cancelled");
    }

    // -------------------------------------------
    // 3A. CREATE a new fulfillment
    // -------------------------------------------
    if (!existingFulfillment) {
      const createPayload = {
        fulfillment: {
          tracking_info: {
            number: tracking_number,
            url: tracking_url,
            company: tracking_company
          },
          notify_customer: true,
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
          body: JSON.stringify(createPayload)
        }
      );

      const createJSON = await createResp.json();
      console.log("[FULFILLMENT CREATED]", createJSON);

      return res.status(200).json({ ok: true, action: "created", data: createJSON });
    }

    // -------------------------------------------
    // 3B. UPDATE existing fulfillment
    // -------------------------------------------
    const fulfillmentId = existingFulfillment.id;

    const updatePayload = {
      fulfillment: {
        tracking_info: {
          number: tracking_number,
          url: tracking_url,
          company: tracking_company
        },
        notify_customer: true
      }
    };

    const updateResp = await fetch(
      `${SHOPIFY_ADMIN_API}/fulfillments/${fulfillmentId}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updatePayload)
      }
    );

    const updateJSON = await updateResp.json();
    console.log("[FULFILLMENT UPDATED]", updateJSON);

    return res.status(200).json({ ok: true, action: "updated", data: updateJSON });

  } catch (err) {
    console.error("[WOOACRY SHIPPING WEBHOOK ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

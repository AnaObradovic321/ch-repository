import crypto from "crypto";
import { validateWooacryAddress } from "./wooacry-utils.js";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const WOOACRY_VERSION = "1";

/* -------------------------------------------------------
   Remove undefined/null to ensure deterministic signature
------------------------------------------------------- */
function clean(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* -------------------------------------------------------
   Build Wooacry MD5 signature (5 lines)
------------------------------------------------------- */
function buildSign(bodyString, timestamp) {
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${WOOACRY_VERSION}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

/* -------------------------------------------------------
   Wooacry: /customize/info
------------------------------------------------------- */
async function getCustomizeInfo(customize_no) {
  const body = clean({ customize_no });
  const bodyString = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = buildSign(bodyString, timestamp);

  const resp = await fetch(
    "https://api-new.wooacry.com/api/reseller/open/customize/info",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Reseller-Flag": RESELLER_FLAG,
        "Timestamp": String(timestamp),
        "Version": WOOACRY_VERSION,
        "Sign": sign
      },
      body: bodyString
    }
  );

  return resp.json();
}

/* -------------------------------------------------------
   Main handler: Shopify Order Created → Wooacry Manufacturing
------------------------------------------------------- */
export default async function handler(req, res) {
  try {
    const order = req.body;

    if (!order || !order.id) {
      console.error("[SHOPIFY ORDER] Missing payload");
      return res.status(400).json({ error: "Invalid order webhook" });
    }

    console.log("➡ New Shopify Order:", order.id);

    const third_party_order_sn = String(order.id);
    const createdAt =
      order.created_at || order.processed_at || new Date().toISOString();

    const third_party_order_created_at = Math.floor(
      new Date(createdAt).getTime() / 1000
    );

    const third_party_user = order.email || "guest";

    /* -------------------------------------------------------
       Extract all Wooacry custom items
    ------------------------------------------------------- */
    const wooItems = [];

    for (const item of order.line_items) {
      if (!item.properties) continue;

      const customize_no = item.properties.customize_no;

      if (customize_no) {
        wooItems.push({
          customize_no: String(customize_no),
          count: item.quantity
        });
      }
    }

    if (wooItems.length === 0) {
      console.log("No custom Wooacry items → ignoring");
      return res.status(200).json({ ok: true });
    }

    console.log("Wooacry Items Found:", wooItems);

    /* -------------------------------------------------------
       Normalize address
    ------------------------------------------------------- */
    const a = order.shipping_address;

    let addr = validateWooacryAddress({
      first_name: a.first_name || "",
      last_name: a.last_name || "",
      phone: a.phone || "",
      country_code: (a.country_code || "").toUpperCase(),
      province: a.province || "",
      city: a.city || "",
      address1: a.address1 || "",
      address2: a.address2 || "",
      post_code: a.zip || "",
      tax_number: a.tax_number || ""
    });

    Object.keys(addr).forEach((k) => {
      addr[k] = String(addr[k] || "");
    });

    const taxCountries = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];
    if (taxCountries.includes(addr.country_code) && !addr.tax_number) {
      return res.status(400).json({
        error: "Missing tax_number for destination country",
        country: addr.country_code
      });
    }

    /* -------------------------------------------------------
       Wooacry: fetch all customize/info (mockups + sku info)
    ------------------------------------------------------- */
    let customizeInfoList = [];

    for (const w of wooItems) {
      const info = await getCustomizeInfo(w.customize_no);

      if (!info || info.code !== 0) {
        console.error("❌ customize/info failed:", info);
      } else {
        customizeInfoList.push(info.data);
      }
    }

    console.log("Customize Info:", customizeInfoList);

    /* -------------------------------------------------------
       STEP 1: /order/create/pre
    ------------------------------------------------------- */
    const preBody = clean({
      third_party_user,
      skus: wooItems,
      address: addr
    });

    const preString = JSON.stringify(preBody);
    const preTimestamp = Math.floor(Date.now() / 1000);
    const preSign = buildSign(preString, preTimestamp);

    const preResp = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create/pre",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Reseller-Flag": RESELLER_FLAG,
          "Timestamp": String(preTimestamp),
          "Version": WOOACRY_VERSION,
          "Sign": preSign
        },
        body: preString
      }
    );

    const preJSON = await preResp.json();
    console.log("Preorder Resp:", preJSON);

    if (!preJSON || preJSON.code !== 0) {
      return res.status(500).json({ error: "Preorder failed", preJSON });
    }

    // pick cheapest shipping method
    const shipping_method_id =
      preJSON.data.shipping_methods.sort(
        (a, b) => a.postal_amount - b.postal_amount
      )[0].id;

    /* -------------------------------------------------------
       STEP 2: /order/create
    ------------------------------------------------------- */
    const createBody = clean({
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus: wooItems,
      address: addr
    });

    const createString = JSON.stringify(createBody);
    const createTimestamp = Math.floor(Date.now() / 1000);
    const createSign = buildSign(createString, createTimestamp);

    const createResp = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Reseller-Flag": RESELLER_FLAG,
          "Timestamp": String(createTimestamp),
          "Version": WOOACRY_VERSION,
          "Sign": createSign
        },
        body: createString
      }
    );

    const createJSON = await createResp.json();
    console.log("Wooacry Order Created:", createJSON);

    if (!createJSON || createJSON.code !== 0) {
      return res.status(500).json({ error: "Order Create Failed", createJSON });
    }

    /* -------------------------------------------------------
       Save Wooacry order SN to Shopify metafield
    ------------------------------------------------------- */
    await fetch(
      `https://characterhub-merch-store.myshopify.com/admin/api/2024-01/orders/${order.id}/metafields.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          metafield: {
            namespace: "wooacry",
            key: "order_sn",
            value: createJSON.data.order_sn,
            type: "single_line_text"
          }
        })
      }
    );

    return res.status(200).json({
      ok: true,
      wooacry_order_sn: createJSON.data.order_sn,
      customize_info: customizeInfoList
    });
  } catch (err) {
    console.error("FATAL PIPELINE ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

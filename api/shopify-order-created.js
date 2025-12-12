import crypto from "crypto";
import { validateWooacryAddress } from "./wooacry-utils.js";

/* ----------------------------------------
   CONFIG
---------------------------------------- */
const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const WOOACRY_VERSION = "1";
const SHOPIFY_STORE = "characterhub-merch-store";

/* ----------------------------------------
   CLEAN JSON – removes undefined/null 
   guarantees deterministic signature
---------------------------------------- */
function clean(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ----------------------------------------
   SIGNATURE BUILDER (5-line MD5)
---------------------------------------- */
function buildSign(bodyString, timestamp) {
  const sigString =
    `${RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${WOOACRY_VERSION}\n` +
    `${bodyString}\n` +
    `${SECRET}\n`;

  return crypto.createHash("md5").update(sigString).digest("hex");
}

/* ----------------------------------------
   Wooacry CUSTOMIZE / INFO
---------------------------------------- */
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

/* ----------------------------------------
   MAIN SHOPIFY ORDER → WOOACRY PIPELINE
---------------------------------------- */
export default async function handler(req, res) {
  try {
    const order = req.body;

    if (!order || !order.id) {
      return res.status(400).json({ error: "Invalid Shopify webhook payload" });
    }

    console.log("[SHOPIFY ORDER] Received:", order.id);

    const third_party_order_sn = String(order.id);
    const createdAt =
      order.created_at ||
      order.processed_at ||
      new Date().toISOString();

    const third_party_order_created_at = Math.floor(
      new Date(createdAt).getTime() / 1000
    );
    const third_party_user = order.email || "guest";

    const addr = order.shipping_address;
    if (!addr) {
      return res.status(200).json({ ok: true, reason: "no_shipping_address" });
    }

    /* ----------------------------------------
       Extract all Wooacry custom items
    ---------------------------------------- */
    const wooacryItems = order.line_items.filter(
      (item) => item.properties && item.properties.customize_no
    );

    if (wooacryItems.length === 0) {
      return res.status(200).json({ ok: true, reason: "no_wooacry_items" });
    }

    const skus = wooacryItems.map((item) => ({
      customize_no: String(item.properties.customize_no),
      count: parseInt(item.quantity, 10) || 1
    }));

    console.log("[WOOACRY] Found items:", skus);

    /* ----------------------------------------
       Normalize address
    ---------------------------------------- */
    let normalizedAddress = validateWooacryAddress({
      first_name: addr.first_name || "",
      last_name: addr.last_name || "",
      phone: addr.phone || "",
      country_code: (addr.country_code || "").toUpperCase(),
      province: addr.province || "",
      city: addr.city || "",
      address1: addr.address1 || "",
      address2: addr.address2 || "",
      post_code: addr.zip || "",
      tax_number: addr.tax_number || ""
    });

    Object.keys(normalizedAddress).forEach((key) => {
      normalizedAddress[key] = String(normalizedAddress[key] || "");
    });

    const requiresTaxID = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];
    if (
      requiresTaxID.includes(normalizedAddress.country_code) &&
      !normalizedAddress.tax_number
    ) {
      return res.status(400).json({
        error: "Missing tax_number for country requiring it",
        country: normalizedAddress.country_code
      });
    }

    /* ----------------------------------------
       CALL /customize/info
    ---------------------------------------- */
    let customizeInfoList = [];

    for (const entry of skus) {
      const info = await getCustomizeInfo(entry.customize_no);

      if (!info || info.code !== 0) {
        console.error("[WOOACRY CUSTOMIZE INFO ERROR]", info);
      } else {
        customizeInfoList.push(info.data);
      }
    }

    console.log("[WOOACRY CUSTOMIZE INFO]", customizeInfoList);

    /* ----------------------------------------
       STEP 1: PREORDER
    ---------------------------------------- */
    const preorderBody = clean({
      third_party_user,
      skus,
      address: normalizedAddress
    });

    const preorderString = JSON.stringify(preorderBody);
    const preorderTimestamp = Math.floor(Date.now() / 1000);
    const preorderSign = buildSign(preorderString, preorderTimestamp);

    const preResp = await fetch(
      "https://api-new.wooacry.com/api/reseller/open/order/create/pre",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Reseller-Flag": RESELLER_FLAG,
          "Timestamp": String(preorderTimestamp),
          "Version": WOOACRY_VERSION,
          "Sign": preorderSign
        },
        body: preorderString
      }
    );

    const preJSON = await preResp.json();
    console.log("[WOOACRY PREORDER]", preJSON);

    if (!preJSON || preJSON.code !== 0) {
      return res.status(500).json({ error: "Preorder failed", details: preJSON });
    }

    const shipping_method_id =
      preJSON.data.shipping_methods[0].id;

    /* ----------------------------------------
       STEP 2: CREATE MANUFACTURING ORDER
    ---------------------------------------- */
    const createBody = clean({
      third_party_order_sn,
      third_party_order_created_at,
      third_party_user,
      shipping_method_id,
      skus,
      address: normalizedAddress
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
    console.log("[WOOACRY ORDER CREATE]", createJSON);

    if (!createJSON || createJSON.code !== 0) {
      return res.status(500).json({
        error: "Wooacry create order failed",
        details: createJSON
      });
    }

    /* ============================================================
       SAVE MOCKUPS INTO SHOPIFY ORDER METAFIELD
    ============================================================ */
    try {
      const mockups = customizeInfoList
        .flatMap((entry) => entry.render_images || [])
        .filter(Boolean);

      if (mockups.length > 0) {
        console.log("[MOCKUPS → METAFIELD]", mockups);

        await fetch(
          `https://${SHOPIFY_STORE}.myshopify.com/admin/api/2024-01/orders/${order.id}/metafields.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_API_TOKEN
            },
            body: JSON.stringify({
              metafield: {
                namespace: "wooacry",
                key: "mockup_images",
                type: "json",
                value: JSON.stringify(mockups)
              }
            })
          }
        );
      }
    } catch (err) {
      console.error("[SHOPIFY METAFIELD ERROR]", err);
    }

    /* ----------------------------------------
       SUCCESS
    ---------------------------------------- */
    return res.status(200).json({
      ok: true,
      wooacry_order_sn: createJSON.data.order_sn,
      customize_info: customizeInfoList
    });

  } catch (err) {
    console.error("[WOOACRY PIPELINE ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

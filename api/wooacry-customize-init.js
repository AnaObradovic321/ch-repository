import {
  WOOACRY_RESELLER_FLAG,
  WOOACRY_EDITOR_BASE,
  generateTimestamp,
  buildEditorRedirectUrl
} from "./wooacry-utils.js";

const CALLBACK_STYLE = (process.env.WOOACRY_CALLBACK_STYLE || "query").toLowerCase();

const WOOACRY_PRODUCTS = {
  "001": "Custom Die-Cut Stickers",
  "002": "Custom Clear Acrylic Keychains",
  "003": "Custom Rainbow Acrylic Keychains",
  "004": "Custom Clear Acrylic Standees",
  "005": "Custom Rainbow Acrylic Standees",
  "006": "Custom Plush Badges",
  "007": "Custom Coated Paper Sticker Sheets",
  "008": "Custom Body Pillowcases",
  "009": "Custom Shaped Fridge Magnets",
  "010": "Custom Poster Printing"
};

const SPU_MAP = {
  // Shopify product_id : Wooacry product code
  "7503395029105": "001",
  "7536764846193": "002",
  "7536769433713": "003",
  "7536772317297": "004",
  "7551372951665": "010"
};

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function cleanUserId(x) {
  return String(x || "").trim();
}

function normalizeEmail(x) {
  const s = String(x || "").trim();
  return s ? s.toLowerCase() : "";
}

/**
 * third_party_user must be stable.
 * Best options:
 * - your internal user id
 * - customer email
 * - Shopify customer id
 *
 * Do not fall back to IP/user-agent hashes for production order flows.
 */
function getThirdPartyUser(req) {
  const explicit =
    req.query.third_party_user ||
    req.query.customer_email ||
    req.query.email ||
    req.query.user_id ||
    req.query.user;

  if (explicit) {
    const maybeEmail = normalizeEmail(explicit);
    return maybeEmail || cleanUserId(explicit);
  }

  const shopifyCustomerId =
    req.query.shopify_customer_id ||
    req.query.customer_id ||
    req.query.customer;

  if (shopifyCustomerId) {
    return `customer_${cleanUserId(shopifyCustomerId)}`;
  }

  throw new Error("Missing stable user identifier for third_party_user");
}

function buildCallbackUrl(baseUrl, product_id, variant_id) {
  if (CALLBACK_STYLE === "path") {
    let url = `${baseUrl}/api/wooacry-callback/${encodeURIComponent(String(product_id))}`;
    if (variant_id) {
      url += `/${encodeURIComponent(String(variant_id))}`;
    }
    return url;
  }

  let url =
    `${baseUrl}/api/wooacry-callback` +
    `?product_id=${encodeURIComponent(String(product_id))}`;

  if (variant_id) {
    url += `&variant_id=${encodeURIComponent(String(variant_id))}`;
  }

  return url;
}

export default async function handler(req, res) {
  try {
    if (!WOOACRY_RESELLER_FLAG) {
      return res.status(500).json({
        error: "Missing WOOACRY_RESELLER_FLAG env var"
      });
    }

    const { product_id, variant_id } = req.query;

    if (!product_id) {
      return res.status(400).json({
        error: "Missing product_id"
      });
    }

    const overrideSpu = req.query.third_party_spu || req.query.spu || null;
    const mappedSpu = SPU_MAP[String(product_id)];
    const third_party_spu = String(overrideSpu || mappedSpu || "").trim();

    if (!third_party_spu) {
      return res.status(500).json({
        error: `No Wooacry product code configured for Shopify product ${product_id}`,
        hint: "Add the Shopify product ID to SPU_MAP once that product is set up in Shopify."
      });
    }

    const timestamp = generateTimestamp();
    const third_party_user = getThirdPartyUser(req);

    const baseUrl = getBaseUrl(req);
    const redirectUrl = buildCallbackUrl(baseUrl, product_id, variant_id);

    const usePre = String(req.query.use_pre || "") === "1";
    const editorBase = usePre
      ? "https://preapi.wooacry.com"
      : WOOACRY_EDITOR_BASE;

    const finalUrl = buildEditorRedirectUrl({
      redirectUrl,
      thirdPartyUser: third_party_user,
      thirdPartySpu: third_party_spu,
      timestamp,
      baseUrl: editorBase
    });

    if (String(req.query.debug || "") === "1") {
      return res.status(200).json({
        reseller_flag: WOOACRY_RESELLER_FLAG,
        timestamp,
        redirect_url: redirectUrl,
        third_party_user,
        third_party_spu,
        wooacry_product_name: WOOACRY_PRODUCTS[third_party_spu] || null,
        finalUrl,
        using: usePre ? "preapi" : "api-new"
      });
    }

    return res.redirect(302, finalUrl);
  } catch (err) {
    console.error("[wooacry-customize-init ERROR]", err);
    return res.status(500).json({
      error: err?.message || "Unknown error"
    });
  }
}

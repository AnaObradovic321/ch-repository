import crypto from "crypto";

const RESELLER_FLAG = "characterhub";
const SECRET = "3710d71b1608f78948a60602c4a6d9d8";
const API_URL =
  "https://api-new.wooacry.com/api/reseller/web/editor/redirect";

export default async function handler(req, res) {
  try {
    const { product_id, variant_id } = req.query;

    if (!product_id || !variant_id) {
      return res.status(400).json({ error: "Missing product_id or variant_id" });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const version = "1";

    const third_party_user = "guest";
    const third_party_spu = product_id;

    const redirect_url =
      `https://characterhub-merch-store.myshopify.com/pages/wooacry-callback` +
      `?product_id=${product_id}` +
      `&variant_id=${variant_id}`;

    // Correct Wooacry rule: BODY MUST BE EMPTY STRING for GET redirect API
    const EMPTY_BODY = "";

    const sigString =
      `${RESELLER_FLAG}\n${timestamp}\n${version}\n${EMPTY_BODY}\n${SECRET}\n`;

    const sign = crypto

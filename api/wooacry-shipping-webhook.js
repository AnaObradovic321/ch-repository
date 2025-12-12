export default async function handler(req, res) {
  try {
    const payload = req.body;

    console.log("[WOOACRY SHIPPING UPDATE]", payload);

    // TODO: (optional)
    // Map Wooacry → Shopify fulfillment update here

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[WOOACRY SHIPPING WEBHOOK ERROR]", err);
    return res.status(500).json({ error: err.message });
  }
}

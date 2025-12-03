export default async function handler(req, res) {
  const shopifyOrder = req.body;

  console.log("Shopify order received:", shopifyOrder);

  // TODO: call Wooacry order/create API here

  return res.status(200).json({ ok: true });
}

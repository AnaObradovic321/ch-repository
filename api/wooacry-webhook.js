export default async function handler(req, res) {
  const shippingData = req.body;

  console.log("Wooacry shipping update:", shippingData);

  // TODO: update Shopify tracking number here

  return res.status(200).json({ success: true });
}

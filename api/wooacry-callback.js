export default async function handler(req, res) {
  const customize_no = req.query.customize_no;

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  // Redirect user to Shopify cart page with the customize_no saved as a property
  const redirectUrl = `https://characterhub-merch-store.myshopify.com/cart?properties[customize_no]=${customize_no}`;

  return res.redirect(302, redirectUrl);
}

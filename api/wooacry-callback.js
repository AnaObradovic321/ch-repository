export default async function handler(req, res) {
  const { customize_no, product_id, variant_id } = req.query;

  // PHASE 1: Wooacry loads the editor → no customize_no yet
  if (!customize_no) {
    return res.status(200).send("Wooacry editor initialized");
  }

  // PHASE 2: User finishes → Wooacry sends customize_no
  const redirectUrl =
    `https://characterhub-merch-store.myshopify.com/cart` +
    `?properties[customize_no]=${customize_no}`;

  return res.redirect(302, redirectUrl);
}

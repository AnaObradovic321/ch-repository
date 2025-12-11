export default async function handler(req, res) {
  try {
    const { customize_no } = req.query;

    // PHASE 1: Wooacry loads editor → callback is NOT triggered yet
    // The editor will only hit this URL after the user clicks “Finish”
    if (!customize_no || customize_no === "undefined" || customize_no === "null") {
      console.log("Callback hit without customize_no. Probably editor init.");
      return res.status(200).send("OK");
    }

    console.log("Wooacry customization finished. customize_no =", customize_no);

    // PHASE 2: User finishes → Wooacry sends customize_no
    // Now redirect to Shopify cart with customization attached
    const redirectUrl =
      `https://characterhub-merch-store.myshopify.com/cart` +
      `?properties[customize_no]=${customize_no}`;

    return res.redirect(302, redirectUrl);

  } catch (err) {
    console.error("Wooacry callback ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  console.log("Wooacry callback hit", req.query);

  const customize_no = req.query.customize_no;

  if (!customize_no) {
    return res.status(400).json({ error: "Missing customize_no" });
  }

  // TODO: save customize_no to database OR log it
  console.log("Received customize_no:", customize_no);

  return res.status(200).json({ ok: true });
}

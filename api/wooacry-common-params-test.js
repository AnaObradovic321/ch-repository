// api/wooacry-common-params-test.js
import { buildHeaders, buildSignature } from "./wooacry-utils.js";

export default async function handler(req, res) {
  try {
    // Use a fixed body so you can compare it with the docs easily.
    const bodyObj = { customize_no: "test" };
    const raw = JSON.stringify(bodyObj);

    // Build headers exactly like your production calls do
    const headers = buildHeaders(raw);

    // Rebuild signature using the exact timestamp that buildHeaders produced
    const ts = Number(headers["Timestamp"]);
    const sign = buildSignature(raw, ts);

    // This proves the 5-line signature rule is being followed consistently.
    return res.status(200).json({
      ok: true,
      body_sent: raw,
      headers_required_by_doc: {
        "Content-Type": headers["Content-Type"],
        "Reseller-Flag": headers["Reseller-Flag"],
        "Timestamp": headers["Timestamp"],
        "Version": headers["Version"],
        "Sign": headers["Sign"]
      },
      sign_matches_recompute: headers["Sign"] === sign,
      server_time_seconds: Math.floor(Date.now() / 1000)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

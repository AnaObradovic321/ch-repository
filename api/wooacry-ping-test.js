// api/wooacry-ping-test.js
import { WOOACRY_API_BASE, buildHeaders, readWooacryJson } from "./wooacry-utils.js";

export default async function handler(req, res) {
  try {
    const bodyObj = { customize_no: "test" };
    const raw = JSON.stringify(bodyObj);

    // Use ANY Wooacry endpoint that exists and returns JSON.
    // customize/info is fine because it uses the common signature rules.
    const resp = await fetch(`${WOOACRY_API_BASE}/api/reseller/open/customize/info`, {
      method: "POST",
      headers: buildHeaders(raw),
      body: raw
    });

    const parsed = await readWooacryJson(resp);

    return res.status(200).json({
      ok: true,
      wooacry_http_status: resp.status,
      wooacry_json_parse_ok: parsed.ok,
      wooacry_response: parsed.ok ? parsed.json : parsed.raw.slice(0, 500)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

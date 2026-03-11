import crypto from "crypto";

/* ----------------------------------------
   Wooacry Credentials (ENV ONLY)
---------------------------------------- */
export const WOOACRY_RESELLER_FLAG = process.env.WOOACRY_RESELLER_FLAG || "";
export const WOOACRY_SECRET = process.env.WOOACRY_SECRET || "";
export const WOOACRY_VERSION = process.env.WOOACRY_VERSION || "1";

export const WOOACRY_API_BASE =
  process.env.WOOACRY_API_BASE ||
  process.env.WOOACRY_BASE ||
  "https://api-new.wooacry.com";

export const WOOACRY_EDITOR_BASE =
  process.env.WOOACRY_EDITOR_BASE || WOOACRY_API_BASE;

/**
 * Countries where tax_number must be non-empty
 * per Wooacry docs
 */
export const TAX_REQUIRED_COUNTRIES = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];

function assertWooacryConfig() {
  if (!WOOACRY_RESELLER_FLAG) throw new Error("Missing WOOACRY_RESELLER_FLAG env var");
  if (!WOOACRY_SECRET) throw new Error("Missing WOOACRY_SECRET env var");
  if (WOOACRY_VERSION !== "1") {
    throw new Error(`Invalid WOOACRY_VERSION "${WOOACRY_VERSION}". Wooacry docs require "1".`);
  }
}

/* ----------------------------------------
   Timestamp (seconds)
---------------------------------------- */
export function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/* ----------------------------------------
   API MD5 Signature (5-line exact per docs)
---------------------------------------- */
export function buildSignature(rawBodyString, timestamp) {
  assertWooacryConfig();

  const raw = String(rawBodyString ?? "");

  const signatureString =
    `${WOOACRY_RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${WOOACRY_VERSION}\n` +
    `${raw}\n` +
    `${WOOACRY_SECRET}\n`;

  return crypto.createHash("md5").update(signatureString).digest("hex");
}

/* ----------------------------------------
   Header builder for signed API requests
---------------------------------------- */
export function buildHeaders(rawBodyString, providedTimestamp) {
  assertWooacryConfig();

  const timestamp =
    typeof providedTimestamp === "number" ? providedTimestamp : generateTimestamp();

  const sign = buildSignature(rawBodyString, timestamp);

  return {
    "Content-Type": "application/json",
    "Reseller-Flag": WOOACRY_RESELLER_FLAG,
    "Timestamp": String(timestamp),
    "Version": WOOACRY_VERSION,
    "Sign": sign
  };
}

/* ----------------------------------------
   Build signed request parts from an object
   Prevents body/signature mismatch
---------------------------------------- */
export function buildSignedJsonRequest(bodyObj, providedTimestamp) {
  const raw = JSON.stringify(bodyObj);
  const headers = buildHeaders(raw, providedTimestamp);
  return { raw, headers };
}

/* ----------------------------------------
   Editor redirect signature
   reseller_flag=<flag>&timestamp=<ts>&third_party_user=<user>&secret=<secret>
---------------------------------------- */
export function buildEditorRedirectSignature(thirdPartyUser, timestamp) {
  assertWooacryConfig();

  const ts = typeof timestamp === "number" ? timestamp : generateTimestamp();
  const user = String(thirdPartyUser || "").trim();

  if (!user) throw new Error("Missing thirdPartyUser for Wooacry editor redirect");

  const signatureString =
    `reseller_flag=${WOOACRY_RESELLER_FLAG}` +
    `&timestamp=${ts}` +
    `&third_party_user=${user}` +
    `&secret=${WOOACRY_SECRET}`;

  return crypto.createHash("md5").update(signatureString).digest("hex");
}

/* ----------------------------------------
   Build full editor redirect URL
---------------------------------------- */
export function buildEditorRedirectUrl({
  redirectUrl,
  thirdPartyUser,
  thirdPartySpu,
  timestamp
}) {
  assertWooacryConfig();

  const ts = typeof timestamp === "number" ? timestamp : generateTimestamp();
  const redirect = String(redirectUrl || "").trim();
  const user = String(thirdPartyUser || "").trim();
  const spu = String(thirdPartySpu || "").trim();

  if (!redirect) throw new Error("Missing redirectUrl");
  if (!user) throw new Error("Missing thirdPartyUser");
  if (!spu) throw new Error("Missing thirdPartySpu");

  const sign = buildEditorRedirectSignature(user, ts);

  const url = new URL("/api/reseller/web/editor/redirect", WOOACRY_EDITOR_BASE);
  url.searchParams.set("reseller_flag", WOOACRY_RESELLER_FLAG);
  url.searchParams.set("timestamp", String(ts));
  url.searchParams.set("redirect_url", redirect);
  url.searchParams.set("third_party_spu", spu);
  url.searchParams.set("third_party_user", user);
  url.searchParams.set("sign", sign);

  return url.toString();
}

/* ----------------------------------------
   Tax number validation
---------------------------------------- */
export function validateWooacryTaxNumber(countryCode, taxNumber) {
  const cc = String(countryCode || "").toUpperCase().trim();
  const tn = String(taxNumber || "").trim();

  if (!TAX_REQUIRED_COUNTRIES.includes(cc)) return;

  if (!tn) throw new Error(`tax_number is required for orders shipped to ${cc}`);

  if (cc === "TR" || cc === "AR") {
    if (!/^\d{11}$/.test(tn)) throw new Error(`tax_number for ${cc} must be 11 digits`);
  }

  if (cc === "MX") {
    if (!/^(\d{12}|\d{13}|\d{18})$/.test(tn)) {
      throw new Error("tax_number for MX must be 12, 13, or 18 digits");
    }
  }

  if (cc === "KR") {
    if (!/^P\d{12}$/.test(tn)) {
      throw new Error('tax_number for KR must match "P" + 12 digits');
    }
  }
}

/* ----------------------------------------
   Address normalizer
---------------------------------------- */
function requireNonEmptyString(value, fieldName) {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`Missing or empty field: ${fieldName}`);
  return s;
}

export function normalizeWooacryAddress(address) {
  if (!address || typeof address !== "object") {
    throw new Error("Invalid address: must be an object");
  }

  const country_code = requireNonEmptyString(address.country_code, "address.country_code")
    .toUpperCase()
    .trim();

  if (!/^[A-Z]{2}$/.test(country_code)) {
    throw new Error(`Invalid country_code (expected ISO-2): ${country_code}`);
  }

  const normalized = {
    first_name: requireNonEmptyString(address.first_name, "address.first_name"),
    last_name: requireNonEmptyString(address.last_name, "address.last_name"),
    phone: requireNonEmptyString(address.phone, "address.phone"),
    country_code,
    province: requireNonEmptyString(address.province, "address.province"),
    city: requireNonEmptyString(address.city, "address.city"),
    address1: requireNonEmptyString(address.address1, "address.address1"),
    address2: String(address.address2 ?? ""),
    post_code: requireNonEmptyString(address.post_code, "address.post_code"),
    tax_number: String(address.tax_number ?? "")
  };

  validateWooacryTaxNumber(normalized.country_code, normalized.tax_number);

  return normalized;
}

/* ----------------------------------------
   Safe Wooacry JSON read helper
---------------------------------------- */
export async function readWooacryJson(resp) {
  const text = await resp.text();
  try {
    return { ok: true, json: JSON.parse(text), raw: text };
  } catch {
    return { ok: false, json: null, raw: text };
  }
}

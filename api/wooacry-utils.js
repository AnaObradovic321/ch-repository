import crypto from "crypto";

/* ----------------------------------------
   Wooacry Credentials (ENV ONLY)
---------------------------------------- */
export const WOOACRY_RESELLER_FLAG =
  process.env.WOOACRY_RESELLER_FLAG || "characterhub";

export const WOOACRY_SECRET = process.env.WOOACRY_SECRET; // REQUIRED
export const WOOACRY_VERSION = process.env.WOOACRY_VERSION || "1";

export const WOOACRY_API_BASE =
  process.env.WOOACRY_API_BASE ||
  process.env.WOOACRY_BASE ||
  "https://api-new.wooacry.com";

/**
 * Countries where tax_number must be non-empty (Wooacry docs list)
 */
export const TAX_REQUIRED_COUNTRIES = ["TR", "MX", "CL", "BR", "ZA", "KR", "AR"];

function assertSecrets() {
  if (!WOOACRY_SECRET) throw new Error("Missing WOOACRY_SECRET env var");
}

/* ----------------------------------------
   Timestamp (seconds)
---------------------------------------- */
export function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/* ----------------------------------------
   MD5 Signature (5-line exact per docs)
---------------------------------------- */
export function buildSignature(rawBodyString, timestamp) {
  assertSecrets();

  const signatureString =
    `${WOOACRY_RESELLER_FLAG}\n` +
    `${timestamp}\n` +
    `${WOOACRY_VERSION}\n` +
    `${rawBodyString}\n` +
    `${WOOACRY_SECRET}\n`;

  return crypto.createHash("md5").update(signatureString).digest("hex");
}

/* ----------------------------------------
   Header builder
   NOTE: Body must match exactly what is signed
---------------------------------------- */
export function buildHeaders(rawBodyString, providedTimestamp) {
  assertSecrets();

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
   Tax number validation (minimal, doc-aligned)
   Docs specify digit lengths for some countries and KR format.
---------------------------------------- */
export function validateWooacryTaxNumber(countryCode, taxNumber) {
  const cc = String(countryCode || "").toUpperCase().trim();
  const tn = String(taxNumber || "").trim();

  if (!TAX_REQUIRED_COUNTRIES.includes(cc)) return;

  if (!tn) throw new Error(`tax_number is required for orders shipped to ${cc}`);

  // Doc-specific stricter checks where format is explicitly specified
  if (cc === "TR" || cc === "AR") {
    if (!/^\d{11}$/.test(tn)) throw new Error(`tax_number for ${cc} must be 11 digits`);
  }

  if (cc === "MX") {
    if (!/^(\d{12}|\d{13}|\d{18})$/.test(tn)) {
      throw new Error("tax_number for MX must be 12, 13, or 18 digits");
    }
  }

  if (cc === "KR") {
    // Docs: “P” + 12 digits
    if (!/^P\d{12}$/.test(tn)) {
      throw new Error('tax_number for KR must match "P" + 12 digits (example: P123456789012)');
    }
    // Docs also say authenticity must be verified. That is typically done by Wooacry downstream.
  }
}

/* ----------------------------------------
   Address normalizer (doc-aligned)
   Required non-empty fields:
   first_name, last_name, phone, country_code, province, city, address1, post_code
   Required keys (may be empty strings): address2, tax_number
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

  // Keep validation permissive: Wooacry will validate actual supported destinations.
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
    // Docs require address2 key; allow empty string if user has no unit/apt
    address2: String(address.address2 ?? ""),
    post_code: requireNonEmptyString(address.post_code, "address.post_code"),
    // Docs require tax_number key; may be empty except certain countries
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

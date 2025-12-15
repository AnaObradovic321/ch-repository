import crypto from "crypto";

/* ----------------------------------------
   Wooacry Credentials (ENV ONLY)
---------------------------------------- */
export const WOOACRY_RESELLER_FLAG =
  process.env.WOOACRY_RESELLER_FLAG || "characterhub";

export const WOOACRY_SECRET = process.env.WOOACRY_SECRET; // REQUIRED
export const WOOACRY_VERSION = process.env.WOOACRY_VERSION || "1";

function assertSecrets() {
  if (!WOOACRY_SECRET) {
    throw new Error("Missing WOOACRY_SECRET env var");
  }
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
   Pass timestamp if you want full control
---------------------------------------- */
export function buildHeaders(rawBodyString, providedTimestamp) {
  assertSecrets();

  const timestamp =
    typeof providedTimestamp === "number"
      ? providedTimestamp
      : generateTimestamp();

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
   Wooacry allowed country codes
---------------------------------------- */
export const WOOACRY_COUNTRY_CODES = new Set([
  "AF","AX","AL","DZ","AS","AD","AO","AI","AQ","AG","AR","AM","AW","AU","AT",
  "AZ","BS","BH","BD","BB","BY","BE","PW","BZ","BJ","BM","BT","BO","BQ","BA",
  "BW","BV","BR","IO","BN","BG","BF","BI","KH","CM","CA","CV","KY","CF","TD",
  "CL","CN","CX","CC","CO","KM","CG","CD","CK","CR","HR","CU","CW","CY","CZ",
  "DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","ET","FK","FO","FJ","FI",
  "FR","GF","PF","TF","GA","GM","GE","DE","GH","GI","GR","GL","GD","GP","GU",
  "GT","GG","GN","GW","GY","HT","HM","HN","HK","HU","IS","IN","ID","IR","IQ",
  "IE","IM","IL","IT","CI","JM","JP","JE","JO","KZ","KE","KI","KW","KG","LA",
  "LV","LB","LS","LR","LY","LI","LT","LU","MO","MK","MG","MW","MY","MV","ML",
  "MT","MH","MQ","MR","MU","YT","MX","FM","MD","MC","MN","ME","MS","MA","MZ",
  "MM","NA","NR","NP","NL","NC","NZ","NI","NE","NG","NU","NF","MP","KP","NO",
  "OM","PK","PS","PA","PG","PY","PE","PH","PN","PL","PT","PR","QA","RE","RO",
  "RU","RW","BL","SH","KN","LC","MF","SX","PM","VC","SM","ST","SA","SN","RS",
  "SC","SL","SG","SK","SI","SB","SO","ZA","GS","KR","SS","ES","LK","SD","SR",
  "SJ","SZ","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TK","TO","TT","TN",
  "TR","TM","TC","TV","UG","UA","AE","GB","US","UM","UY","UZ","VU","VA","VE",
  "VN","VG","VI","WF","EH","WS","YE","ZM","ZW"
]);

/* ----------------------------------------
   Address Normalizer (STRICT)
   Do NOT silently change country, that breaks shipping quotes.
---------------------------------------- */
export function validateWooacryAddress(address) {
  if (!address || typeof address !== "object") {
    throw new Error("Invalid address object: must be an object");
  }

  const code = (address.country_code || "").toUpperCase().trim();
  if (!WOOACRY_COUNTRY_CODES.has(code)) {
    throw new Error(`Invalid country_code: ${code || "(empty)"}`);
  }

  return {
    first_name: address.first_name || "",
    last_name: address.last_name || "",
    phone: address.phone || "",
    country_code: code,
    province: address.province || "",
    city: address.city || "",
    address1: address.address1 || "",
    address2: address.address2 || "",
    post_code: address.post_code || "",
    tax_number: address.tax_number || ""
  };
}

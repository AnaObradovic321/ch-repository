import crypto from "crypto";

/* ----------------------------------------
   Wooacry Credentials
---------------------------------------- */
export const WOOACRY_RESELLER_FLAG = "characterhub";
export const WOOACRY_SECRET = "3710d71b1608f78948a60602c4a6d9d8";
export const WOOACRY_VERSION = "1";

/* ----------------------------------------
   Timestamp
---------------------------------------- */
export function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/* ----------------------------------------
   MD5 Signature (5-line exact)
---------------------------------------- */
export function buildSignature(rawBodyString, timestamp) {
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
---------------------------------------- */
export function buildHeaders(rawBodyString) {
  const timestamp = generateTimestamp();
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
   Address Validator (SAFEST VERSION)
---------------------------------------- */
export function validateWooacryAddress(address) {
  if (!address || typeof address !== "object") {
    throw new Error("Invalid address object: must be an object");
  }

  // Normalize
  const code = (address.country_code || "").toUpperCase().trim();

  // If Wooacry does not recognize the code → fallback to US (safe default)
  const finalCode = WOOACRY_COUNTRY_CODES.has(code) ? code : "US";

  return {
    first_name: address.first_name || "",
    last_name: address.last_name || "",
    phone: address.phone || "",
    country_code: finalCode,
    province: address.province || "",
    city: address.city || "",
    address1: address.address1 || "",
    address2: address.address2 || "",
    post_code: address.post_code || "",
    tax_number: address.tax_number || ""
  };
}

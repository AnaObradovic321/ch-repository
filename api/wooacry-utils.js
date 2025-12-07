import crypto from "crypto";

export const WOOACRY_RESELLER_FLAG = "characterhub";
export const WOOACRY_SECRET = "3710d71b1608f78948a60602c4a6d9d8";
export const WOOACRY_VERSION = "1";

export function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

// JSON must be stable — ensures correct signature every time
export function stableJSONStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

export function buildSignature(rawBodyString, timestamp) {
  const signatureString =
    WOOACRY_RESELLER_FLAG + "\n" +
    timestamp + "\n" +
    WOOACRY_VERSION + "\n" +
    rawBodyString + "\n" +
    WOOACRY_SECRET + "\n";

  return crypto.createHash("md5").update(signatureString).digest("hex");
}

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

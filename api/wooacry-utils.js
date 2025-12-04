import crypto from "crypto";

export const WOOACRY_RESELLER_FLAG = "characterhub";
export const WOOACRY_SECRET = "3710d71b1608f78948a60602c4a6d9d8"; // provided by Wooacry
export const WOOACRY_VERSION = "1";

export function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

export function buildSignature(body, timestamp) {
  const bodyString = JSON.stringify(body);

  const signatureString =
    WOOACRY_RESELLER_FLAG + "\n" +
    timestamp + "\n" +
    WOOACRY_VERSION + "\n" +
    bodyString + "\n" +
    WOOACRY_SECRET + "\n";

  return crypto.createHash("md5").update(signatureString).digest("hex");
}

// Build headers for Wooacry API
export function buildHeaders(body) {
  const timestamp = generateTimestamp();
  const sign = buildSignature(body, timestamp);

  return {
    "Content-Type": "application/json",
    "Reseller-Flag": WOOACRY_RESELLER_FLAG,
    "Timestamp": timestamp,
    "Version": WOOACRY_VERSION,
    "Sign": sign
  };
}

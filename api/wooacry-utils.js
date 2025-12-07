import crypto from "crypto";

export const WOOACRY_RESELLER_FLAG = "characterhub";
export const WOOACRY_SECRET = "3710d71b1608f78948a60602c4a6d9d8";
export const WOOACRY_VERSION = "1";

export function generateTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Builds MD5 signature EXACTLY as Wooacry documentation requires.
 * Uses the RAW JSON STRING (the exact body that will be sent).
 */
export function buildSignature(rawBodyString, timestamp) {
  const signatureString =
    WOOACRY_RESELLER_FLAG + "\n" +
    timestamp + "\n" +
    WOOACRY_VERSION + "\n" +
    rawBodyString + "\n" +
    WOOACRY_SECRET + "\n";

  return crypto.createHash("md5").update(signatureString).digest("hex");
}

/**
 * Builds request headers using the raw JSON string.
 * This ensures the signature ALWAYS matches the actual outgoing request.
 */
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

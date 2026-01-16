import crypto from "crypto";

export function base64URLEncode(buff: Buffer) {
  return buff
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function sha256(buffer: string) {
  return crypto.createHash("sha256").update(buffer).digest();
}

export function generatePkcePair() {
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));
  return { codeVerifier, codeChallenge };
}

import { createHmac } from "node:crypto";

export function nationalIdHash(nationalId: string): string {
  const secret = process.env.NATIONAL_ID_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("NATIONAL_ID_SECRET must contain at least 32 bytes.");
  }
  const normalized = nationalId.trim().toUpperCase().replace(/[\s-]+/g, "");
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

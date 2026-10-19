import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function encryptWebhook(url: string, secret: string) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(`careerpilot-slack:${secret}`).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString("base64")).join(".");
}

export function decryptWebhook(value: string, secret: string) {
  const [iv, tag, encrypted] = value.split(".").map(part => Buffer.from(part, "base64"));
  const key = createHash("sha256").update(`careerpilot-slack:${secret}`).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

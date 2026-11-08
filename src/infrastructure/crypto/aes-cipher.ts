import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { TokenCipher } from "@/modules/shared/ports";

/** AES-256-GCM; output is base64url `iv.tag.ciphertext`. */
export class AesGcmCipher implements TokenCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 16) throw new Error("Encryption secret must have at least 16 characters");
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
  }

  decrypt(value: string): string {
    const parts = value.split(".");
    if (parts.length !== 3) throw new Error("Malformed ciphertext");
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}

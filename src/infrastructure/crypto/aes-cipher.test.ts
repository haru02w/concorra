import { describe, expect, it } from "vitest";
import { AesGcmCipher } from "./aes-cipher";

describe("AesGcmCipher", () => {
  const cipher = new AesGcmCipher("a-very-long-test-secret");

  it("round-trips with a random IV", () => {
    const a = cipher.encrypt("token ç");
    expect(a).not.toBe(cipher.encrypt("token ç"));
    expect(a.split(".")).toHaveLength(3);
    expect(cipher.decrypt(a)).toBe("token ç");
  });

  it("throws on tampering, malformed input or wrong key", () => {
    const [iv, tag, data] = cipher.encrypt("secret").split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(() => cipher.decrypt([iv, tag, flipped.toString("base64url")].join("."))).toThrow();
    expect(() => cipher.decrypt("nope")).toThrow();
    expect(() => new AesGcmCipher("another-long-secret!").decrypt(cipher.encrypt("x"))).toThrow();
    expect(() => new AesGcmCipher("short")).toThrow();
  });
});

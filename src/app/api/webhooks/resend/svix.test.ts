import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySvix } from "./svix";

const key = Buffer.from("super-secret-key-bytes");
const secret = `whsec_${key.toString("base64")}`;
const now = 1_800_000_000_000;
const ts = String(now / 1000);
const body = '{"type":"email.bounced"}';
const sign = (b: string, t = ts, k = key) => `v1,${createHmac("sha256", k).update(`msg_1.${t}.${b}`).digest("base64")}`;

describe("verifySvix", () => {
  it("accepts a valid signature (also among several)", () => {
    expect(verifySvix({ secret, id: "msg_1", timestamp: ts, signature: sign(body), body, now })).toBe(true);
    expect(verifySvix({ secret, id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sign(body)}`, body, now })).toBe(true);
  });
  it("rejects tampered bodies, wrong keys and missing headers", () => {
    expect(verifySvix({ secret, id: "msg_1", timestamp: ts, signature: sign(body), body: body + " ", now })).toBe(false);
    expect(verifySvix({ secret, id: "msg_1", timestamp: ts, signature: sign(body, ts, Buffer.from("other")), body, now })).toBe(false);
    expect(verifySvix({ secret, id: null, timestamp: ts, signature: sign(body), body, now })).toBe(false);
  });
  it("rejects old timestamps", () => {
    const old = String(now / 1000 - 600);
    expect(verifySvix({ secret, id: "msg_1", timestamp: old, signature: sign(body, old), body, now })).toBe(false);
  });
});

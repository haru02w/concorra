import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3FileStorage } from "./s3-storage";

const options = {
  bucket: "concorra",
  endpoint: "http://rustfs:9000",
  publicEndpoint: "https://files.example.com",
  region: "us-east-1",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

function make(send: (cmd: unknown) => unknown) {
  const client = { send: vi.fn(async (cmd: unknown) => send(cmd)) };
  return { storage: new S3FileStorage(options, { client: client as never }), client };
}

describe("S3FileStorage", () => {
  it("puts, gets and deletes objects", async () => {
    const { storage, client } = make((cmd) =>
      cmd instanceof GetObjectCommand ? { Body: { transformToByteArray: async () => new Uint8Array([7]) } } : {},
    );
    await storage.put("a/b.pdf", new Uint8Array([1]), "application/pdf");
    expect([...(await storage.get("a/b.pdf"))]).toEqual([7]);
    await storage.delete("a/b.pdf");
    const [put, get, del] = client.send.mock.calls.map((c) => c[0]);
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect((put as PutObjectCommand).input).toEqual(expect.objectContaining({ Bucket: "concorra", Key: "a/b.pdf", ContentType: "application/pdf" }));
    expect(get).toBeInstanceOf(GetObjectCommand);
    expect(del).toBeInstanceOf(DeleteObjectCommand);
  });

  it("creates the bucket only when missing", async () => {
    const missing = make((cmd) => {
      if (cmd instanceof HeadBucketCommand) throw Object.assign(new Error("nf"), { name: "NotFound" });
      return {};
    });
    await missing.storage.ensureBucket();
    expect(missing.client.send.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);

    const exists = make(() => ({}));
    await exists.storage.ensureBucket();
    expect(exists.client.send).toHaveBeenCalledTimes(1);

    const denied = make(() => {
      throw Object.assign(new Error("denied"), { name: "AccessDenied" });
    });
    await expect(denied.storage.ensureBucket()).rejects.toThrow("denied");
  });

  it("presigns against the public endpoint with a download name", async () => {
    const { storage } = make(() => ({}));
    const url = new URL(await storage.presignGet("orgs/1/x.pdf", 300, "Certidão federal.pdf"));
    expect(url.origin).toBe("https://files.example.com");
    expect(url.pathname).toBe("/concorra/orgs/1/x.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-disposition")).toContain("Certid%C3%A3o");
  });
});

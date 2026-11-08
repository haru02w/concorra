import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { JsZipArchiver } from "./jszip-archiver";

describe("JsZipArchiver", () => {
  it("zips files with folders", async () => {
    const bytes = await new JsZipArchiver().zip([
      { name: "a.md", bytes: new TextEncoder().encode("# A") },
      { name: "pasta/b.pdf", bytes: new Uint8Array([1, 2, 3]) },
    ]);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file("a.md")!.async("string")).toBe("# A");
    expect([...(await zip.file("pasta/b.pdf")!.async("uint8array"))]).toEqual([1, 2, 3]);
  });
});

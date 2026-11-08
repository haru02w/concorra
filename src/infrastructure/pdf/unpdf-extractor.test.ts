import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UnpdfTextExtractor } from "./unpdf-extractor";

const hasPandoc = (() => {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasPandoc)("UnpdfTextExtractor", () => {
  it("extracts text per page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "concorra-pdf-"));
    try {
      const out = join(dir, "t.pdf");
      execFileSync("pandoc", ["-o", out, "--pdf-engine=pdflatex"], {
        input: "Primeira página do edital\n\n\\newpage\n\nHabilitação na segunda página\n",
      });
      const pages = await new UnpdfTextExtractor().extractPages(new Uint8Array(readFileSync(out)));
      expect(pages).toHaveLength(2);
      expect(pages[0]).toContain("Primeira");
      expect(pages[1]).toContain("segunda");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

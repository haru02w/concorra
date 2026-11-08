/**
 * Tiny PDF writer for mock editais and test fixtures: one Helvetica text page
 * per entry (WinAnsi), no dependencies. `meta` is stored in the Info dictionary.
 */

const WIN_ANSI_EXTRA: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
};

function encodeText(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let byte = WIN_ANSI_EXTRA[ch] ?? (code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out.push(0x5c); // ( ) \
    if (byte === 0x0a || byte === 0x0d) byte = 0x20;
    out.push(byte);
  }
  return out;
}

function wrap(text: string, width = 92): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if ((line + " " + word).trim().length > width) {
        lines.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    lines.push(line);
  }
  return lines;
}

export function buildPdf(pages: string[], meta: Record<string, string> = {}): Uint8Array {
  const chunks: number[] = [];
  const offsets: number[] = [];
  const push = (s: string | number[]) => {
    if (typeof s === "string") for (const c of Buffer.from(s, "latin1")) chunks.push(c);
    else chunks.push(...s);
  };
  const objects: (string | number[])[][] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const infoId = 4 + pages.length * 2;

  objects.push(["<< /Type /Catalog /Pages 2 0 R >>"]);
  objects.push([`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`]);
  objects.push(["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]);
  for (const [i, page] of pages.entries()) {
    const content: number[] = [...Buffer.from("BT /F1 10 Tf 14 TL 50 800 Td\n", "latin1")];
    for (const line of wrap(page)) content.push(0x28, ...encodeText(line), ...Buffer.from(") Tj T*\n", "latin1"));
    content.push(...Buffer.from("ET", "latin1"));
    objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`]);
    objects.push([`<< /Length ${content.length} >>\nstream\n`, content, "\nendstream"]);
  }
  const info = Object.entries({ Producer: "Concorra mock", ...meta }).map(([k, v]) => `/${k} (${v.replace(/[()\\]/g, "")})`);
  objects.push([`<< ${info.join(" ")} >>`]);

  push("%PDF-1.4\n");
  objects.forEach((parts, i) => {
    offsets.push(chunks.length);
    push(`${i + 1} 0 obj\n`);
    for (const part of parts) push(part);
    push("\nendobj\n");
  });
  const xref = chunks.length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Uint8Array.from(chunks);
}

/** Mock "scanned" PDF: blank pages whose text is hidden in the Info dictionary for the OCR mock. */
export function buildScannedPdf(pages: string[]): Uint8Array {
  return buildPdf(pages.map(() => ""), { ConcorraOcr: Buffer.from(JSON.stringify(pages), "utf8").toString("base64") });
}

export function readScannedPdfText(bytes: Uint8Array): string[] | null {
  const match = /\/ConcorraOcr \(([A-Za-z0-9+/=]+)\)/.exec(Buffer.from(bytes).toString("latin1"));
  return match ? (JSON.parse(Buffer.from(match[1], "base64").toString("utf8")) as string[]) : null;
}

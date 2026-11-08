import { extractText, getDocumentProxy } from "unpdf";
import type { PdfTextExtractor } from "@/application/ports";

export class UnpdfTextExtractor implements PdfTextExtractor {
  async extractPages(bytes: Uint8Array): Promise<string[]> {
    // pdf.js may transfer (detach) the buffer it receives; give it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const { text } = await extractText(pdf, { mergePages: false });
      return text;
    } finally {
      await pdf.cleanup();
    }
  }
}

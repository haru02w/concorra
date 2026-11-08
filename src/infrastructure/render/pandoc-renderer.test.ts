import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PandocRenderer } from "./pandoc-renderer";

const hasPandoc = (() => {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const markdown = `**LIMPA BEM COMÉRCIO LTDA**
CNPJ: 11.222.333/0001-81

# DECLARAÇÃO DE NÃO EMPREGO DE MENOR

Declaramos, sob as penas da lei, que não empregamos menores — ação & atenção 100% "aspas" $5.

| Item | Descrição | Valor |
|---:|---|---:|
| 1 | Detergente neutro | R$ 2,50 |

Vitória, 8 de novembro de 2026.

\\
\\
______________________________________
Maria Exemplo
`;

describe.skipIf(!hasPandoc)("PandocRenderer", () => {
  const renderer = new PandocRenderer({ concurrency: 1 });

  it("renders DOCX", async () => {
    const docx = await renderer.toDocx(markdown);
    expect(Buffer.from(docx.subarray(0, 2)).toString()).toBe("PK");
  });

  it("renders PDF with LaTeX, serializing concurrent calls", async () => {
    const [a, b] = await Promise.all([renderer.toPdf(markdown), renderer.toPdf("# Outro")]);
    expect(Buffer.from(a.subarray(0, 4)).toString()).toBe("%PDF");
    expect(Buffer.from(b.subarray(0, 4)).toString()).toBe("%PDF");
  }, 120_000);

  it("reports pandoc failures", async () => {
    await expect(new PandocRenderer({ bin: "/nonexistent/pandoc" }).toDocx("x")).rejects.toThrow();
  });
});

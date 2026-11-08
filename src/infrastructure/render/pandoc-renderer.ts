import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocumentRenderer } from "@/application/ports";

const PDF_ARGS = [
  "--pdf-engine=pdflatex",
  "-V", "geometry:margin=2.5cm",
  "-V", "lang=pt-BR",
  "-V", "fontsize=11pt",
  "-V", "documentclass=article",
];

/** Tiny FIFO semaphore: LaTeX is heavy, so cap concurrent renders. */
class Semaphore {
  private waiting: (() => void)[] = [];
  constructor(private available: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.available > 0) this.available--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.available++;
    }
  }
}

/** Markdown → DOCX / PDF via pandoc. Markdown goes through stdin, never a shell. */
export class PandocRenderer implements DocumentRenderer {
  private readonly semaphore: Semaphore;
  private readonly bin: string;
  private readonly timeoutMs: number;

  constructor(options: { bin?: string; concurrency?: number; timeoutMs?: number } = {}) {
    this.bin = options.bin ?? "pandoc";
    this.semaphore = new Semaphore(options.concurrency ?? 2);
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  toDocx(markdown: string): Promise<Uint8Array> {
    return this.render(markdown, "docx", []);
  }

  toPdf(markdown: string): Promise<Uint8Array> {
    return this.render(markdown, "pdf", PDF_ARGS);
  }

  private render(markdown: string, ext: "docx" | "pdf", extra: string[]): Promise<Uint8Array> {
    return this.semaphore.run(async () => {
      const dir = await mkdtemp(join(tmpdir(), "concorra-render-"));
      const out = join(dir, `out.${ext}`);
      try {
        await this.exec(["-f", "markdown", "-o", out, ...extra], markdown, dir);
        return new Uint8Array(await readFile(out));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  private exec(args: string[], input: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { cwd, stdio: ["pipe", "ignore", "pipe"], timeout: this.timeoutMs });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`pandoc failed (${signal ?? code}): ${stderr.slice(-2000)}`));
      });
      child.stdin.end(input, "utf8");
    });
  }
}

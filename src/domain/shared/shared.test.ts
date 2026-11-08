import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "./cnpj";
import { chunkText, maskPersonalData, normalizeText } from "./text";
import { parsePncpDateTime, toPncpDate, usagePeriod } from "./dates";
import { cosineSimilarity, l2normalize } from "./vector";

describe("cnpj", () => {
  it("validates check digits", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
  it("normalizes and formats", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(() => normalizeCnpj("123")).toThrow();
  });
});

describe("text", () => {
  it("normalizes accents and case", () => {
    expect(normalizeText("  Licitação  ÚNICA ")).toBe("licitacao unica");
  });
  it("chunks long text with overlap", () => {
    const text = Array.from({ length: 100 }, (_, i) => `Frase número ${i}.`).join(" ");
    const chunks = chunkText(text, 200, 50);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunkText("")).toEqual([]);
  });
  it("masks CPFs and agent names", () => {
    const masked = maskPersonalData("Pregoeiro: João da Silva Souza, CPF 123.456.789-09");
    expect(masked).not.toContain("João");
    expect(masked).not.toContain("123.456.789-09");
    expect(masked).toContain("Pregoeiro: [nome omitido]");
  });
});

describe("dates", () => {
  it("formats PNCP dates in Brasília time", () => {
    expect(toPncpDate(new Date("2026-11-09T02:00:00Z"))).toBe("20261108");
  });
  it("parses PNCP local timestamps as -03:00", () => {
    expect(parsePncpDateTime("2026-11-11T23:59:00")?.toISOString()).toBe("2026-11-12T02:59:00.000Z");
    expect(parsePncpDateTime("2026-11-11")?.toISOString()).toBe("2026-11-11T03:00:00.000Z");
    expect(parsePncpDateTime(null)).toBeNull();
    expect(parsePncpDateTime("garbage")).toBeNull();
  });
  it("computes usage period", () => {
    expect(usagePeriod(new Date("2026-11-30T12:00:00Z"))).toBe("2026-11");
  });
});

describe("vector", () => {
  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(l2normalize([3, 4])).toEqual([0.6, 0.8]);
  });
});

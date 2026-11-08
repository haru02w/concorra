import { describe, expect, it } from "vitest";
import { EDITAL_PAGES, makeDoc, makeExtraction } from "../fixtures";
import { applyCitationChecks, verifyCitation } from "./citations";
import { computeGaps, documentReadiness } from "./gaps";
import { computeFitScore, recommend } from "./score";

describe("verifyCitation", () => {
  it("accepts exact excerpts after normalization", () => {
    expect(verifyCitation({ fileId: "file-edital", page: 1, excerpt: "AQUISIÇÃO DE MATERIAL   DE LIMPEZA" }, EDITAL_PAGES)).toBe(true);
  });
  it("tolerates off-by-one pages", () => {
    expect(verifyCitation({ fileId: "file-edital", page: 2, excerpt: "aquisição de material de limpeza" }, EDITAL_PAGES)).toBe(true);
  });
  it("accepts fuzzy excerpts with minor differences", () => {
    expect(
      verifyCitation({ fileId: "file-edital", page: 3, excerpt: "prova da regularidade com a Fazenda Federal e Certificado de Regularidade do FGTS" }, EDITAL_PAGES),
    ).toBe(true);
  });
  it("rejects hallucinated excerpts, wrong files and empty citations", () => {
    expect(verifyCitation({ fileId: "file-edital", page: 1, excerpt: "garantia contratual de 5%" }, EDITAL_PAGES)).toBe(false);
    expect(verifyCitation({ fileId: "nope", page: 1, excerpt: "objeto" }, EDITAL_PAGES)).toBe(false);
    expect(verifyCitation(null, EDITAL_PAGES)).toBe(false);
  });
});

describe("applyCitationChecks", () => {
  it("marks fields and reports failures", () => {
    const extraction = makeExtraction();
    extraction.penalties = { value: "Multa de 50%", citation: { fileId: "file-edital", page: 5, excerpt: "multa de 50% ao dia" } };
    const report = applyCitationChecks(extraction, EDITAL_PAGES);
    expect(report.failedPaths).toEqual(["penalties"]);
    expect(extraction.objeto.verified).toBe(true);
    expect(extraction.requirements[0].verified).toBe(true);
    expect(extraction.penalties.verified).toBe(false);
    // null-valued fields are not counted
    expect(report.total).toBe(report.verifiedCount + 1);
  });
});

describe("computeGaps", () => {
  const deadline = new Date("2026-11-20T12:00:00Z");
  it("classifies have / expiring / missing / manual", () => {
    const gaps = computeGaps(
      makeExtraction().requirements,
      [makeDoc(), makeDoc({ id: "doc-2", kind: "crf_fgts", validUntil: new Date("2026-11-10T00:00:00Z") })],
      deadline,
    );
    expect(gaps.map((g) => g.status)).toEqual(["have", "expiring", "manual"]);
    expect(documentReadiness(gaps)).toBe(0.5);
  });
  it("ignores invalid documents", () => {
    const gaps = computeGaps(makeExtraction().requirements.slice(0, 1), [makeDoc({ status: "invalid" })], deadline);
    expect(gaps[0].status).toBe("missing");
  });
  it("readiness is 1 when nothing is document-backed", () => {
    expect(documentReadiness([])).toBe(1);
  });
});

describe("computeFitScore", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  it("is high for a well-fitting notice", () => {
    const { score, factors } = computeFitScore({
      similarity: 0.85,
      cnaeCompatible: true,
      noticeUf: "ES",
      orgUfs: ["ES"],
      noticeValue: 100000,
      orgValueMin: 1000,
      orgValueMax: 500000,
      documentReadiness: 1,
      deadline: new Date("2026-11-30T12:00:00Z"),
      now,
    });
    expect(score).toBe(100);
    expect(factors).toHaveLength(6);
    expect(factors.reduce((a, f) => a + f.weight, 0)).toBeCloseTo(1);
  });
  it("is low for a poor fit", () => {
    const { score } = computeFitScore({
      similarity: 0.3,
      cnaeCompatible: false,
      noticeUf: "SP",
      orgUfs: ["ES"],
      noticeValue: 1e9,
      orgValueMin: null,
      orgValueMax: 500000,
      documentReadiness: 0,
      deadline: new Date("2026-11-01T12:00:00Z"),
      now,
    });
    expect(score).toBe(0);
  });
});

describe("recommend", () => {
  it("skips when deadline passed or score low", () => {
    expect(recommend({ score: 90, deadlinePassed: true, highRisks: 0, missingDocs: 0 }).recommendation).toBe("skip");
    expect(recommend({ score: 30, deadlinePassed: false, highRisks: 0, missingDocs: 0 }).recommendation).toBe("skip");
  });
  it("participates on high score without high risks, else review", () => {
    expect(recommend({ score: 80, deadlinePassed: false, highRisks: 0, missingDocs: 1 }).recommendation).toBe("participate");
    expect(recommend({ score: 80, deadlinePassed: false, highRisks: 1, missingDocs: 0 }).recommendation).toBe("review");
    expect(recommend({ score: 55, deadlinePassed: false, highRisks: 0, missingDocs: 0 }).recommendation).toBe("review");
  });
});

import { describe, expect, it } from "vitest";
import { makeItem, makeNotice, makeRule } from "../fixtures";
import { EMPTY_FILTERS, evaluateRule, validateRule } from "./rule";

describe("evaluateRule", () => {
  const notice = makeNotice();
  const items = [makeItem()];

  it("matches keywords accent-insensitively within filters", () => {
    const r = evaluateRule(makeRule({ filters: { ...EMPTY_FILTERS, keywordsInclude: ["HIGIENE"], ufs: ["ES"] } }), notice, items, null);
    expect(r.matched).toBe(true);
    expect(r.reasons[0]).toContain("HIGIENE");
  });

  it("matches keywords in items", () => {
    const r = evaluateRule(makeRule({ filters: { ...EMPTY_FILTERS, keywordsInclude: ["detergente"] } }), notice, items, null);
    expect(r.matched).toBe(true);
  });

  it("requires whole-word keyword matches", () => {
    const r = evaluateRule(makeRule({ filters: { ...EMPTY_FILTERS, keywordsInclude: ["limp"] } }), notice, items, null);
    expect(r.matched).toBe(false);
  });

  it("rejects by exclude keyword, uf, modalidade, value and inactive", () => {
    const base = makeRule();
    expect(evaluateRule({ ...base, filters: { ...base.filters, keywordsExclude: ["escolas"] } }, notice, items, null).reasons).toEqual(["excluded-keyword"]);
    expect(evaluateRule({ ...base, filters: { ...base.filters, ufs: ["SP"] } }, notice, items, null).reasons).toEqual(["uf"]);
    expect(evaluateRule({ ...base, filters: { ...base.filters, modalidadeIds: [8] } }, notice, items, null).reasons).toEqual(["modalidade"]);
    expect(evaluateRule({ ...base, filters: { ...base.filters, valueMax: 1000 } }, notice, items, null).reasons).toEqual(["value-max"]);
    expect(evaluateRule({ ...base, filters: { ...base.filters, valueMin: 1e9 } }, notice, items, null).reasons).toEqual(["value-min"]);
    expect(evaluateRule({ ...base, filters: { ...base.filters, valueMin: 1 } }, makeNotice({ valorEstimado: null }), items, null).reasons).toEqual(["value-unknown"]);
    expect(evaluateRule({ ...base, active: false }, notice, items, null).reasons).toEqual(["inactive"]);
  });

  it("applies semantic threshold", () => {
    const rule = makeRule({ semanticThreshold: 0.7 });
    expect(evaluateRule(rule, notice, items, 0.69).matched).toBe(false);
    expect(evaluateRule(rule, notice, items, null).matched).toBe(false);
    expect(evaluateRule(rule, notice, items, 0.8).matched).toBe(true);
  });

  it("flags rules that need a score", () => {
    expect(evaluateRule(makeRule({ minScore: 60 }), notice, items, null).needsScore).toBe(true);
  });
});

describe("validateRule", () => {
  it("requires name, channel and at least one filter", () => {
    const rule = makeRule();
    expect(() => validateRule(rule)).not.toThrow();
    expect(() => validateRule({ ...rule, name: " " })).toThrow();
    expect(() => validateRule({ ...rule, channels: [] })).toThrow();
    expect(() => validateRule({ ...rule, filters: EMPTY_FILTERS })).toThrow();
    expect(() => validateRule({ ...rule, filters: { ...EMPTY_FILTERS, valueMin: 10, valueMax: 1 } })).toThrow();
    expect(() => validateRule({ ...rule, semanticThreshold: 2 })).toThrow();
    expect(() => validateRule({ ...rule, minScore: 101 })).toThrow();
    expect(() => validateRule({ ...rule, filters: EMPTY_FILTERS, semanticThreshold: 0.5 })).not.toThrow();
  });
});

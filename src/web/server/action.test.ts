import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { parseNumber } = await import("./action");

describe("parseNumber", () => {
  it("handles pt-BR and plain formats", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("R$ 2.500")).toBe(2500);
    expect(parseNumber("0,6")).toBe(0.6);
    expect(parseNumber("0.6")).toBe(0.6);
    expect(parseNumber("1234.5")).toBe(1234.5);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
});

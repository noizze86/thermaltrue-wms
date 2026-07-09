import { describe, it, expect } from "vitest";
import { cn, formatCurrency } from "../lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", "visible")).toBe("base visible");
  });

  it("handles tailwind conflict", () => {
    expect(cn("px-4", "px-2")).toBe("px-2");
  });
});

describe("formatCurrency", () => {
  it("formats number to IDR", () => {
    const result = formatCurrency(15000);
    expect(result).toContain("15");
    expect(result).toContain("000");
  });

  it("handles zero", () => {
    expect(formatCurrency(0)).toContain("0");
  });
});

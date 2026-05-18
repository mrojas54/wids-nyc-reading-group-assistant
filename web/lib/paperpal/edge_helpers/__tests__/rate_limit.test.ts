import { describe, it, expect } from "vitest";
import { cooldownMs } from "../rate_limit";

describe("cooldownMs", () => {
  it("returns the default (300_000 ms) when env value is undefined", () => {
    expect(cooldownMs(undefined)).toBe(300_000);
  });

  it("returns the default when env value is empty string", () => {
    expect(cooldownMs("")).toBe(300_000);
  });

  it("returns the default when env value is non-numeric", () => {
    // Common config mistake: typo, accidental quotes. Better to fall
    // back than to silently disable rate-limiting.
    expect(cooldownMs("five")).toBe(300_000);
    expect(cooldownMs("abc123")).toBe(300_000);
  });

  it("returns the default when env value is negative", () => {
    expect(cooldownMs("-30")).toBe(300_000);
  });

  it("returns the parsed value × 1000 for a valid positive integer", () => {
    expect(cooldownMs("30")).toBe(30_000);
    expect(cooldownMs("600")).toBe(600_000);
  });

  it("returns 0 (rate-limit disabled) when env value is '0'", () => {
    // Caller's `window > 0` guard in analyze-paper depends on 0 being
    // preserved — that's the documented escape hatch for dev/test.
    expect(cooldownMs("0")).toBe(0);
  });

  it("truncates non-integer values via parseInt", () => {
    // parseInt("30.7", 10) === 30 — fine, this is what we want.
    expect(cooldownMs("30.7")).toBe(30_000);
  });
});

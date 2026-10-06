import { describe, expect, it } from "vitest";
import { Rng } from "../src/rng";

describe("Rng", () => {
  it("is deterministic for a seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("stays in range", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it("resumes from saved state", () => {
    const a = new Rng(99);
    a.next();
    const b = Rng.fromState(a.getState());
    expect(a.next()).toBe(b.next());
  });
});

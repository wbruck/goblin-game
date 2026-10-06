import { describe, expect, it } from "vitest";
import { CatchUp } from "../src/catchup";
import { TICK_MS, World } from "../src/world";

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

describe("World", () => {
  it("is deterministic: same seed and inputs give the same state", () => {
    const a = World.create(123);
    const b = World.create(123);
    a.enqueue({ type: "placeIncentive", kind: "food", x: a.cave.x + 3, y: a.cave.y });
    b.enqueue({ type: "placeIncentive", kind: "food", x: b.cave.x + 3, y: b.cave.y });
    run(a, 2000);
    run(b, 2000);
    expect(JSON.stringify(a.toData())).toBe(JSON.stringify(b.toData()));
  });

  it("different seeds diverge", () => {
    const a = World.create(1);
    const b = World.create(2);
    run(a, 200);
    run(b, 200);
    expect(JSON.stringify(a.goblins)).not.toBe(JSON.stringify(b.goblins));
  });

  it("produces effort and hatches goblins over time", () => {
    const w = World.create(5);
    const start = w.goblins.length;
    run(w, 4 * 60 * 20); // 20 minutes of sim time
    expect(w.hoard.lifetimeEffort).toBeGreaterThan(0);
    expect(w.goblins.length).toBeGreaterThan(start);
  });

  it("round-trips through save data", () => {
    const w = World.create(77);
    run(w, 500);
    const saved = JSON.parse(JSON.stringify(w.toData()));
    const restored = World.fromData(saved);
    run(w, 300);
    run(restored, 300);
    expect(JSON.stringify(restored.toData())).toBe(JSON.stringify(w.toData()));
  });

  it("keeps goblins on walkable tiles", () => {
    const w = World.create(9);
    run(w, 1500);
    for (const g of w.goblins) expect(w.grid.isWalkable(g.x, g.y)).toBe(true);
  });

  it("charges effort for incentives and refuses when broke", () => {
    const w = World.create(3);
    w.hoard.nextHatchAt = 1_000_000;
    w.hoard.effort = 10;
    w.enqueue({ type: "placeIncentive", kind: "drum", x: w.cave.x + 2, y: w.cave.y });
    w.step();
    expect(w.incentives.length).toBe(0);
    expect(w.hoard.effort).toBe(10);
    w.hoard.effort = 100;
    w.enqueue({ type: "placeIncentive", kind: "drum", x: w.cave.x + 2, y: w.cave.y });
    w.step();
    expect(w.incentives.length).toBe(1);
    expect(w.hoard.effort).toBe(60);
  });
});

describe("CatchUp", () => {
  it("caps simulated time and reports the discard", () => {
    const w = World.create(11);
    const cap = 60 * 1000;
    const c = new CatchUp(w, 5 * 60 * 1000, cap);
    expect(c.totalTicks).toBe(cap / TICK_MS);
    const report = c.runAll();
    expect(report.simulatedMs).toBe(cap);
    expect(report.discardedMs).toBe(4 * 60 * 1000);
    expect(w.tick).toBe(cap / TICK_MS);
  });

  it("chunked and whole runs reach the same state", () => {
    const a = World.create(21);
    const b = World.create(21);
    new CatchUp(a, 30 * 60 * 1000).runAll();
    const c = new CatchUp(b, 30 * 60 * 1000);
    while (!c.run(97)) { /* chunk */ }
    expect(JSON.stringify(a.toData())).toBe(JSON.stringify(b.toData()));
    expect(c.report.effortGained).toBe(a.hoard.lifetimeEffort);
  });
});

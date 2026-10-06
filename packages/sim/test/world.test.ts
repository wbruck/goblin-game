import { describe, expect, it } from "vitest";
import { World } from "../src/world";

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
    expect(a.checksum()).toBe(b.checksum());
  });

  it("different seeds diverge", () => {
    const a = World.create(1);
    const b = World.create(2);
    run(a, 200);
    run(b, 200);
    expect(a.checksum()).not.toBe(b.checksum());
  });

  it("keeps every numeric goblin field an integer", () => {
    const w = World.create(5);
    run(w, 3000);
    for (const g of w.goblins) {
      for (const k of ["hunger", "energy", "mood", "greed", "bravery", "diligence", "carrying", "commitment"] as const) {
        expect(Number.isInteger(g[k]), `${k} on ${g.name}`).toBe(true);
      }
    }
  });

  it("produces effort and hatches goblins over time", () => {
    const w = World.create(5);
    const start = w.goblins.length;
    run(w, 4 * 60 * 20); // 20 minutes of game time
    expect(w.hoard.lifetimeEffort).toBeGreaterThan(0);
    expect(w.goblins.length).toBeGreaterThan(start);
  });

  it("round-trips through save data", () => {
    const w = World.create(77);
    run(w, 500);
    const saved = JSON.parse(JSON.stringify(w.toData()));
    const restored = World.fromData(saved);
    expect(restored.checksum()).toBe(w.checksum());
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

describe("history and replay", () => {
  it("records every applied command with its tick", () => {
    const w = World.create(8);
    run(w, 100);
    w.hoard.effort = 500;
    w.enqueue({ type: "placeIncentive", kind: "food", x: w.cave.x + 1, y: w.cave.y });
    w.step();
    run(w, 50);
    w.enqueue({ type: "placeIncentive", kind: "shiny", x: w.cave.x - 1, y: w.cave.y });
    w.step();
    expect(w.history.map((h) => h.tick)).toEqual([100, 151]);
    expect(w.history[1]?.command).toEqual({ type: "placeIncentive", kind: "shiny", x: w.cave.x - 1, y: w.cave.y });
  });

  it("replays seed plus history to the identical state", () => {
    const live = World.create(31337);
    const place = (kind: "food" | "shiny" | "drum", dx: number) =>
      live.enqueue({ type: "placeIncentive", kind, x: live.cave.x + dx, y: live.cave.y + 2 });
    run(live, 400);
    place("food", 3);
    run(live, 600);
    place("drum", -4);
    run(live, 900);
    place("shiny", 5);
    run(live, 1500);

    const replayed = World.replay(live.seed, live.history, live.tick);
    expect(replayed.tick).toBe(live.tick);
    expect(replayed.checksum()).toBe(live.checksum());
    expect(JSON.stringify(replayed.toData())).toBe(JSON.stringify(live.toData()));
  });

  it("checksum changes when a single command is altered", () => {
    const live = World.create(42);
    // Play until the hoard can afford a drum, so the command really takes effect.
    for (let i = 0; i < 20000 && live.hoard.effort < 40; i++) live.step();
    expect(live.hoard.effort).toBeGreaterThanOrEqual(40);
    live.enqueue({ type: "placeIncentive", kind: "drum", x: live.cave.x + 3, y: live.cave.y });
    run(live, 700);
    expect(live.history.length).toBe(1);

    const tampered = live.history.map((h) => ({ ...h, command: { ...h.command, x: h.command.x + 1 } }));
    const a = World.replay(live.seed, live.history, live.tick);
    const b = World.replay(live.seed, tampered, live.tick);
    expect(a.checksum()).toBe(live.checksum());
    expect(b.checksum()).not.toBe(live.checksum());
  });

  it("replay cost: 12 hours of game time stays under a sane budget", () => {
    const w = World.create(5);
    const t0 = Date.now();
    run(w, 12 * 60 * 60 * 4);
    const ms = Date.now() - t0;
    expect(w.tick).toBe(172_800);
    expect(ms).toBeLessThan(60_000);
  }, 90_000);
});

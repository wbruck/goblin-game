import { describe, expect, it } from "vitest";
import { Terrain, type Tile } from "../src/cube";
import { MOTIVES } from "../src/types";
import { FIRST_HATCH_AT, MAX_FOOD_PILES, WARREN_START, World } from "../src/world";

/** A walkable non-cave tile, for placing incentives. */
function spot(w: World, k = 0): Tile {
  const candidates: Tile[] = [];
  for (let i = 0; i < w.grid.tileCount; i++) {
    const t = w.grid.tileAt(i);
    if (w.grid.isWalkable(t) && w.grid.get(t) !== Terrain.Cave) candidates.push(t);
  }
  return candidates[k % candidates.length] as Tile;
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.step();
}

describe("food spawns", () => {
  it("sprouts food piles over time, at most three, never on wall or cave", () => {
    const w = World.create(5);
    let sawFood = false;
    for (let i = 0; i < 6000; i++) {
      w.step();
      const food = w.incentives.filter((inc) => inc.kind === "food");
      if (food.length > 0) sawFood = true;
      expect(food.length).toBeLessThanOrEqual(MAX_FOOD_PILES);
      for (const inc of food) {
        const terrain = w.grid.get(inc.tile);
        expect(terrain).not.toBe(Terrain.Wall);
        expect(terrain).not.toBe(Terrain.Cave);
      }
    }
    expect(sawFood).toBe(true);
  });

  it("refuses overseer-placed food and spends nothing", () => {
    const w = World.create(3);
    w.hoard.nextHatchAt = 1_000_000;
    w.hoard.effort = 100;
    const before = w.incentives.length;
    w.enqueue({ type: "placeIncentive", kind: "food", tile: spot(w) });
    w.step();
    expect(w.incentives.filter((inc) => inc.kind === "food" && inc.tile.f === spot(w).f
      && inc.tile.u === spot(w).u && inc.tile.v === spot(w).v).length).toBe(0);
    expect(w.incentives.length).toBeLessThanOrEqual(before + 1); // a pile may sprout this tick
    expect(w.hoard.effort).toBe(100);
    expect(w.log.some((l) => l.text === "Food cannot be placed; it grows where it likes.")).toBe(true);
  });
});

describe("warren", () => {
  it("fills from foraging and never exceeds capacity", () => {
    const w = World.create(5);
    let exceededStart = false;
    for (let i = 0; i < 8000; i++) {
      w.step();
      if (w.hoard.warren > WARREN_START) exceededStart = true;
      expect(w.hoard.warren).toBeGreaterThanOrEqual(0);
      expect(w.hoard.warren).toBeLessThanOrEqual(w.hoard.warrenCapacity);
    }
    expect(exceededStart).toBe(true);
  });

  it("hatches only when the warren is full, and the hatch empties it", () => {
    const w = World.create(5);
    w.hoard.effort = 1_000_000;
    // Keep goblins from changing the warren this tick.
    for (const g of w.goblins) {
      g.carryingFood = 0;
      g.hunger = 0;
    }
    const start = w.goblins.length;
    w.hoard.warren = w.hoard.warrenCapacity - 2;
    w.step();
    expect(w.goblins.length).toBe(start);
    w.hoard.warren = w.hoard.warrenCapacity;
    const cap = w.hoard.warrenCapacity;
    w.step();
    expect(w.goblins.length).toBe(start + 1);
    expect(w.hoard.warren).toBeLessThan(cap / 2);
    expect(w.hoard.warrenCapacity).toBeGreaterThan(cap);
  });
});

describe("hatch rate", () => {
  it("starts at 600 effort and grows slowly over 20 minutes", () => {
    const w = World.create(5);
    expect(w.hoard.nextHatchAt).toBe(FIRST_HATCH_AT);
    expect(FIRST_HATCH_AT).toBe(600);
    const start = w.goblins.length;
    expect(start).toBe(6);
    run(w, 4 * 60 * 20);
    const growth = w.goblins.length - start;
    // How many hatches the same delivered effort would have bought under the
    // old 60-effort first hatch (each later hatch 15% dearer).
    let at60 = 0;
    for (let cost = 60, spent = 0; spent + cost <= w.hoard.lifetimeEffort; at60++) {
      spent += cost;
      cost = Math.ceil((cost * 115) / 100);
    }
    expect(growth).toBeLessThan(at60 / 3);
    // Seed 5 gives +3 here; seeds 1, 2, 3, 5, 7, 11, 42, 77 range from 0 to 3.
    expect(growth).toBeLessThanOrEqual(5);
  });
});

describe("motives", () => {
  it("every goblin has a known motive, and motive is in the checksum", () => {
    const w = World.create(11);
    run(w, 500);
    for (const g of w.goblins) expect(MOTIVES).toContain(g.motive);
    const before = w.checksum();
    const g = w.goblins[0];
    if (!g) throw new Error("no goblins");
    g.motive = g.motive === "bored" ? "greedy" : "bored";
    expect(w.checksum()).not.toBe(before);
  });
});

describe("replay with spawns", () => {
  it("replays food spawns and overseer commands to the identical checksum", () => {
    const live = World.create(2024);
    run(live, 1500);
    live.enqueue({ type: "placeIncentive", kind: "shiny", tile: spot(live, 2) });
    run(live, 1500);
    live.enqueue({ type: "placeIncentive", kind: "drum", tile: spot(live, 7) });
    run(live, 2000);
    expect(live.tick).toBe(5000);
    expect(live.history.length).toBe(2);
    const replayed = World.replay(live.seed, live.history, live.tick);
    expect(replayed.checksum()).toBe(live.checksum());
    expect(JSON.stringify(replayed.toData())).toBe(JSON.stringify(live.toData()));
  });
});

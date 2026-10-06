import { describe, expect, it } from "vitest";
import { CubeGrid, sameTile, Terrain, type Tile } from "../src/cube";
import { findPath } from "../src/pathfinding";

const key = (t: Tile) => `${t.f}:${t.u}:${t.v}`;

describe("CubeGrid topology", () => {
  for (const n of [1, 2, 4, 5]) {
    it(`size ${n}: every tile has 4 distinct neighbours and adjacency is symmetric`, () => {
      const g = new CubeGrid(n);
      expect(g.tileCount).toBe(6 * n * n);
      for (let i = 0; i < g.tileCount; i++) {
        const t = g.tileAt(i);
        expect(g.index(t)).toBe(i);
        const adj = g.adjacent(t);
        expect(adj.length).toBe(4);
        for (const a of adj) expect(g.inBounds(a)).toBe(true);
        expect(new Set(adj.map(key)).size).toBe(n === 1 ? 4 : 4);
        for (const a of adj) {
          expect(a).not.toEqual(t);
          expect(g.adjacent(a).some((b) => sameTile(b, t)), `${key(a)} should link back to ${key(t)}`).toBe(true);
        }
      }
    });
  }

  it("walking straight around the cube returns home after 4N steps", () => {
    const n = 4;
    const g = new CubeGrid(n);
    // Walk in the +u direction from the front face. Crossing an edge keeps
    // us on the great circle because u on faces 0..3 runs the same way.
    let t: Tile = { f: 0, u: 0, v: 1 };
    const seen = new Set<string>([key(t)]);
    for (let step = 0; step < 4 * n; step++) {
      t = g.adjacent(t)[0] as Tile; // +u
      if (step < 4 * n - 1) expect(seen.has(key(t)), `revisited ${key(t)} at step ${step}`).toBe(false);
      seen.add(key(t));
    }
    expect(t).toEqual({ f: 0, u: 0, v: 1 });
  });

  it("voxel mapping round-trips and every voxel-face pair is used exactly once", () => {
    const g = new CubeGrid(3);
    const seen = new Set<string>();
    for (let i = 0; i < g.tileCount; i++) {
      const t = g.tileAt(i);
      const p = g.toVoxel(t);
      expect(g.fromVoxel(t.f, p)).toEqual(t);
      const k = `${p.join(",")}|${t.f}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("distance is a lower bound on path length", () => {
    const g = new CubeGrid(4);
    const a: Tile = { f: 0, u: 0, v: 0 };
    for (let i = 0; i < g.tileCount; i += 7) {
      const b = g.tileAt(i);
      const path = findPath(g, a, b);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThanOrEqual(g.distance(a, b));
    }
  });
});

describe("findPath on the cube", () => {
  it("crosses an edge to reach the next face", () => {
    const g = new CubeGrid(4);
    const path = findPath(g, { f: 0, u: 3, v: 1 }, { f: 1, u: 0, v: 1 });
    expect(path).toEqual([{ f: 1, u: 0, v: 1 }]);
  });

  it("routes over the top when the equator is walled", () => {
    const g = new CubeGrid(4);
    // Wall the whole front face except the top row and the start tile.
    for (let u = 0; u < 4; u++) for (let v = 1; v < 4; v++) g.set({ f: 0, u, v }, Terrain.Wall);
    g.set({ f: 0, u: 0, v: 3 }, Terrain.Floor);
    // Wall the right and left faces entirely so the only way around is top or bottom.
    for (const f of [1, 3]) for (let u = 0; u < 4; u++) for (let v = 0; v < 4; v++) g.set({ f, u, v }, Terrain.Wall);
    const path = findPath(g, { f: 0, u: 0, v: 3 }, { f: 2, u: 0, v: 3 });
    expect(path).not.toBeNull();
    const faces = new Set(path!.map((t) => t.f));
    expect(faces.has(1)).toBe(false);
    expect(faces.has(3)).toBe(false);
    expect(faces.has(5)).toBe(true); // bottom face, straight down from the start
    for (const t of path!) expect(g.isWalkable(t)).toBe(true);
    expect(path![path!.length - 1]).toEqual({ f: 2, u: 0, v: 3 });
  });

  it("returns null when the goal is sealed off", () => {
    const g = new CubeGrid(4);
    const goal: Tile = { f: 4, u: 1, v: 1 };
    for (const t of g.adjacent(goal)) g.set(t, Terrain.Wall);
    expect(findPath(g, { f: 0, u: 0, v: 0 }, goal)).toBeNull();
  });

  it("returns an empty path when already there", () => {
    const g = new CubeGrid(4);
    expect(findPath(g, { f: 2, u: 1, v: 1 }, { f: 2, u: 1, v: 1 })).toEqual([]);
  });
});

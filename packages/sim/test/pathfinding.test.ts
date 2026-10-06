import { describe, expect, it } from "vitest";
import { Grid, Terrain } from "../src/grid";
import { findPath } from "../src/pathfinding";

describe("findPath", () => {
  it("routes around a wall", () => {
    const g = new Grid(5, 5);
    for (let y = 0; y < 4; y++) g.set(2, y, Terrain.Wall);
    const path = findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    const last = path![path!.length - 1];
    expect(last).toEqual({ x: 4, y: 0 });
    for (const p of path!) expect(g.get(p.x, p.y)).not.toBe(Terrain.Wall);
    // Must go down to row 4 and back: at least 4 + 4 + 4 = 12 steps.
    expect(path!.length).toBe(12);
  });

  it("returns null when the goal is unreachable", () => {
    const g = new Grid(5, 5);
    for (let y = 0; y < 5; y++) g.set(2, y, Terrain.Wall);
    expect(findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });

  it("returns an empty path when already there", () => {
    const g = new Grid(3, 3);
    expect(findPath(g, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });
});

import { CubeGrid, Terrain, type Tile } from "./cube";
import type { Rng } from "./rng";

export interface GeneratedMap {
  grid: CubeGrid;
  cave: Tile[];
}

/**
 * A starting cube: the hoard's cave is a block in the middle of the front
 * face, with scattered walls and resource patches on every face. Any
 * walkable tile the goblins could not reach is turned into wall so the
 * board never has stranded pockets. Deterministic given the rng.
 */
export function generateMap(rng: Rng, size = 4): GeneratedMap {
  const grid = new CubeGrid(size);

  const cave: Tile[] = [];
  const lo = Math.floor((size - 1) / 2);
  const hi = Math.floor(size / 2);
  for (let v = lo; v <= hi; v++) {
    for (let u = lo; u <= hi; u++) {
      const t = { f: 0, u, v };
      grid.set(t, Terrain.Cave);
      cave.push(t);
    }
  }

  const wallChance = 0.1;
  const resourceChance = 0.18;
  for (let i = 0; i < grid.tileCount; i++) {
    const t = grid.tileAt(i);
    if (grid.get(t) !== Terrain.Floor) continue;
    // Keep the ring around the cave clear so goblins can always leave.
    if (t.f === 0 && Math.abs(t.u - lo) <= 1 && Math.abs(t.v - lo) <= 1) continue;
    const roll = rng.next();
    if (roll < wallChance) grid.set(t, Terrain.Wall);
    else if (roll < wallChance + resourceChance) grid.set(t, Terrain.Resource);
  }

  // Seal off anything unreachable from the cave.
  const reach = new Uint8Array(grid.tileCount);
  const stack = cave.map((t) => grid.index(t));
  for (const i of stack) reach[i] = 1;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    for (const n of grid.neighbors(grid.tileAt(i))) {
      const ni = grid.index(n);
      if (!reach[ni]) {
        reach[ni] = 1;
        stack.push(ni);
      }
    }
  }
  for (let i = 0; i < grid.tileCount; i++) {
    if (!reach[i] && grid.terrain[i] !== Terrain.Wall) grid.terrain[i] = Terrain.Wall;
  }

  return { grid, cave };
}

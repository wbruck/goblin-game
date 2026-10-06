import { Grid, Terrain, type Point } from "./grid";
import type { Rng } from "./rng";

export interface GeneratedMap {
  grid: Grid;
  cave: Point;
}

/**
 * A small starting map: open floor, a few wall clumps, resource patches,
 * and the hoard's cave near the centre. Deterministic given the rng.
 */
export function generateMap(rng: Rng, width = 48, height = 32): GeneratedMap {
  const grid = new Grid(width, height);

  for (let x = 0; x < width; x++) {
    grid.set(x, 0, Terrain.Wall);
    grid.set(x, height - 1, Terrain.Wall);
  }
  for (let y = 0; y < height; y++) {
    grid.set(0, y, Terrain.Wall);
    grid.set(width - 1, y, Terrain.Wall);
  }

  const cave: Point = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) grid.set(cave.x + dx, cave.y + dy, Terrain.Cave);
  }

  const clumps = Math.floor((width * height) / 90);
  for (let i = 0; i < clumps; i++) {
    const cx = rng.int(2, width - 3);
    const cy = rng.int(2, height - 3);
    const r = rng.int(1, 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!grid.inBounds(x, y)) continue;
        if (Math.abs(x - cave.x) <= 3 && Math.abs(y - cave.y) <= 3) continue;
        if (rng.chance(0.7)) grid.set(x, y, Terrain.Wall);
      }
    }
  }

  const patches = Math.floor((width * height) / 150);
  for (let i = 0; i < patches; i++) {
    const cx = rng.int(2, width - 3);
    const cy = rng.int(2, height - 3);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!grid.inBounds(x, y) || grid.get(x, y) !== Terrain.Floor) continue;
        if (Math.abs(x - cave.x) <= 2 && Math.abs(y - cave.y) <= 2) continue;
        if (rng.chance(0.6)) grid.set(x, y, Terrain.Resource);
      }
    }
  }

  return { grid, cave };
}

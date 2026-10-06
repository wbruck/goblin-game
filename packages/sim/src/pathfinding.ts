import { CubeGrid, sameTile, type Tile } from "./cube";

/**
 * Plain A* over cube tiles with a binary heap. Good for a few dozen goblins.
 * When many goblins share one destination (a loot pile, a war drum) this
 * should be replaced by a flow field per incentive; keep callers talking
 * to "next step toward target" so that swap is local.
 */
export function findPath(grid: CubeGrid, start: Tile, goal: Tile): Tile[] | null {
  if (!grid.isWalkable(goal)) return null;
  if (sameTile(start, goal)) return [];

  const size = grid.tileCount;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  const open = new MinHeap();
  const startIdx = grid.index(start);
  const goalIdx = grid.index(goal);
  gScore[startIdx] = 0;
  open.push(startIdx, grid.distance(start, goal));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goalIdx) return reconstruct(grid, cameFrom, goalIdx);
    if (closed[current]) continue;
    closed[current] = 1;

    const ct = grid.tileAt(current);
    const g = gScore[current] as number;

    for (const n of grid.neighbors(ct)) {
      const ni = grid.index(n);
      if (closed[ni]) continue;
      const tentative = g + 1;
      if (tentative < (gScore[ni] as number)) {
        gScore[ni] = tentative;
        cameFrom[ni] = current;
        open.push(ni, tentative + grid.distance(n, goal));
      }
    }
  }
  return null;
}

function reconstruct(grid: CubeGrid, cameFrom: Int32Array, goalIdx: number): Tile[] {
  const path: Tile[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    path.push(grid.tileAt(cur));
    cur = cameFrom[cur] as number;
  }
  path.reverse();
  path.shift(); // drop the start tile
  return path;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(val: number, key: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.keys[p] as number) <= (this.keys[i] as number)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.vals[0] as number;
    const lastKey = this.keys.pop() as number;
    const lastVal = this.vals.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && (this.keys[l] as number) < (this.keys[m] as number)) m = l;
        if (r < this.keys.length && (this.keys[r] as number) < (this.keys[m] as number)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a] as number;
    this.keys[a] = this.keys[b] as number;
    this.keys[b] = k;
    const v = this.vals[a] as number;
    this.vals[a] = this.vals[b] as number;
    this.vals[b] = v;
  }
}

import { Grid, manhattan, type Point } from "./grid";

/**
 * Plain A* on the grid with a binary heap. Good for a few dozen goblins.
 * When many goblins share one destination (a loot pile, a war drum) this
 * should be replaced by a flow field per incentive; keep callers talking
 * to "next step toward target" so that swap is local.
 */
export function findPath(grid: Grid, start: Point, goal: Point): Point[] | null {
  if (!grid.isWalkable(goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];

  const size = grid.width * grid.height;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  const open = new MinHeap();
  const startIdx = grid.index(start.x, start.y);
  const goalIdx = grid.index(goal.x, goal.y);
  gScore[startIdx] = 0;
  open.push(startIdx, manhattan(start, goal));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goalIdx) return reconstruct(grid, cameFrom, goalIdx);
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % grid.width;
    const cy = (current - cx) / grid.width;
    const g = gScore[current] as number;

    for (const n of grid.neighbors(cx, cy)) {
      const ni = grid.index(n.x, n.y);
      if (closed[ni]) continue;
      const tentative = g + 1;
      if (tentative < (gScore[ni] as number)) {
        gScore[ni] = tentative;
        cameFrom[ni] = current;
        open.push(ni, tentative + manhattan(n, goal));
      }
    }
  }
  return null;
}

function reconstruct(grid: Grid, cameFrom: Int32Array, goalIdx: number): Point[] {
  const path: Point[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    const x = cur % grid.width;
    path.push({ x, y: (cur - x) / grid.width });
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

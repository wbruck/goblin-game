export enum Terrain {
  Floor = 0,
  Wall = 1,
  Cave = 2,
  Resource = 3,
}

export interface Point {
  x: number;
  y: number;
}

export interface GridData {
  width: number;
  height: number;
  terrain: number[];
}

/**
 * Square grid stored as a flat array indexed by y * width + x.
 * Only terrain lives here; entities are kept in World and looked up
 * through an occupancy index rebuilt each tick.
 */
export class Grid {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;

  constructor(width: number, height: number, terrain?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.terrain = terrain ?? new Uint8Array(width * height);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Terrain {
    return this.terrain[this.index(x, y)] as Terrain;
  }

  set(x: number, y: number, t: Terrain): void {
    this.terrain[this.index(x, y)] = t;
  }

  isWalkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.get(x, y) !== Terrain.Wall;
  }

  /** Four-direction neighbours. Diagonals are deferred until corner cutting is handled. */
  neighbors(x: number, y: number): Point[] {
    const out: Point[] = [];
    if (this.isWalkable(x + 1, y)) out.push({ x: x + 1, y });
    if (this.isWalkable(x - 1, y)) out.push({ x: x - 1, y });
    if (this.isWalkable(x, y + 1)) out.push({ x, y: y + 1 });
    if (this.isWalkable(x, y - 1)) out.push({ x, y: y - 1 });
    return out;
  }

  findAll(t: Terrain): Point[] {
    const out: Point[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.get(x, y) === t) out.push({ x, y });
      }
    }
    return out;
  }

  toData(): GridData {
    return { width: this.width, height: this.height, terrain: Array.from(this.terrain) };
  }

  static fromData(d: GridData): Grid {
    return new Grid(d.width, d.height, Uint8Array.from(d.terrain));
  }
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

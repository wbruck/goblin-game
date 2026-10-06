/**
 * The board is the surface of a cube with N tiles per side: six faces of
 * N x N tiles, 6N² in all. A tile is addressed by (f, u, v). Internally a
 * tile is a surface voxel of an N³ block plus an outward normal, which
 * makes edge crossing simple: stepping off a face edge lands on the same
 * voxel's other exposed face. No hand-written adjacency table is needed.
 *
 * Axes: x right, y up, z toward the viewer. Face order and orientation:
 *   0 front (+z), 1 right (+x), 2 back (-z), 3 left (-x), 4 top (+y), 5 bottom (-y)
 * On every side face, v runs downward (v = 0 is the top row) and u runs
 * clockwise when seen from above, so walking "right" around the equator
 * visits faces 0, 1, 2, 3 in order.
 */
export enum Terrain {
  Floor = 0,
  Wall = 1,
  Cave = 2,
  Resource = 3,
}

export interface Tile {
  f: number;
  u: number;
  v: number;
}

export type Vec3 = readonly [number, number, number];

export interface FaceDef {
  /** Outward normal. */
  n: Vec3;
  /** Direction of increasing u. */
  du: Vec3;
  /** Direction of increasing v. */
  dv: Vec3;
}

export const FACES: readonly FaceDef[] = [
  { n: [0, 0, 1], du: [1, 0, 0], dv: [0, -1, 0] },
  { n: [1, 0, 0], du: [0, 0, -1], dv: [0, -1, 0] },
  { n: [0, 0, -1], du: [-1, 0, 0], dv: [0, -1, 0] },
  { n: [-1, 0, 0], du: [0, 0, 1], dv: [0, -1, 0] },
  { n: [0, 1, 0], du: [1, 0, 0], dv: [0, 0, 1] },
  { n: [0, -1, 0], du: [1, 0, 0], dv: [0, 0, -1] },
];

export const FACE_NAMES = ["front", "right", "back", "left", "top", "bottom"] as const;

export interface CubeData {
  size: number;
  terrain: number[];
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.f === b.f && a.u === b.u && a.v === b.v;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export class CubeGrid {
  readonly size: number;
  readonly tileCount: number;
  readonly terrain: Uint8Array;

  constructor(size: number, terrain?: Uint8Array) {
    if (size < 1) throw new Error("cube size must be at least 1");
    this.size = size;
    this.tileCount = 6 * size * size;
    this.terrain = terrain ?? new Uint8Array(this.tileCount);
  }

  index(t: Tile): number {
    return (t.f * this.size + t.v) * this.size + t.u;
  }

  tileAt(index: number): Tile {
    const n = this.size;
    const u = index % n;
    const rest = (index - u) / n;
    const v = rest % n;
    return { f: (rest - v) / n, u, v };
  }

  inBounds(t: Tile): boolean {
    const n = this.size;
    return t.f >= 0 && t.f < 6 && t.u >= 0 && t.u < n && t.v >= 0 && t.v < n;
  }

  get(t: Tile): Terrain {
    return this.terrain[this.index(t)] as Terrain;
  }

  set(t: Tile, terrain: Terrain): void {
    this.terrain[this.index(t)] = terrain;
  }

  isWalkable(t: Tile): boolean {
    return this.inBounds(t) && this.get(t) !== Terrain.Wall;
  }

  /** Origin voxel of a face: the voxel at u = 0, v = 0. */
  private faceOrigin(f: number): Vec3 {
    const m = this.size - 1;
    const { n, du, dv } = FACES[f] as FaceDef;
    // Start from the corner where u and v are smallest: the coordinate
    // along +du or +dv is 0, along -du or -dv is m; along the normal it is
    // m for a positive normal and 0 for a negative one.
    const coord = (axis: 0 | 1 | 2): number => {
      if (n[axis] > 0) return m;
      if (n[axis] < 0) return 0;
      if (du[axis] > 0 || dv[axis] > 0) return 0;
      return m;
    };
    return [coord(0), coord(1), coord(2)];
  }

  /** Integer voxel a tile sits on. */
  toVoxel(t: Tile): Vec3 {
    const o = this.faceOrigin(t.f);
    const { du, dv } = FACES[t.f] as FaceDef;
    return [
      o[0] + du[0] * t.u + dv[0] * t.v,
      o[1] + du[1] * t.u + dv[1] * t.v,
      o[2] + du[2] * t.u + dv[2] * t.v,
    ];
  }

  /** Tile of face f that sits on voxel p. The voxel must lie on that face. */
  fromVoxel(f: number, p: Vec3): Tile {
    const o = this.faceOrigin(f);
    const { du, dv } = FACES[f] as FaceDef;
    const d: Vec3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    return { f, u: dot(d, du), v: dot(d, dv) };
  }

  /** Centre of a tile's surface square in continuous cube coordinates, cube centred at the origin. */
  center(t: Tile): Vec3 {
    const p = this.toVoxel(t);
    const { n } = FACES[t.f] as FaceDef;
    const h = this.size / 2;
    return [p[0] + 0.5 + 0.5 * n[0] - h, p[1] + 0.5 + 0.5 * n[1] - h, p[2] + 0.5 + 0.5 * n[2] - h];
  }

  /** Four corners of a tile's surface square, in u/v order: (0,0) (1,0) (1,1) (0,1). */
  corners(t: Tile): Vec3[] {
    const c = this.center(t);
    const { du, dv } = FACES[t.f] as FaceDef;
    const at = (su: number, sv: number): Vec3 => [
      c[0] + 0.5 * su * du[0] + 0.5 * sv * dv[0],
      c[1] + 0.5 * su * du[1] + 0.5 * sv * dv[1],
      c[2] + 0.5 * su * du[2] + 0.5 * sv * dv[2],
    ];
    return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
  }

  /**
   * The four tiles adjacent to t, across face edges where needed, in the
   * order +u, -u, +v, -v. Walls are included; use `neighbors` for walkable ones.
   */
  adjacent(t: Tile): Tile[] {
    const { du, dv } = FACES[t.f] as FaceDef;
    const p = this.toVoxel(t);
    const dirs: Vec3[] = [du, [-du[0], -du[1], -du[2]], dv, [-dv[0], -dv[1], -dv[2]]];
    const out: Tile[] = [];
    for (const d of dirs) {
      const q: Vec3 = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      if (q[0] >= 0 && q[0] < this.size && q[1] >= 0 && q[1] < this.size && q[2] >= 0 && q[2] < this.size) {
        out.push(this.fromVoxel(t.f, q));
      } else {
        // Off the edge: the same voxel's face whose normal is the step direction.
        out.push(this.fromVoxel(faceWithNormal(d), p));
      }
    }
    return out;
  }

  neighbors(t: Tile): Tile[] {
    return this.adjacent(t).filter((n) => this.isWalkable(n));
  }

  /**
   * Lower bound on the number of steps between two tiles: Manhattan
   * distance between their voxels. Every step moves the voxel by at most
   * one unit along one axis (an edge crossing moves it by zero), so this
   * is admissible for A*.
   */
  distance(a: Tile, b: Tile): number {
    const p = this.toVoxel(a);
    const q = this.toVoxel(b);
    return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
  }

  findAll(terrain: Terrain): Tile[] {
    const out: Tile[] = [];
    for (let i = 0; i < this.tileCount; i++) {
      if (this.terrain[i] === terrain) out.push(this.tileAt(i));
    }
    return out;
  }

  toData(): CubeData {
    return { size: this.size, terrain: Array.from(this.terrain) };
  }

  static fromData(d: CubeData): CubeGrid {
    return new CubeGrid(d.size, Uint8Array.from(d.terrain));
  }
}

function faceWithNormal(d: Vec3): number {
  for (let f = 0; f < 6; f++) {
    const n = (FACES[f] as FaceDef).n;
    if (n[0] === d[0] && n[1] === d[1] && n[2] === d[2]) return f;
  }
  throw new Error(`no face with normal ${d.join(",")}`);
}

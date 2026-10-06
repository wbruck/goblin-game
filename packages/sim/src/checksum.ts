import type { Goblin, Incentive } from "./types";

const ACTION_CODE: Record<Goblin["action"], number> = {
  idle: 0, wander: 1, gather: 2, deliver: 3, eat: 4, rest: 5, loot: 6, rally: 7,
};

/**
 * Fixed-order integer record of a goblin. This is the canonical encoding
 * used for checksums and compact snapshots: byte-exact, hashable, and
 * readable in any language. Variable-length parts (name, path) are hashed
 * separately so the fixed record stays fixed.
 */
export const GOBLIN_RECORD_FIELDS = [
  "id", "face", "u", "v", "hunger", "energy", "mood", "greed", "bravery", "diligence",
  "action", "targetFace", "targetU", "targetV", "carrying", "commitment", "incentiveId", "pathLength",
] as const;

export function goblinRecord(g: Goblin): Int32Array {
  const r = new Int32Array(GOBLIN_RECORD_FIELDS.length);
  r[0] = g.id;
  r[1] = g.tile.f;
  r[2] = g.tile.u;
  r[3] = g.tile.v;
  r[4] = g.hunger;
  r[5] = g.energy;
  r[6] = g.mood;
  r[7] = g.greed;
  r[8] = g.bravery;
  r[9] = g.diligence;
  r[10] = ACTION_CODE[g.action];
  r[11] = g.target ? g.target.f : -1;
  r[12] = g.target ? g.target.u : -1;
  r[13] = g.target ? g.target.v : -1;
  r[14] = g.carrying;
  r[15] = g.commitment;
  r[16] = g.incentiveId ?? -1;
  r[17] = g.path.length;
  return r;
}

/** Incremental FNV-1a over 32-bit integers. Returns an unsigned 32-bit hash. */
export class Hasher {
  private h = 0x811c9dc5;

  int(v: number): this {
    // Feed the four bytes of the integer so sign and magnitude both count.
    let x = v | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= x & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
      x >>>= 8;
    }
    return this;
  }

  ints(arr: ArrayLike<number>): this {
    for (let i = 0; i < arr.length; i++) this.int(arr[i] as number);
    return this;
  }

  goblin(g: Goblin): this {
    this.ints(goblinRecord(g));
    for (const p of g.path) this.int(p.f).int(p.u).int(p.v);
    return this;
  }

  incentive(inc: Incentive): this {
    const kind = inc.kind === "food" ? 0 : inc.kind === "shiny" ? 1 : 2;
    return this.int(inc.id).int(kind).int(inc.tile.f).int(inc.tile.u).int(inc.tile.v).int(inc.strength).int(inc.remaining);
  }

  digest(): number {
    return this.h >>> 0;
  }
}

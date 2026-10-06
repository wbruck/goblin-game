import { chooseAction, SULK_MOOD } from "./ai";
import { Hasher } from "./checksum";
import { CubeGrid, FACE_NAMES, sameTile, Terrain, type Tile } from "./cube";
import { generateMap } from "./mapgen";
import { goblinName } from "./names";
import { findPath } from "./pathfinding";
import { Rng } from "./rng";
import {
  NEED_MAX,
  NEED_SCALE,
  TRAIT_MAX,
  type Command,
  type Goblin,
  type Hoard,
  type Incentive,
  type IncentiveKind,
  type LogEvent,
  type OverseerIncentiveKind,
  type RecordedCommand,
  type WorldData,
} from "./types";

export const TICK_MS = 250;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
export const SAVE_VERSION = 5;
export const DEFAULT_CUBE_SIZE = 4;
/** A new hoard begins with a single goblin. */
export const DEFAULT_STARTING_GOBLINS = 1;

const LOG_LIMIT = 200;
const CARRY_CAPACITY = 6;

/** Food in the warren at the start of a new world. */
export const WARREN_START = 4;
/** A hatch needs a full warren and empties it. Capacity grows with each hatch. */
export const WARREN_START_CAPACITY = 12;
export const WARREN_CAPACITY_PER_HATCH = 2;
/** Most food units a forager can carry at once. */
export const FORAGE_CAPACITY = 3;
/** Food piles stop sprouting while this many are on the board. */
export const MAX_FOOD_PILES = 3;
/** Per-tick chance that a new food pile sprouts (when below the cap). */
export const FOOD_SPAWN_CHANCE = 1 / 400;
/** Hunger relief per unit of overflow food a goblin eats at a full warren. */
const OVERFLOW_HUNGER_RELIEF = 20 * NEED_SCALE;

// Per-tick need changes, in hundredths.
const HUNGER_PER_TICK = 6;
const ENERGY_REST = 60;
const ENERGY_IDLE = 5;
const ENERGY_WORK = 8;
const MOOD_STARVING = 20;
const MOOD_RECOVER = 5;

/** The incentives the overseer can place, in toolbar order. Food only sprouts. */
export const OVERSEER_INCENTIVES = ["shiny", "drum"] as const;

export const INCENTIVE_COST: Record<OverseerIncentiveKind, number> = {
  shiny: 25,
  drum: 40,
};

// Strength is in tenths so decay can be an integer per tick.
const INCENTIVE_DEFAULTS: Record<IncentiveKind, { strength: number; decay: number; remaining: number }> = {
  food: { strength: 1000, decay: 1, remaining: 6 },
  shiny: { strength: 1000, decay: 1, remaining: 5 },
  drum: { strength: 1200, decay: 5, remaining: 0 },
};

/**
 * The entire game state and its rules. Pure TypeScript, no DOM, no clock.
 * `step` advances exactly one tick. Every command applied is recorded in
 * `history` with its tick, so `World.replay(seed, history)` rebuilds this
 * exact state on any machine. That is what makes local play a prediction
 * the server can later verify or overrule.
 */
export class World {
  readonly seed: number;
  readonly startingGoblins: number;
  readonly size: number;
  tick: number;
  rng: Rng;
  grid: CubeGrid;
  cave: Tile[];
  goblins: Goblin[];
  incentives: Incentive[];
  hoard: Hoard;
  log: LogEvent[];
  history: RecordedCommand[];
  private nextId: number;
  private resourceTiles: Tile[];
  private pendingCommands: Command[] = [];

  private constructor(d: WorldData) {
    this.seed = d.seed;
    this.startingGoblins = d.startingGoblins;
    this.size = d.size;
    this.tick = d.tick;
    this.rng = Rng.fromState(d.rngState);
    this.grid = CubeGrid.fromData(d.grid);
    this.cave = d.cave;
    this.goblins = d.goblins;
    this.incentives = d.incentives;
    this.hoard = d.hoard;
    this.log = d.log;
    this.history = d.history;
    this.nextId = d.nextId;
    this.resourceTiles = this.grid.findAll(Terrain.Resource);
  }

  static create(seed: number, startingGoblins = DEFAULT_STARTING_GOBLINS, size = DEFAULT_CUBE_SIZE): World {
    const rng = new Rng(seed);
    const { grid, cave } = generateMap(rng, size);
    const w = new World({
      version: SAVE_VERSION,
      seed,
      startingGoblins,
      size,
      tick: 0,
      rngState: rng.getState(),
      grid: grid.toData(),
      cave,
      goblins: [],
      incentives: [],
      hoard: {
        effort: 0,
        lifetimeEffort: 0,
        warren: WARREN_START,
        warrenCapacity: WARREN_START_CAPACITY,
        shinies: 0,
        born: 0,
      },
      nextId: 1,
      log: [],
      history: [],
    });
    for (let i = 0; i < startingGoblins; i++) w.spawnGoblin();
    w.hoard.born = 0;
    w.addLog("The hoard stirs in its cave.", "info");
    return w;
  }

  /**
   * Rebuild a world from its seed and command history, up to `toTick`
   * (default: the tick after the last command). This is the server's job
   * later; today it verifies saves and proves determinism in tests.
   */
  static replay(seed: number, history: RecordedCommand[], toTick?: number, startingGoblins = DEFAULT_STARTING_GOBLINS, size = DEFAULT_CUBE_SIZE): World {
    const w = World.create(seed, startingGoblins, size);
    const last = history[history.length - 1];
    const end = toTick ?? (last ? last.tick + 1 : 0);
    let i = 0;
    while (w.tick < end) {
      while (i < history.length && (history[i] as RecordedCommand).tick === w.tick) {
        w.enqueue((history[i] as RecordedCommand).command);
        i++;
      }
      w.step();
    }
    return w;
  }

  static fromData(d: WorldData): World {
    if (d.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${String(d.version)}`);
    return new World(d);
  }

  toData(): WorldData {
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      startingGoblins: this.startingGoblins,
      size: this.size,
      tick: this.tick,
      rngState: this.rng.getState(),
      grid: this.grid.toData(),
      cave: this.cave,
      goblins: this.goblins,
      incentives: this.incentives,
      hoard: this.hoard,
      nextId: this.nextId,
      log: this.log,
      history: this.history,
    };
  }

  /**
   * Hash of everything that affects future ticks. Two worlds with equal
   * checksums at the same tick will evolve identically given the same
   * commands. Names and the log are excluded: they never feed back into
   * the simulation.
   */
  checksum(): number {
    const h = new Hasher().int(this.tick).int(this.rng.getState()).int(this.nextId);
    h.int(this.hoard.effort).int(this.hoard.lifetimeEffort)
      .int(this.hoard.warren).int(this.hoard.warrenCapacity).int(this.hoard.shinies).int(this.hoard.born);
    h.int(this.goblins.length);
    for (const g of this.goblins) h.goblin(g);
    h.int(this.incentives.length);
    for (const inc of this.incentives) h.incentive(inc);
    return h.digest();
  }

  /** Queue an overseer command; it is applied and recorded at the start of the next tick. */
  enqueue(cmd: Command): void {
    this.pendingCommands.push(cmd);
  }

  step(): void {
    this.applyCommands();
    this.decayIncentives();
    this.sproutFood();
    for (const g of this.goblins) this.updateGoblin(g);
    this.tryHatch();
    this.tick++;
  }

  private applyCommands(): void {
    for (const cmd of this.pendingCommands) {
      this.history.push({ tick: this.tick, command: cmd });
      if (cmd.type === "placeIncentive") this.placeIncentive(cmd.kind, cmd.tile);
    }
    this.pendingCommands = [];
  }

  private placeIncentive(kind: IncentiveKind, tile: Tile): void {
    if (kind === "food") {
      this.addLog("Food cannot be placed; it grows where it likes.", "overseer");
      return;
    }
    const cost = INCENTIVE_COST[kind];
    if (!this.grid.isWalkable(tile)) {
      this.addLog(`You cannot put a ${kind} pile inside a wall.`, "overseer");
      return;
    }
    if (this.hoard.effort < cost) {
      this.addLog(`Not enough effort for a ${kind} pile (need ${cost}).`, "overseer");
      return;
    }
    this.hoard.effort -= cost;
    const def = INCENTIVE_DEFAULTS[kind];
    this.incentives.push({ id: this.nextId++, kind, tile: { ...tile }, strength: def.strength, remaining: def.remaining });
    const what = kind === "drum" ? "a war drum" : "a shiny pile";
    this.addLog(`The overseer placed ${what} on the ${FACE_NAMES[tile.f]} face at ${tile.u},${tile.v}.`, "overseer");
  }

  private decayIncentives(): void {
    for (const inc of this.incentives) inc.strength -= INCENTIVE_DEFAULTS[inc.kind].decay;
    this.incentives = this.incentives.filter((inc) => inc.strength > 0 && (inc.kind === "drum" || inc.remaining > 0));
  }

  /**
   * Mushrooms sprout on their own. The tile is chosen from candidates in
   * tile-index order, so the pick is stable for a given rng state.
   */
  private sproutFood(): void {
    let piles = 0;
    for (const inc of this.incentives) if (inc.kind === "food") piles++;
    if (piles >= MAX_FOOD_PILES || !this.rng.chance(FOOD_SPAWN_CHANCE)) return;
    const taken = new Set<number>();
    for (const inc of this.incentives) taken.add(this.grid.index(inc.tile));
    const candidates: Tile[] = [];
    for (let i = 0; i < this.grid.tileCount; i++) {
      if (taken.has(i)) continue;
      const t = this.grid.tileAt(i);
      if (this.grid.isWalkable(t) && this.grid.get(t) !== Terrain.Cave) candidates.push(t);
    }
    if (candidates.length === 0) return;
    const tile = this.rng.pick(candidates);
    const def = INCENTIVE_DEFAULTS.food;
    this.incentives.push({ id: this.nextId++, kind: "food", tile: { ...tile }, strength: def.strength, remaining: def.remaining });
    this.addLog(`A patch of mushrooms sprouted on the ${FACE_NAMES[tile.f]} face.`, "info");
  }

  private updateGoblin(g: Goblin): void {
    // Needs drift every tick. Working costs energy; resting restores it.
    g.hunger = Math.min(NEED_MAX, g.hunger + HUNGER_PER_TICK);
    if (g.action === "rest") g.energy = Math.min(NEED_MAX, g.energy + ENERGY_REST);
    else if (g.action === "idle" || g.action === "wander") g.energy = Math.min(NEED_MAX, g.energy + ENERGY_IDLE);
    else g.energy = Math.max(0, g.energy - ENERGY_WORK);
    if (g.hunger > 80 * NEED_SCALE) g.mood = Math.max(-NEED_MAX, g.mood - MOOD_STARVING);
    else if (g.mood < 0) g.mood = Math.min(0, g.mood + MOOD_RECOVER);

    // Reconsider when the current plan is finished or commitment runs out.
    g.commitment--;
    if (g.commitment <= 0 || (g.path.length === 0 && g.target && !this.atTarget(g))) {
      this.decide(g);
    }

    if (g.path.length > 0) {
      g.tile = g.path.shift() as Tile;
      if (g.path.length === 0 && g.target && !this.atTarget(g)) g.commitment = 0;
      return;
    }

    if (!g.target || !this.atTarget(g)) return;
    this.performAction(g);
  }

  private decide(g: Goblin): void {
    const choice = chooseAction(g, {
      grid: this.grid,
      cave: this.nearestCave(g.tile),
      resources: this.resourceTiles,
      incentives: this.incentives,
      warren: this.hoard.warren,
      warrenCapacity: this.hoard.warrenCapacity,
      rng: this.rng,
    });
    g.action = choice.action;
    g.target = choice.target;
    g.incentiveId = choice.incentiveId;
    g.motive = choice.motive;
    g.commitment = 8 + this.rng.int(0, 16);
    g.path = [];
    if (choice.refused && this.rng.chance(0.15)) this.addLog(choice.refused, "refusal");
    if (choice.target && !this.atTarget(g)) {
      const path = findPath(this.grid, g.tile, choice.target);
      if (path === null) {
        g.action = "idle";
        g.target = null;
        g.incentiveId = null;
        g.motive = g.mood < SULK_MOOD ? "sulking" : "bored";
      } else {
        g.path = path;
        g.commitment = Math.max(g.commitment, path.length + 6);
      }
    }
  }

  private atTarget(g: Goblin): boolean {
    return g.target !== null && sameTile(g.tile, g.target);
  }

  private nearestCave(from: Tile): Tile {
    let best = this.cave[0] as Tile;
    let bestD = Infinity;
    for (const c of this.cave) {
      const d = this.grid.distance(from, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private performAction(g: Goblin): void {
    switch (g.action) {
      case "gather": {
        if (this.grid.get(g.tile) !== Terrain.Resource) break;
        if (this.rng.chance(0.25 + (g.diligence / TRAIT_MAX) * 0.25)) g.carrying++;
        if (g.carrying >= CARRY_CAPACITY) g.commitment = 0;
        break;
      }
      case "deliver": {
        if (this.grid.get(g.tile) !== Terrain.Cave) break;
        this.hoard.effort += g.carrying;
        this.hoard.lifetimeEffort += g.carrying;
        g.carrying = 0;
        if (g.carryingFood > 0) {
          const stored = Math.min(g.carryingFood, Math.max(0, this.hoard.warrenCapacity - this.hoard.warren));
          const overflow = g.carryingFood - stored;
          this.hoard.warren += stored;
          g.carryingFood = 0;
          if (overflow > 0) {
            g.hunger = Math.max(0, g.hunger - overflow * OVERFLOW_HUNGER_RELIEF);
            this.addLog(`${g.name} ate the overflow.`, "info");
          }
        }
        g.mood = Math.min(NEED_MAX, g.mood + 2 * NEED_SCALE);
        g.commitment = 0;
        break;
      }
      case "eat": {
        const inc = g.incentiveId !== null ? this.incentiveById(g.incentiveId) : null;
        if (inc && inc.remaining > 0) {
          inc.remaining--;
          g.hunger = Math.max(0, g.hunger - 60 * NEED_SCALE);
          g.mood = Math.min(NEED_MAX, g.mood + 10 * NEED_SCALE);
        } else if (this.grid.get(g.tile) === Terrain.Cave && this.hoard.warren > 0) {
          this.hoard.warren--;
          g.hunger = Math.max(0, g.hunger - 50 * NEED_SCALE);
        } else {
          g.mood = Math.max(-NEED_MAX, g.mood - 1 * NEED_SCALE);
        }
        g.commitment = 0;
        break;
      }
      case "forage": {
        const inc = g.incentiveId !== null ? this.incentiveById(g.incentiveId) : null;
        if (inc && inc.kind === "food" && inc.remaining > 0 && g.carryingFood < FORAGE_CAPACITY) {
          inc.remaining--;
          g.carryingFood++;
        }
        if (!inc || inc.remaining <= 0 || g.carryingFood >= FORAGE_CAPACITY) g.commitment = 0;
        break;
      }
      case "rest": {
        if (g.energy >= 95 * NEED_SCALE) g.commitment = 0;
        break;
      }
      case "loot": {
        const inc = g.incentiveId !== null ? this.incentiveById(g.incentiveId) : null;
        if (inc && inc.remaining > 0) {
          inc.remaining--;
          this.hoard.shinies++;
          g.mood = Math.min(NEED_MAX, g.mood + 5 * NEED_SCALE);
          // A greedy goblin sometimes pockets the shiny instead.
          if (this.rng.chance((g.greed / TRAIT_MAX) * 0.3)) {
            this.hoard.shinies--;
            this.addLog(`${g.name} kept a shiny for itself.`, "refusal");
          }
        }
        g.commitment = 0;
        break;
      }
      case "rally":
      case "wander":
      case "idle":
        break;
    }
  }

  private incentiveById(id: number): Incentive | null {
    return this.incentives.find((i) => i.id === id) ?? null;
  }

  private tryHatch(): void {
    // A goblin hatches when the warren is full, and the hatch uses all of
    // it. Effort plays no part in hatching; it is banked for later use.
    while (this.hoard.warren >= this.hoard.warrenCapacity) {
      this.hoard.warren = 0;
      this.hoard.warrenCapacity += WARREN_CAPACITY_PER_HATCH;
      const g = this.spawnGoblin();
      this.addLog(`${g.name} hatched. The hoard numbers ${this.goblins.length}.`, "birth");
    }
  }

  private spawnGoblin(): Goblin {
    const g: Goblin = {
      id: this.nextId++,
      name: goblinName(this.rng.int(0, 999), this.rng.int(0, 999)),
      tile: { ...this.rng.pick(this.cave) },
      hunger: this.rng.int(10, 40) * NEED_SCALE,
      energy: this.rng.int(60, 100) * NEED_SCALE,
      mood: this.rng.int(-10, 30) * NEED_SCALE,
      greed: this.rng.int(0, TRAIT_MAX),
      bravery: this.rng.int(0, TRAIT_MAX),
      diligence: this.rng.int(0, TRAIT_MAX),
      action: "idle",
      target: null,
      path: [],
      carrying: 0,
      carryingFood: 0,
      motive: "none",
      commitment: 0,
      incentiveId: null,
    };
    this.goblins.push(g);
    this.hoard.born++;
    return g;
  }

  addLog(text: string, kind: LogEvent["kind"]): void {
    this.log.push({ tick: this.tick, text, kind });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }
}

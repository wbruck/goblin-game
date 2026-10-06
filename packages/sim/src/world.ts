import { chooseAction } from "./ai";
import { Hasher } from "./checksum";
import { Grid, Terrain, type Point } from "./grid";
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
  type RecordedCommand,
  type WorldData,
} from "./types";

export const TICK_MS = 250;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
export const SAVE_VERSION = 2;

const LOG_LIMIT = 200;
const CARRY_CAPACITY = 6;
const HATCH_GROWTH_PERCENT = 115;
const FOOD_CHANCE_PER_HAUL = 0.12;
const HATCH_FOOD_COST = 3;

// Per-tick need changes, in hundredths.
const HUNGER_PER_TICK = 6;
const ENERGY_REST = 60;
const ENERGY_IDLE = 5;
const ENERGY_WORK = 8;
const MOOD_STARVING = 20;
const MOOD_RECOVER = 5;

export const INCENTIVE_COST: Record<IncentiveKind, number> = {
  food: 15,
  shiny: 25,
  drum: 40,
};

// Strength is in tenths so decay can be an integer per tick.
const INCENTIVE_DEFAULTS: Record<IncentiveKind, { strength: number; decay: number; remaining: number }> = {
  food: { strength: 1000, decay: 1, remaining: 8 },
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
  tick: number;
  rng: Rng;
  grid: Grid;
  cave: Point;
  goblins: Goblin[];
  incentives: Incentive[];
  hoard: Hoard;
  log: LogEvent[];
  history: RecordedCommand[];
  private nextId: number;
  private resourceTiles: Point[];
  private pendingCommands: Command[] = [];

  private constructor(d: WorldData) {
    this.seed = d.seed;
    this.startingGoblins = d.startingGoblins;
    this.tick = d.tick;
    this.rng = Rng.fromState(d.rngState);
    this.grid = Grid.fromData(d.grid);
    this.cave = d.cave;
    this.goblins = d.goblins;
    this.incentives = d.incentives;
    this.hoard = d.hoard;
    this.log = d.log;
    this.history = d.history;
    this.nextId = d.nextId;
    this.resourceTiles = this.grid.findAll(Terrain.Resource);
  }

  static create(seed: number, startingGoblins = 6): World {
    const rng = new Rng(seed);
    const { grid, cave } = generateMap(rng);
    const w = new World({
      version: SAVE_VERSION,
      seed,
      startingGoblins,
      tick: 0,
      rngState: rng.getState(),
      grid: grid.toData(),
      cave,
      goblins: [],
      incentives: [],
      hoard: { effort: 0, lifetimeEffort: 0, nextHatchAt: 60, food: 10, shinies: 0, born: 0 },
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
  static replay(seed: number, history: RecordedCommand[], toTick?: number, startingGoblins = 6): World {
    const w = World.create(seed, startingGoblins);
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
    h.int(this.hoard.effort).int(this.hoard.lifetimeEffort).int(this.hoard.nextHatchAt)
      .int(this.hoard.food).int(this.hoard.shinies).int(this.hoard.born);
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
    for (const g of this.goblins) this.updateGoblin(g);
    this.tryHatch();
    this.tick++;
  }

  private applyCommands(): void {
    for (const cmd of this.pendingCommands) {
      this.history.push({ tick: this.tick, command: cmd });
      if (cmd.type === "placeIncentive") this.placeIncentive(cmd.kind, cmd.x, cmd.y);
    }
    this.pendingCommands = [];
  }

  private placeIncentive(kind: IncentiveKind, x: number, y: number): void {
    const cost = INCENTIVE_COST[kind];
    if (!this.grid.isWalkable(x, y)) {
      this.addLog(`You cannot put a ${kind} pile inside a wall.`, "overseer");
      return;
    }
    if (this.hoard.effort < cost) {
      this.addLog(`Not enough effort for a ${kind} pile (need ${cost}).`, "overseer");
      return;
    }
    this.hoard.effort -= cost;
    const def = INCENTIVE_DEFAULTS[kind];
    this.incentives.push({ id: this.nextId++, kind, x, y, strength: def.strength, remaining: def.remaining });
    const what = kind === "drum" ? "a war drum" : `a ${kind} pile`;
    this.addLog(`The overseer placed ${what} at ${x},${y}.`, "overseer");
  }

  private decayIncentives(): void {
    for (const inc of this.incentives) inc.strength -= INCENTIVE_DEFAULTS[inc.kind].decay;
    this.incentives = this.incentives.filter((inc) => inc.strength > 0 && (inc.kind === "drum" || inc.remaining > 0));
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
      const next = g.path.shift() as Point;
      g.x = next.x;
      g.y = next.y;
      if (g.path.length === 0 && g.target && !this.atTarget(g)) g.commitment = 0;
      return;
    }

    if (!g.target || !this.atTarget(g)) return;
    this.performAction(g);
  }

  private decide(g: Goblin): void {
    const choice = chooseAction(g, {
      grid: this.grid,
      cave: this.cave,
      resources: this.resourceTiles,
      incentives: this.incentives,
      hoardFood: this.hoard.food,
      rng: this.rng,
    });
    g.action = choice.action;
    g.target = choice.target;
    g.incentiveId = choice.incentiveId;
    g.commitment = 8 + this.rng.int(0, 16);
    g.path = [];
    if (choice.refused && this.rng.chance(0.15)) this.addLog(choice.refused, "refusal");
    if (choice.target && !this.atTarget(g)) {
      const path = findPath(this.grid, g, choice.target);
      if (path === null) {
        g.action = "idle";
        g.target = null;
        g.incentiveId = null;
      } else {
        g.path = path;
        g.commitment = Math.max(g.commitment, path.length + 6);
      }
    }
  }

  private atTarget(g: Goblin): boolean {
    return g.target !== null && g.x === g.target.x && g.y === g.target.y;
  }

  private performAction(g: Goblin): void {
    switch (g.action) {
      case "gather": {
        if (this.grid.get(g.x, g.y) !== Terrain.Resource) break;
        if (this.rng.chance(0.25 + (g.diligence / TRAIT_MAX) * 0.25)) g.carrying++;
        if (g.carrying >= CARRY_CAPACITY) g.commitment = 0;
        break;
      }
      case "deliver": {
        if (this.grid.get(g.x, g.y) !== Terrain.Cave) break;
        this.hoard.effort += g.carrying;
        this.hoard.lifetimeEffort += g.carrying;
        // Some hauls turn up something edible, so a working hoard feeds itself.
        if (this.rng.chance(FOOD_CHANCE_PER_HAUL)) this.hoard.food++;
        g.carrying = 0;
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
        } else if (this.grid.get(g.x, g.y) === Terrain.Cave && this.hoard.food > 0) {
          this.hoard.food--;
          g.hunger = Math.max(0, g.hunger - 50 * NEED_SCALE);
        } else {
          g.mood = Math.max(-NEED_MAX, g.mood - 1 * NEED_SCALE);
        }
        g.commitment = 0;
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
    while (this.hoard.effort >= this.hoard.nextHatchAt && this.hoard.food >= HATCH_FOOD_COST) {
      this.hoard.effort -= this.hoard.nextHatchAt;
      this.hoard.food -= HATCH_FOOD_COST;
      this.hoard.nextHatchAt = Math.ceil((this.hoard.nextHatchAt * HATCH_GROWTH_PERCENT) / 100);
      const g = this.spawnGoblin();
      this.addLog(`${g.name} hatched. The hoard numbers ${this.goblins.length}.`, "birth");
    }
  }

  private spawnGoblin(): Goblin {
    const g: Goblin = {
      id: this.nextId++,
      name: goblinName(this.rng.int(0, 999), this.rng.int(0, 999)),
      x: this.cave.x,
      y: this.cave.y,
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

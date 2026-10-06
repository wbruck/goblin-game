import { chooseAction } from "./ai";
import { Grid, Terrain, type Point } from "./grid";
import { generateMap } from "./mapgen";
import { goblinName } from "./names";
import { findPath } from "./pathfinding";
import { Rng } from "./rng";
import type { Command, Goblin, Hoard, Incentive, IncentiveKind, LogEvent, StepOptions, WorldData } from "./types";

export const TICK_MS = 250;
export const TICKS_PER_SECOND = 1000 / TICK_MS;

const LOG_LIMIT = 200;
const CARRY_CAPACITY = 6;
const HATCH_GROWTH = 1.15;
const FOOD_CHANCE_PER_HAUL = 0.12;
const HATCH_FOOD_COST = 3;

export const INCENTIVE_COST: Record<IncentiveKind, number> = {
  food: 15,
  shiny: 25,
  drum: 40,
};

const INCENTIVE_DEFAULTS: Record<IncentiveKind, { strength: number; remaining: number }> = {
  food: { strength: 100, remaining: 8 },
  shiny: { strength: 100, remaining: 5 },
  drum: { strength: 120, remaining: 0 },
};

/**
 * The entire game state and its rules. Pure TypeScript, no DOM, no clock.
 * `step` advances exactly one tick. The client drives it from a fixed
 * timestep accumulator; offline catch-up drives it in a tight loop; a
 * future server would drive it the same way.
 */
export class World {
  tick: number;
  rng: Rng;
  grid: Grid;
  cave: Point;
  goblins: Goblin[];
  incentives: Incentive[];
  hoard: Hoard;
  log: LogEvent[];
  private nextId: number;
  private resourceTiles: Point[];
  private pendingCommands: Command[] = [];

  private constructor(d: WorldData) {
    this.tick = d.tick;
    this.rng = Rng.fromState(d.rngState);
    this.grid = Grid.fromData(d.grid);
    this.cave = d.cave;
    this.goblins = d.goblins;
    this.incentives = d.incentives;
    this.hoard = d.hoard;
    this.log = d.log;
    this.nextId = d.nextId;
    this.resourceTiles = this.grid.findAll(Terrain.Resource);
  }

  static create(seed: number, startingGoblins = 6): World {
    const rng = new Rng(seed);
    const { grid, cave } = generateMap(rng);
    const w = new World({
      version: 1,
      tick: 0,
      rngState: rng.getState(),
      grid: grid.toData(),
      cave,
      goblins: [],
      incentives: [],
      hoard: { effort: 0, lifetimeEffort: 0, nextHatchAt: 60, food: 10, shinies: 0, born: 0 },
      nextId: 1,
      log: [],
    });
    for (let i = 0; i < startingGoblins; i++) w.spawnGoblin();
    w.hoard.born = 0;
    w.addLog("The hoard stirs in its cave.", "info");
    return w;
  }

  static fromData(d: WorldData): World {
    if (d.version !== 1) throw new Error(`Unsupported save version ${String(d.version)}`);
    return new World(d);
  }

  toData(): WorldData {
    return {
      version: 1,
      tick: this.tick,
      rngState: this.rng.getState(),
      grid: this.grid.toData(),
      cave: this.cave,
      goblins: this.goblins,
      incentives: this.incentives,
      hoard: this.hoard,
      nextId: this.nextId,
      log: this.log,
    };
  }

  /** Queue an overseer command; it is applied at the start of the next tick. */
  enqueue(cmd: Command): void {
    this.pendingCommands.push(cmd);
  }

  step(opts: StepOptions = {}): void {
    const offline = opts.offline ?? false;
    this.applyCommands();
    this.decayIncentives();
    for (const g of this.goblins) this.updateGoblin(g, offline);
    this.tryHatch();
    this.tick++;
  }

  private applyCommands(): void {
    for (const cmd of this.pendingCommands) {
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
    this.addLog(`The overseer placed a ${kind} ${kind === "drum" ? "" : "pile "}at ${x},${y}.`.replace("  ", " "), "overseer");
  }

  private decayIncentives(): void {
    for (const inc of this.incentives) inc.strength -= inc.kind === "drum" ? 0.5 : 0.1;
    this.incentives = this.incentives.filter((inc) => inc.strength > 0 && (inc.kind === "drum" || inc.remaining > 0));
  }

  private updateGoblin(g: Goblin, offline: boolean): void {
    // Needs drift every tick. Working costs energy; resting restores it.
    g.hunger = Math.min(100, g.hunger + 0.06);
    if (g.action === "rest") g.energy = Math.min(100, g.energy + 0.6);
    else if (g.action === "idle" || g.action === "wander") g.energy = Math.min(100, g.energy + 0.05);
    else g.energy = Math.max(0, g.energy - 0.08);
    if (g.hunger > 80) g.mood = Math.max(-100, g.mood - 0.2);
    else if (g.mood < 0) g.mood = Math.min(0, g.mood + 0.05);

    // Reconsider when the current plan is finished or commitment runs out.
    g.commitment--;
    if (g.commitment <= 0 || (g.path.length === 0 && g.target && !this.atTarget(g))) {
      this.decide(g, offline);
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

  private decide(g: Goblin, offline: boolean): void {
    const choice = chooseAction(g, {
      grid: this.grid,
      cave: this.cave,
      resources: this.resourceTiles,
      incentives: this.incentives,
      hoardFood: this.hoard.food,
      rng: this.rng,
      offline,
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
        if (this.rng.chance(0.25 + g.diligence * 0.25)) g.carrying++;
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
        g.mood = Math.min(100, g.mood + 2);
        g.commitment = 0;
        break;
      }
      case "eat": {
        const inc = g.incentiveId !== null ? this.incentiveById(g.incentiveId) : null;
        if (inc && inc.remaining > 0) {
          inc.remaining--;
          g.hunger = Math.max(0, g.hunger - 60);
          g.mood = Math.min(100, g.mood + 10);
          g.commitment = 0;
        } else if (this.grid.get(g.x, g.y) === Terrain.Cave && this.hoard.food > 0) {
          this.hoard.food--;
          g.hunger = Math.max(0, g.hunger - 50);
          g.commitment = 0;
        } else {
          g.mood = Math.max(-100, g.mood - 1);
          g.commitment = 0;
        }
        break;
      }
      case "rest": {
        if (g.energy >= 95) g.commitment = 0;
        break;
      }
      case "loot": {
        const inc = g.incentiveId !== null ? this.incentiveById(g.incentiveId) : null;
        if (inc && inc.remaining > 0) {
          inc.remaining--;
          this.hoard.shinies++;
          g.mood = Math.min(100, g.mood + 5);
          // A greedy goblin sometimes pockets the shiny instead.
          if (this.rng.chance(g.greed * 0.3)) {
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
      this.hoard.nextHatchAt = Math.ceil(this.hoard.nextHatchAt * HATCH_GROWTH);
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
      hunger: this.rng.int(10, 40),
      energy: this.rng.int(60, 100),
      mood: this.rng.int(-10, 30),
      greed: this.rng.next(),
      bravery: this.rng.next(),
      diligence: this.rng.next(),
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

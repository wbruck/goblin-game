import type { CubeData, Tile } from "./cube";

export type ActionKind =
  | "idle"
  | "wander"
  | "gather"
  | "deliver"
  | "eat"
  | "rest"
  | "loot"
  | "rally";

/** Fixed-point scale for needs and mood: 100 units = 1 point on a 0..100 scale. */
export const NEED_SCALE = 100;
export const NEED_MAX = 100 * NEED_SCALE;
export const TRAIT_MAX = 255;

/**
 * All numeric goblin state is integer so that a replay on any machine, in
 * any language, produces identical bits. Needs are in hundredths, traits
 * are 0..255. See docs section 2.3.
 */
export interface Goblin {
  id: number;
  name: string;
  tile: Tile;
  /** 0 (full) to NEED_MAX (starving). */
  hunger: number;
  /** 0 (exhausted) to NEED_MAX (fresh). */
  energy: number;
  /** -NEED_MAX (furious) to NEED_MAX (delighted). Low mood makes goblins sulk. */
  mood: number;
  /** Fixed temperament, 0..TRAIT_MAX. */
  greed: number;
  bravery: number;
  diligence: number;
  action: ActionKind;
  target: Tile | null;
  path: Tile[];
  /** Resources carried back to the cave. */
  carrying: number;
  /** Ticks until the goblin reconsiders what it is doing. */
  commitment: number;
  /** Incentive id this goblin is responding to, if any. */
  incentiveId: number | null;
}

export type IncentiveKind = "food" | "shiny" | "drum";

export interface Incentive {
  id: number;
  kind: IncentiveKind;
  tile: Tile;
  /** Pull strength in tenths. Decays each tick; removed at zero. */
  strength: number;
  /** Remaining units for consumable incentives (food, shiny). */
  remaining: number;
}

export interface Hoard {
  /** The displayed growth metric. Integer. */
  effort: number;
  /** Total effort ever delivered, never spent. Used for reports. */
  lifetimeEffort: number;
  /** Effort needed before the next goblin hatches. */
  nextHatchAt: number;
  food: number;
  shinies: number;
  born: number;
}

export interface LogEvent {
  tick: number;
  text: string;
  kind: "info" | "refusal" | "birth" | "overseer";
}

export type Command =
  | { type: "placeIncentive"; kind: IncentiveKind; tile: Tile };

/** A command together with the tick on which it was applied. */
export interface RecordedCommand {
  tick: number;
  command: Command;
}

export interface WorldData {
  version: 3;
  seed: number;
  startingGoblins: number;
  /** Tiles per cube side. */
  size: number;
  tick: number;
  rngState: number;
  grid: CubeData;
  /** Cave tiles, where goblins eat, rest, deliver and hatch. */
  cave: Tile[];
  goblins: Goblin[];
  incentives: Incentive[];
  hoard: Hoard;
  nextId: number;
  log: LogEvent[];
  /** Every command ever applied, in order. Seed + history replays the world. */
  history: RecordedCommand[];
}

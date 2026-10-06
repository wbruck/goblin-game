import type { GridData, Point } from "./grid";

export type ActionKind =
  | "idle"
  | "wander"
  | "gather"
  | "deliver"
  | "eat"
  | "rest"
  | "loot"
  | "rally";

export interface Goblin {
  id: number;
  name: string;
  x: number;
  y: number;
  /** 0 (full) to 100 (starving). */
  hunger: number;
  /** 0 (exhausted) to 100 (fresh). */
  energy: number;
  /** -100 (furious) to 100 (delighted). Low mood makes goblins sulk. */
  mood: number;
  /** Fixed temperament, 0 to 1. */
  greed: number;
  bravery: number;
  diligence: number;
  action: ActionKind;
  target: Point | null;
  path: Point[];
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
  x: number;
  y: number;
  /** Pull strength. Decays each tick; removed at zero. */
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
  | { type: "placeIncentive"; kind: IncentiveKind; x: number; y: number };

export interface WorldData {
  version: 1;
  tick: number;
  rngState: number;
  grid: GridData;
  cave: Point;
  goblins: Goblin[];
  incentives: Incentive[];
  hoard: Hoard;
  nextId: number;
  log: LogEvent[];
}

export interface StepOptions {
  /** Offline replay: goblins stay cautious and nothing can destroy the hoard. */
  offline?: boolean;
}

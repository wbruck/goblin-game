import { type CubeGrid, type Tile } from "./cube";
import type { Rng } from "./rng";
import { NEED_MAX, TRAIT_MAX, type ActionKind, type Goblin, type Incentive, type Motive } from "./types";

export interface Choice {
  action: ActionKind;
  target: Tile | null;
  incentiveId: number | null;
  score: number;
  /** What drove this choice, for display. */
  motive: Motive;
  /** Set when the goblin passed over an incentive it could have followed. */
  refused?: string;
}

export interface AiContext {
  grid: CubeGrid;
  /** A cave tile to head for; the world picks the nearest for each goblin. */
  cave: Tile;
  resources: Tile[];
  incentives: Incentive[];
  /** Food units stored in the warren. */
  warren: number;
  warrenCapacity: number;
  rng: Rng;
}

/** Mood below this is sulking: work drops off, incentives get ignored. */
export const SULK_MOOD = -40 * 100;

/**
 * Utility AI: score every candidate action from the goblin's needs, its
 * temperament, and the incentives on the board, then take the best one.
 * Noise from the seeded rng keeps the hoard from moving as one block and
 * is where most of the "unruly" behaviour comes from. The overseer never
 * sets a priority directly; the only levers are things in the world.
 *
 * Scores are doubles computed from integer state and the seeded rng with
 * only +, -, * and /, which IEEE 754 makes identical on every engine.
 * Distances are cube-surface lower bounds; on a 4-cube the farthest tile
 * is about 10 steps away, so distance penalties are scaled for that.
 */
export function chooseAction(g: Goblin, ctx: AiContext): Choice {
  const candidates: Choice[] = [];
  const noise = () => (ctx.rng.next() - 0.5) * 0.3;
  const sulking = g.mood < SULK_MOOD;
  const hunger = g.hunger / NEED_MAX;
  const energy = g.energy / NEED_MAX;
  const greed = g.greed / TRAIT_MAX;
  const bravery = g.bravery / TRAIT_MAX;
  const diligence = g.diligence / TRAIT_MAX;
  const far = 3 * ctx.grid.size; // roughly the longest trip on the cube
  const dist = (t: Tile) => ctx.grid.distance(g.tile, t) / far;

  // Needs first. Like Oxygen Not Included, needs override everything else
  // when they get urgent, but goblins also drift toward them earlier.
  if (hunger > 0.35) {
    const atCave = hunger + (ctx.warren > 0 ? 0.2 : -0.6) + noise();
    candidates.push({ action: "eat", target: ctx.cave, incentiveId: null, score: atCave, motive: "hungry" });
    for (const inc of ctx.incentives) {
      if (inc.kind !== "food" || inc.remaining <= 0) continue;
      // Greedy goblins would rather eat the pile than carry it home.
      const pull = hunger * 1.1 + 0.3 + greed * 0.3 - dist(inc.tile) * 0.8 + noise();
      candidates.push({ action: "eat", target: inc.tile, incentiveId: inc.id, score: pull, motive: "hungry" });
    }
  }
  if (energy < 0.4) {
    candidates.push({ action: "rest", target: ctx.cave, incentiveId: null, score: 1 - energy + noise(), motive: "tired" });
  }

  // Work. Diligent goblins like gathering; sulking goblins do not.
  if (g.carrying > 0 || g.carryingFood > 0) {
    candidates.push({
      action: "deliver",
      target: ctx.cave,
      incentiveId: null,
      score: 0.55 + g.carrying / 20 + g.carryingFood / 10 + diligence * 0.2 + noise(),
      motive: "hauling",
    });
  } else if (ctx.resources.length > 0 && !sulking) {
    const nearest = nearestOf(ctx.grid, g.tile, ctx.resources, ctx.rng);
    candidates.push({
      action: "gather",
      target: nearest,
      incentiveId: null,
      score: 0.35 + diligence * 0.4 - dist(nearest) * 0.6 + noise(),
      motive: "diligent",
    });
  }

  // Foraging: carry food from a pile back to the warren. An emptier warren
  // pulls harder.
  if (g.carrying === 0 && g.carryingFood === 0) {
    const empty = ctx.warrenCapacity > 0 ? 1 - ctx.warren / ctx.warrenCapacity : 0;
    for (const inc of ctx.incentives) {
      if (inc.kind !== "food" || inc.remaining <= 0) continue;
      candidates.push({
        action: "forage",
        target: inc.tile,
        incentiveId: inc.id,
        score: 0.3 + diligence * 0.4 + empty * 0.5 - dist(inc.tile) + noise(),
        motive: "foraging",
      });
    }
  }

  // Overseer incentives. Shinies pull on greed, drums on bravery.
  for (const inc of ctx.incentives) {
    const strength = inc.strength / 1000;
    if (inc.kind === "shiny" && inc.remaining > 0 && g.carrying === 0) {
      candidates.push({
        action: "loot",
        target: inc.tile,
        incentiveId: inc.id,
        score: 0.2 + greed * 0.7 + strength / 2 - dist(inc.tile) + noise(),
        motive: "greedy",
      });
    }
    if (inc.kind === "drum") {
      const fear = (1 - bravery) * 0.6;
      candidates.push({
        action: "rally",
        target: inc.tile,
        incentiveId: inc.id,
        score: 0.25 + bravery * 0.6 + strength / 2 - fear - dist(inc.tile) + noise(),
        motive: "brave",
      });
    }
  }

  // Doing nothing in particular is always on the table.
  const aimless: Motive = sulking ? "sulking" : "bored";
  candidates.push({
    action: "wander",
    target: randomNearbyFloor(g.tile, ctx.grid, ctx.rng),
    incentiveId: null,
    score: 0.3 + (sulking ? 0.4 : 0) + noise(),
    motive: aimless,
  });
  candidates.push({
    action: "idle",
    target: null,
    incentiveId: null,
    score: 0.15 + (sulking ? 0.3 : 0) + noise(),
    motive: aimless,
  });

  let best = candidates[0] as Choice;
  for (const c of candidates) if (c.score > best.score) best = c;

  // Record a refusal when an incentive was available and lost to idling.
  if (best.incentiveId === null && (best.action === "wander" || best.action === "idle")) {
    const skipped = candidates.find((c) => c.incentiveId !== null);
    if (skipped) best = { ...best, refused: refusalReason(g, skipped, sulking, bravery, greed) };
  }
  return best;
}

function refusalReason(g: Goblin, skipped: Choice, sulking: boolean, bravery: number, greed: number): string {
  const thing = skipped.action === "rally" ? "drum" : "pile";
  if (sulking) return `${g.name} is sulking and ignored the ${thing}`;
  if (skipped.action === "rally" && bravery < 0.4) return `${g.name} heard the drum and decided it was too scary`;
  if (skipped.action === "loot" && greed < 0.4) return `${g.name} couldn't be bothered to fetch the shinies`;
  return `${g.name} wandered off instead of following the ${thing}`;
}

function nearestOf(grid: CubeGrid, from: Tile, points: Tile[], rng: Rng): Tile {
  // Among the few nearest, pick randomly so goblins spread out.
  const sorted = points
    .map((p) => ({ p, d: grid.distance(from, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((e) => e.p);
  return rng.pick(sorted);
}

function randomNearbyFloor(from: Tile, grid: CubeGrid, rng: Rng): Tile {
  // A short random walk across walkable tiles, edges included.
  let t = from;
  const steps = rng.int(1, 3);
  for (let i = 0; i < steps; i++) {
    const options = grid.neighbors(t);
    if (options.length === 0) break;
    t = rng.pick(options);
  }
  return t;
}

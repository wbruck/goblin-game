import { manhattan, Terrain, type Grid, type Point } from "./grid";
import type { Rng } from "./rng";
import { NEED_MAX, TRAIT_MAX, type ActionKind, type Goblin, type Incentive } from "./types";

export interface Choice {
  action: ActionKind;
  target: Point | null;
  incentiveId: number | null;
  score: number;
  /** Set when the goblin passed over an incentive it could have followed. */
  refused?: string;
}

export interface AiContext {
  grid: Grid;
  cave: Point;
  resources: Point[];
  incentives: Incentive[];
  hoardFood: number;
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

  // Needs first. Like Oxygen Not Included, needs override everything else
  // when they get urgent, but goblins also drift toward them earlier.
  if (hunger > 0.35) {
    const atCave = hunger + (ctx.hoardFood > 0 ? 0.2 : -0.6) + noise();
    candidates.push({ action: "eat", target: ctx.cave, incentiveId: null, score: atCave });
    for (const inc of ctx.incentives) {
      if (inc.kind !== "food" || inc.remaining <= 0) continue;
      const dist = manhattan(g, inc);
      const pull = hunger * 1.1 + 0.3 - dist / 60 + noise();
      candidates.push({ action: "eat", target: { x: inc.x, y: inc.y }, incentiveId: inc.id, score: pull });
    }
  }
  if (energy < 0.4) {
    candidates.push({ action: "rest", target: ctx.cave, incentiveId: null, score: 1 - energy + noise() });
  }

  // Work. Diligent goblins like gathering; sulking goblins do not.
  if (g.carrying > 0) {
    candidates.push({
      action: "deliver",
      target: ctx.cave,
      incentiveId: null,
      score: 0.55 + g.carrying / 20 + diligence * 0.2 + noise(),
    });
  } else if (ctx.resources.length > 0 && !sulking) {
    const nearest = nearestOf(g, ctx.resources, ctx.rng);
    candidates.push({
      action: "gather",
      target: nearest,
      incentiveId: null,
      score: 0.35 + diligence * 0.4 - manhattan(g, nearest) / 80 + noise(),
    });
  }

  // Overseer incentives. Shinies pull on greed, drums on bravery.
  for (const inc of ctx.incentives) {
    const strength = inc.strength / 1000;
    if (inc.kind === "shiny" && inc.remaining > 0 && g.carrying === 0) {
      const dist = manhattan(g, inc);
      candidates.push({
        action: "loot",
        target: { x: inc.x, y: inc.y },
        incentiveId: inc.id,
        score: 0.2 + greed * 0.7 + strength / 2 - dist / 50 + noise(),
      });
    }
    if (inc.kind === "drum") {
      const dist = manhattan(g, inc);
      const fear = (1 - bravery) * 0.6;
      candidates.push({
        action: "rally",
        target: { x: inc.x, y: inc.y },
        incentiveId: inc.id,
        score: 0.25 + bravery * 0.6 + strength / 2 - fear - dist / 50 + noise(),
      });
    }
  }

  // Doing nothing in particular is always on the table.
  candidates.push({
    action: "wander",
    target: randomNearbyFloor(g, ctx.grid, ctx.rng),
    incentiveId: null,
    score: 0.3 + (sulking ? 0.4 : 0) + noise(),
  });
  candidates.push({ action: "idle", target: null, incentiveId: null, score: 0.15 + (sulking ? 0.3 : 0) + noise() });

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

function nearestOf(from: Point, points: Point[], rng: Rng): Point {
  // Among the few nearest, pick randomly so goblins spread out.
  const sorted = points
    .map((p) => ({ p, d: manhattan(from, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((e) => e.p);
  return rng.pick(sorted);
}

function randomNearbyFloor(from: Point, grid: Grid, rng: Rng): Point {
  for (let i = 0; i < 8; i++) {
    const x = from.x + rng.int(-4, 4);
    const y = from.y + rng.int(-4, 4);
    if (grid.isWalkable(x, y) && grid.get(x, y) !== Terrain.Wall) return { x, y };
  }
  return { x: from.x, y: from.y };
}

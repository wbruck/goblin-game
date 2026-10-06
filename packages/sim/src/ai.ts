import { manhattan, Terrain, type Grid, type Point } from "./grid";
import type { Rng } from "./rng";
import type { ActionKind, Goblin, Incentive } from "./types";

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
  offline: boolean;
}

/**
 * Utility AI: score every candidate action from the goblin's needs, its
 * temperament, and the incentives on the board, then take the best one.
 * Noise from the seeded rng keeps the hoard from moving as one block and
 * is where most of the "unruly" behaviour comes from. The overseer never
 * sets a priority directly; the only levers are things in the world.
 */
export function chooseAction(g: Goblin, ctx: AiContext): Choice {
  const candidates: Choice[] = [];
  const noise = () => (ctx.rng.next() - 0.5) * 0.3;
  const sulking = g.mood < -40;

  // Needs first. Like Oxygen Not Included, needs override everything else
  // when they get urgent, but goblins also drift toward them earlier.
  if (g.hunger > 35) {
    const atCave = g.hunger / 100 + (ctx.hoardFood > 0 ? 0.2 : -0.6) + noise();
    candidates.push({ action: "eat", target: ctx.cave, incentiveId: null, score: atCave });
    for (const inc of ctx.incentives) {
      if (inc.kind !== "food" || inc.remaining <= 0) continue;
      const dist = manhattan(g, inc);
      const pull = (g.hunger / 100) * 1.1 + 0.3 - dist / 60 + noise();
      candidates.push({ action: "eat", target: { x: inc.x, y: inc.y }, incentiveId: inc.id, score: pull });
    }
  }
  if (g.energy < 40) {
    candidates.push({
      action: "rest",
      target: ctx.cave,
      incentiveId: null,
      score: (100 - g.energy) / 100 + noise(),
    });
  }

  // Work. Diligent goblins like gathering; sulking goblins do not.
  if (g.carrying > 0) {
    candidates.push({
      action: "deliver",
      target: ctx.cave,
      incentiveId: null,
      score: 0.55 + g.carrying / 20 + g.diligence * 0.2 + noise(),
    });
  } else if (ctx.resources.length > 0 && !sulking) {
    const nearest = nearestOf(g, ctx.resources, ctx.rng);
    candidates.push({
      action: "gather",
      target: nearest,
      incentiveId: null,
      score: 0.35 + g.diligence * 0.4 - manhattan(g, nearest) / 80 + noise(),
    });
  }

  // Overseer incentives. Shinies pull on greed, drums on bravery.
  for (const inc of ctx.incentives) {
    if (inc.kind === "shiny" && inc.remaining > 0 && g.carrying === 0) {
      const dist = manhattan(g, inc);
      candidates.push({
        action: "loot",
        target: { x: inc.x, y: inc.y },
        incentiveId: inc.id,
        score: 0.2 + g.greed * 0.7 + inc.strength / 200 - dist / 50 + noise(),
      });
    }
    if (inc.kind === "drum" && !ctx.offline) {
      const dist = manhattan(g, inc);
      const fear = (1 - g.bravery) * 0.6;
      candidates.push({
        action: "rally",
        target: { x: inc.x, y: inc.y },
        incentiveId: inc.id,
        score: 0.25 + g.bravery * 0.6 + inc.strength / 200 - fear - dist / 50 + noise(),
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
    if (skipped) {
      best = { ...best, refused: refusalReason(g, skipped, sulking) };
    }
  }
  return best;
}

function refusalReason(g: Goblin, skipped: Choice, sulking: boolean): string {
  if (sulking) return `${g.name} is sulking and ignored the ${skipped.action === "rally" ? "drum" : "pile"}`;
  if (skipped.action === "rally" && g.bravery < 0.4) return `${g.name} heard the drum and decided it was too scary`;
  if (skipped.action === "loot" && g.greed < 0.4) return `${g.name} couldn't be bothered to fetch the shinies`;
  return `${g.name} wandered off instead of following the ${skipped.action === "rally" ? "drum" : "pile"}`;
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

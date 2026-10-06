import { FACES, Terrain, type Goblin, type Tile, type Vec3, type World } from "@goblin/sim";

// One colour for the whole board; only the warren (cave) stands out.
const BOARD_COLOR: [number, number, number] = [74, 92, 60];
const WARREN_COLOR: [number, number, number] = [120, 70, 48];
const MUSHROOM_COLOR = "#f3e9c9";
const GOBLIN_COLOR = "#e0c070";

export interface View {
  /** Rotation about the vertical axis, radians. */
  yaw: number;
  /** Rotation about the horizontal axis, radians. Clamped so the cube never flips. */
  pitch: number;
}

type Vec2 = [number, number];

/**
 * Software-projected cube on Canvas 2D. The sim knows nothing about this
 * file. Faces are rotated by the view, back faces culled, and visible
 * faces drawn tile by tile as projected quads. Orthographic projection
 * keeps picking exact: a tile is hit when the pointer is inside its quad.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private scale = 1;
  private light: Vec3 = normalize([-0.4, 0.8, 1]);

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    this.ctx = ctx;
  }

  resize(world: World): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    // A cube spans up to sqrt(3) * size when seen corner-on.
    this.scale = (Math.min(rect.width, rect.height) * 0.9) / (world.size * Math.sqrt(3));
  }

  private rotate(p: Vec3, view: View): Vec3 {
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const x1 = p[0] * cy + p[2] * sy;
    const z1 = -p[0] * sy + p[2] * cy;
    const cp = Math.cos(view.pitch);
    const sp = Math.sin(view.pitch);
    const y2 = p[1] * cp - z1 * sp;
    const z2 = p[1] * sp + z1 * cp;
    return [x1, y2, z2];
  }

  private project(p: Vec3): Vec2 {
    return [this.width / 2 + p[0] * this.scale, this.height / 2 - p[1] * this.scale];
  }

  /** Faces whose outward normal points toward the viewer, nearest last. */
  private visibleFaces(view: View): { f: number; depth: number; shade: number }[] {
    const out: { f: number; depth: number; shade: number }[] = [];
    for (let f = 0; f < 6; f++) {
      const n = this.rotate(FACES[f]!.n, view);
      if (n[2] <= 0) continue;
      const lit = Math.max(0, n[0] * this.light[0] + n[1] * this.light[1] + n[2] * this.light[2]);
      out.push({ f, depth: n[2], shade: 0.55 + 0.45 * lit });
    }
    return out.sort((a, b) => a.depth - b.depth);
  }

  private tileQuad(world: World, t: Tile, view: View): Vec2[] {
    return world.grid.corners(t).map((c) => this.project(this.rotate(c, view)));
  }

  /** Tile under a canvas-relative point, or null. Front-most face wins. */
  pick(clientX: number, clientY: number, world: World, view: View): Tile | null {
    const rect = this.canvas.getBoundingClientRect();
    const p: Vec2 = [clientX - rect.left, clientY - rect.top];
    const faces = this.visibleFaces(view).reverse();
    const n = world.size;
    for (const { f } of faces) {
      for (let v = 0; v < n; v++) {
        for (let u = 0; u < n; u++) {
          const t = { f, u, v };
          if (pointInQuad(p, this.tileQuad(world, t, view))) return t;
        }
      }
    }
    return null;
  }

  draw(world: World, alpha: number, hover: Tile | null, view: View, selectedId: number | null = null): void {
    const { ctx } = this;
    ctx.fillStyle = "#0d0c09";
    ctx.fillRect(0, 0, this.width, this.height);

    const faces = this.visibleFaces(view);
    const n = world.size;

    for (const { f, shade } of faces) {
      for (let v = 0; v < n; v++) {
        for (let u = 0; u < n; u++) {
          const t = { f, u, v };
          const quad = this.tileQuad(world, t, view);
          const [r, g, b] = world.grid.get(t) === Terrain.Cave ? WARREN_COLOR : BOARD_COLOR;
          ctx.fillStyle = `rgb(${r * shade | 0},${g * shade | 0},${b * shade | 0})`;
          fillQuad(ctx, quad);
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = 1;
          strokeQuad(ctx, quad);
        }
      }
    }

    // Incentives and goblins, drawn after every visible face so they sit on top.
    const visible = new Set(faces.map((x) => x.f));
    const r = this.scale * 0.3;

    for (const inc of world.incentives) {
      if (!visible.has(inc.tile.f)) continue;
      const [cx, cy] = this.project(this.rotate(world.grid.center(inc.tile), view));
      const size = r * (0.7 + 0.3 * Math.min(1, inc.strength / 1000));
      ctx.beginPath();
      ctx.arc(cx, cy, size, 0, Math.PI * 2);
      ctx.fillStyle = inc.kind === "food" ? MUSHROOM_COLOR : inc.kind === "shiny" ? "#f6e27a" : "#c25a3a";
      ctx.fill();
      if (inc.kind === "drum") {
        ctx.strokeStyle = "rgba(194,90,58,0.5)";
        ctx.beginPath();
        ctx.arc(cx, cy, size + 3 + 4 * Math.sin(performance.now() / 150), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const gob of world.goblins) {
      const next = gob.path[0];
      const from = this.rotate(world.grid.center(gob.tile), view);
      let pos = from;
      if (next) {
        const to = this.rotate(world.grid.center(next), view);
        pos = [from[0] + (to[0] - from[0]) * alpha, from[1] + (to[1] - from[1]) * alpha, from[2] + (to[2] - from[2]) * alpha];
      }
      // Hide goblins on the far side; those mid-crossing fade with depth.
      const faceVisible = visible.has(gob.tile.f) || (next !== undefined && visible.has(next.f));
      if (!faceVisible) continue;
      const [px, py] = this.project(pos);
      ctx.beginPath();
      ctx.arc(px, py, r * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = GOBLIN_COLOR;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (gob.id === selectedId) {
        ctx.beginPath();
        ctx.arc(px, py, r * 1.3 + 2, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    if (hover && visible.has(hover.f)) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      strokeQuad(ctx, this.tileQuad(world, hover, view));
    }
  }
}

function fillQuad(ctx: CanvasRenderingContext2D, q: Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(q[0]![0], q[0]![1]);
  for (let i = 1; i < q.length; i++) ctx.lineTo(q[i]![0], q[i]![1]);
  ctx.closePath();
  ctx.fill();
}

function strokeQuad(ctx: CanvasRenderingContext2D, q: Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(q[0]![0], q[0]![1]);
  for (let i = 1; i < q.length; i++) ctx.lineTo(q[i]![0], q[i]![1]);
  ctx.closePath();
  ctx.stroke();
}

/** Point in convex polygon by consistent cross-product sign. */
function pointInQuad(p: Vec2, q: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % q.length]!;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

import { Terrain, type Goblin, type World } from "@goblin/sim";

const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Floor]: "#2b2a22",
  [Terrain.Wall]: "#4a4238",
  [Terrain.Cave]: "#5a3a2a",
  [Terrain.Resource]: "#3d6b2e",
};

const ACTION_COLORS: Record<Goblin["action"], string> = {
  idle: "#8a8a8a",
  wander: "#b0a070",
  gather: "#8fbf4a",
  deliver: "#c8e07a",
  eat: "#e0a63a",
  rest: "#6a7fbf",
  loot: "#f0d060",
  rally: "#c25a3a",
};

/**
 * Plain Canvas 2D behind a small interface. The sim knows nothing about
 * this file; swap it for PixiJS later if sprite counts grow.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  tileSize = 16;
  offsetX = 0;
  offsetY = 0;

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
    this.tileSize = Math.max(6, Math.floor(Math.min(rect.width / world.grid.width, rect.height / world.grid.height)));
    this.offsetX = Math.floor((rect.width - this.tileSize * world.grid.width) / 2);
    this.offsetY = Math.floor((rect.height - this.tileSize * world.grid.height) / 2);
  }

  /** Convert a pointer position to a tile, or null when off the board. */
  tileAt(clientX: number, clientY: number, world: World): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.offsetX) / this.tileSize);
    const y = Math.floor((clientY - rect.top - this.offsetY) / this.tileSize);
    return world.grid.inBounds(x, y) ? { x, y } : null;
  }

  draw(world: World, alpha: number, hover: { x: number; y: number } | null): void {
    const { ctx, tileSize: t } = this;
    const rect = this.canvas.getBoundingClientRect();
    ctx.fillStyle = "#0d0c09";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);

    const g = world.grid;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        ctx.fillStyle = TERRAIN_COLORS[g.get(x, y)] ?? "#f0f";
        ctx.fillRect(x * t, y * t, t, t);
      }
    }
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= g.width; x++) {
      ctx.beginPath(); ctx.moveTo(x * t + 0.5, 0); ctx.lineTo(x * t + 0.5, g.height * t); ctx.stroke();
    }
    for (let y = 0; y <= g.height; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * t + 0.5); ctx.lineTo(g.width * t, y * t + 0.5); ctx.stroke();
    }

    for (const inc of world.incentives) {
      const cx = inc.x * t + t / 2;
      const cy = inc.y * t + t / 2;
      const r = t * 0.4 * (0.6 + 0.4 * Math.min(1, inc.strength / 100));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = inc.kind === "food" ? "#e0a63a" : inc.kind === "shiny" ? "#f6e27a" : "#c25a3a";
      ctx.fill();
      if (inc.kind === "drum") {
        ctx.strokeStyle = "rgba(194,90,58,0.5)";
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3 + 4 * Math.sin(performance.now() / 150), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const gob of world.goblins) {
      // Interpolate toward the next path tile so 4 ticks/second looks smooth.
      let dx = 0;
      let dy = 0;
      const next = gob.path[0];
      if (next) {
        dx = (next.x - gob.x) * alpha;
        dy = (next.y - gob.y) * alpha;
      }
      const px = (gob.x + dx) * t + t / 2;
      const py = (gob.y + dy) * t + t / 2;
      ctx.beginPath();
      ctx.arc(px, py, t * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = ACTION_COLORS[gob.action];
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.stroke();
      if (gob.carrying > 0) {
        ctx.fillStyle = "#3d6b2e";
        ctx.fillRect(px - 2, py - t * 0.5, 4, 4);
      }
      if (gob.mood < -40) {
        ctx.fillStyle = "#fff";
        ctx.font = `${Math.max(8, t * 0.6)}px sans-serif`;
        ctx.fillText("!", px + t * 0.25, py - t * 0.2);
      }
    }

    if (hover) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * t + 1, hover.y * t + 1, t - 2, t - 2);
    }
    ctx.restore();
  }
}

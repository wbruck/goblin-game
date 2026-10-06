import { CatchUp, DEFAULT_OFFLINE_CAP_MS, INCENTIVE_COST, TICK_MS, World, type CatchUpReport, type IncentiveKind } from "@goblin/sim";
import { Renderer } from "./renderer";
import { clear, load, save } from "./storage";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLUListElement;
const toolsEl = document.getElementById("tool-buttons") as HTMLDivElement;
const reportEl = document.getElementById("return-report") as HTMLDivElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;

const renderer = new Renderer(canvas);
let world: World;
let tool: IncentiveKind | null = null;
let hover: { x: number; y: number } | null = null;
let accumulator = 0;
let lastFrame = 0;
let lastSave = 0;
let catchingUp: CatchUp | null = null;

const SAVE_INTERVAL_MS = 5000;
const MAX_FRAME_MS = 1000; // Beyond this the tab was asleep; treat the gap as offline time.
const CATCHUP_BUDGET_MS = 80;
const CATCHUP_TICKS_PER_SLICE = 50;

function boot(): void {
  const file = load();
  if (file) {
    world = World.fromData(file.world);
    const elapsed = Date.now() - file.savedAt;
    if (elapsed > 30_000) startCatchUp(elapsed);
  } else {
    world = World.create((Date.now() ^ 0x9e3779b9) >>> 0);
  }
  renderer.resize(world);
  buildTools();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

function startCatchUp(elapsedMs: number): void {
  catchingUp = new CatchUp(world, elapsedMs, DEFAULT_OFFLINE_CAP_MS);
  reportEl.classList.remove("hidden");
  reportEl.innerHTML = `<div class="card"><h2>The hoard was busy...</h2><p>Replaying ${fmtDuration(catchingUp.report.simulatedMs)} of goblin time.</p><progress value="0" max="1"></progress></div>`;
}

function frame(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;

  if (catchingUp) {
    // Spend a fixed slice of wall time per frame so the progress bar keeps
    // moving while the replay runs as fast as the device allows.
    const deadline = performance.now() + CATCHUP_BUDGET_MS;
    let done = false;
    do {
      done = catchingUp.run(CATCHUP_TICKS_PER_SLICE);
    } while (!done && performance.now() < deadline);
    const bar = reportEl.querySelector("progress");
    if (bar) bar.value = catchingUp.progress;
    if (done) {
      showReport(catchingUp.report);
      catchingUp = null;
      save(world);
    }
    renderer.draw(world, 0, null);
    requestAnimationFrame(frame);
    return;
  }

  if (dt > MAX_FRAME_MS) {
    // Tab was hidden or the device slept. Same code path as a cold start.
    startCatchUp(dt);
    requestAnimationFrame(frame);
    return;
  }

  accumulator += dt;
  while (accumulator >= TICK_MS) {
    world.step();
    accumulator -= TICK_MS;
  }

  renderer.draw(world, accumulator / TICK_MS, hover);
  updateStats();
  updateLog();
  if (now - lastSave > SAVE_INTERVAL_MS) {
    save(world);
    lastSave = now;
  }
  requestAnimationFrame(frame);
}

function showReport(r: CatchUpReport): void {
  const events = r.events.slice(-6).map((e) => `<li>${escapeHtml(e.text)}</li>`).join("");
  const discarded = r.discardedMs > 0
    ? `<p class="hint">You were away ${fmtDuration(r.elapsedMs)}. Goblins only work for ${fmtDuration(DEFAULT_OFFLINE_CAP_MS)} without supervision, so ${fmtDuration(r.discardedMs)} went unused.</p>`
    : "";
  reportEl.innerHTML = `<div class="card">
    <h2>Welcome back, Overseer</h2>
    <p>While you were gone for ${fmtDuration(r.simulatedMs)}:</p>
    <ul>
      <li><b>${r.effortGained}</b> effort gathered</li>
      <li><b>${r.goblinsBorn}</b> goblins hatched (hoard is now ${world.goblins.length})</li>
      ${r.shiniesGained ? `<li><b>${r.shiniesGained}</b> shinies hoarded</li>` : ""}
    </ul>
    ${events ? `<p>Notable happenings:</p><ul>${events}</ul>` : ""}
    ${discarded}
    <button id="close-report">Back to the hoard</button>
  </div>`;
  reportEl.querySelector("#close-report")?.addEventListener("click", () => reportEl.classList.add("hidden"));
}

function buildTools(): void {
  toolsEl.innerHTML = "";
  const kinds: IncentiveKind[] = ["food", "shiny", "drum"];
  const labels: Record<IncentiveKind, string> = { food: "Food pile", shiny: "Shiny pile", drum: "War drum" };
  for (const k of kinds) {
    const b = document.createElement("button");
    b.textContent = `${labels[k]} (${INCENTIVE_COST[k]})`;
    b.dataset.kind = k;
    b.addEventListener("click", () => {
      tool = tool === k ? null : k;
      for (const el of toolsEl.querySelectorAll("button")) el.classList.toggle("active", el.dataset.kind === tool);
    });
    toolsEl.appendChild(b);
  }
}

function updateStats(): void {
  const working = world.goblins.filter((g) => g.action === "gather" || g.action === "deliver").length;
  statsEl.innerHTML =
    `<span>Hoard <b>${world.goblins.length}</b></span>` +
    `<span>Effort <b>${world.hoard.effort}</b> / ${world.hoard.nextHatchAt}</span>` +
    `<span>Working <b>${working}</b></span>` +
    `<span>Food <b>${world.hoard.food}</b></span>` +
    `<span>Shinies <b>${world.hoard.shinies}</b></span>` +
    `<span>Tick <b>${world.tick}</b></span>`;
  for (const el of toolsEl.querySelectorAll("button")) {
    const k = el.dataset.kind as IncentiveKind;
    el.disabled = world.hoard.effort < INCENTIVE_COST[k];
  }
}

let renderedLogLength = -1;
function updateLog(): void {
  if (world.log.length === renderedLogLength) return;
  renderedLogLength = world.log.length;
  const recent = world.log.slice(-40).reverse();
  logEl.innerHTML = recent.map((e) => `<li class="${e.kind}">${escapeHtml(e.text)}</li>`).join("");
}

canvas.addEventListener("pointermove", (ev) => {
  hover = renderer.tileAt(ev.clientX, ev.clientY, world);
});
canvas.addEventListener("pointerleave", () => {
  hover = null;
});
canvas.addEventListener("pointerdown", (ev) => {
  const tile = renderer.tileAt(ev.clientX, ev.clientY, world);
  if (!tile || !tool) return;
  world.enqueue({ type: "placeIncentive", kind: tool, x: tile.x, y: tile.y });
});
window.addEventListener("resize", () => renderer.resize(world));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save(world);
});
resetBtn.addEventListener("click", () => {
  if (!confirm("Abandon this hoard and start a new one?")) return;
  clear();
  world = World.create((Date.now() ^ 0x5bd1e995) >>> 0);
  renderer.resize(world);
  renderedLogLength = -1;
  accumulator = 0;
});

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

boot();

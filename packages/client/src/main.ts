import { INCENTIVE_COST, SULK_MOOD, TICK_MS, World, type IncentiveKind } from "@goblin/sim";
import { Renderer } from "./renderer";
import { clear, load, save } from "./storage";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const logEl = document.getElementById("log") as HTMLUListElement;
const toolsEl = document.getElementById("tool-buttons") as HTMLDivElement;
const speedEl = document.getElementById("speed") as HTMLDivElement;
const bankEl = document.getElementById("bank") as HTMLDivElement;
const bankBar = document.getElementById("bank-bar") as HTMLProgressElement;
const overlayEl = document.getElementById("overlay") as HTMLDivElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const verifyBtn = document.getElementById("verify") as HTMLButtonElement;
const verifyResult = document.getElementById("verify-result") as HTMLDivElement;

/** One segment banks this much game time before it must be submitted. */
const SEGMENT_TICKS = 12 * 60 * 60 * (1000 / TICK_MS);
const SAVE_INTERVAL_MS = 5000;
const MAX_FRAME_MS = 250;
/** Frames budget for stepping at high speed so rendering keeps up. */
const STEP_BUDGET_MS = 24;

const renderer = new Renderer(canvas);
let world: World;
let segmentStartTick = 0;
let speed = 1;
let tool: IncentiveKind | null = null;
let hover: { x: number; y: number } | null = null;
let accumulator = 0;
let lastFrame = 0;
let lastSave = 0;

function boot(): void {
  const file = load();
  if (file) {
    world = World.fromData(file.world);
    segmentStartTick = file.segmentStartTick;
  } else {
    world = World.create((Date.now() ^ 0x9e3779b9) >>> 0);
  }
  renderer.resize(world);
  buildTools();
  setSpeed(1);
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  // A hidden tab pauses requestAnimationFrame. Nothing happens while the
  // tab is away in this model, so clamp the gap instead of catching up.
  const dt = Math.min(now - lastFrame, MAX_FRAME_MS);
  lastFrame = now;

  if (speed > 0 && !segmentFull()) {
    accumulator += dt * speed;
    const deadline = performance.now() + STEP_BUDGET_MS;
    while (accumulator >= TICK_MS) {
      world.step();
      accumulator -= TICK_MS;
      if (segmentFull()) {
        accumulator = 0;
        showSegmentSummary();
        break;
      }
      if (performance.now() > deadline) {
        // Too slow for this speed on this device: drop the backlog rather
        // than freeze. The sim stays exact; only the on-screen rate drops.
        accumulator = Math.min(accumulator, TICK_MS);
        break;
      }
    }
  }

  renderer.draw(world, speed > 0 ? accumulator / TICK_MS : 0, hover);
  updateStats();
  updateLog();
  if (now - lastSave > SAVE_INTERVAL_MS) {
    save(world, segmentStartTick);
    lastSave = now;
  }
  requestAnimationFrame(frame);
}

function segmentFull(): boolean {
  return world.tick - segmentStartTick >= SEGMENT_TICKS;
}

function setSpeed(s: number): void {
  speed = s;
  for (const el of speedEl.querySelectorAll("button")) el.classList.toggle("active", Number(el.dataset.speed) === s);
}

function showSegmentSummary(): void {
  const segmentCommands = world.history.filter((h) => h.tick >= segmentStartTick).length;
  overlayEl.classList.remove("hidden");
  overlayEl.innerHTML = `<div class="card">
    <h2>Segment complete</h2>
    <p>You banked 12 hours of game time.</p>
    <ul>
      <li><b>${segmentCommands}</b> moves recorded</li>
      <li>Hoard is now <b>${world.goblins.length}</b> goblins</li>
      <li>State checksum <code>${hex(world.checksum())}</code> at tick ${world.tick}</li>
    </ul>
    <p class="hint">In the full game this is where the segment goes to the server, which replays your moves alongside everyone else's and reports what actually happened. For now, carry straight on.</p>
    <button id="next-segment">Start next segment</button>
  </div>`;
  overlayEl.querySelector("#next-segment")?.addEventListener("click", () => {
    segmentStartTick = world.tick;
    overlayEl.classList.add("hidden");
    save(world, segmentStartTick);
  });
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
  const sulking = world.goblins.filter((g) => g.mood < SULK_MOOD).length;
  statsEl.innerHTML =
    `<span>Hoard <b>${world.goblins.length}</b></span>` +
    `<span>Effort <b>${world.hoard.effort}</b> / ${world.hoard.nextHatchAt}</span>` +
    `<span>Working <b>${working}</b></span>` +
    `<span>Sulking <b>${sulking}</b></span>` +
    `<span>Food <b>${world.hoard.food}</b></span>` +
    `<span>Shinies <b>${world.hoard.shinies}</b></span>`;
  for (const el of toolsEl.querySelectorAll("button")) {
    const k = el.dataset.kind as IncentiveKind;
    el.disabled = world.hoard.effort < INCENTIVE_COST[k];
  }
  const banked = world.tick - segmentStartTick;
  bankEl.innerHTML = `Banked <b>${fmtGameTime(banked)}</b> of 12h game time. <b>${world.history.length}</b> moves recorded. Tick ${world.tick}.`;
  bankBar.value = banked / SEGMENT_TICKS;
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
speedEl.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button");
  if (b?.dataset.speed !== undefined) setSpeed(Number(b.dataset.speed));
});
window.addEventListener("resize", () => renderer.resize(world));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save(world, segmentStartTick);
});
resetBtn.addEventListener("click", () => {
  if (!confirm("Abandon this hoard and start a new one?")) return;
  clear();
  world = World.create((Date.now() ^ 0x5bd1e995) >>> 0);
  segmentStartTick = 0;
  renderer.resize(world);
  renderedLogLength = -1;
  accumulator = 0;
  verifyResult.textContent = "";
});
verifyBtn.addEventListener("click", () => {
  // Prove the session is replayable: rebuild from seed + history and
  // compare checksums. This is exactly what a server would do.
  const wasSpeed = speed;
  setSpeed(0);
  verifyResult.textContent = `Replaying ${world.tick} ticks from seed ${world.seed}...`;
  setTimeout(() => {
    const t0 = performance.now();
    const replayed = World.replay(world.seed, world.history, world.tick, world.startingGoblins);
    const ms = Math.round(performance.now() - t0);
    const ok = replayed.checksum() === world.checksum();
    verifyResult.innerHTML = ok
      ? `Replay matches. Checksum <code>${hex(world.checksum())}</code>, ${world.history.length} moves, ${ms} ms.`
      : `Replay DIVERGED: live <code>${hex(world.checksum())}</code> vs replay <code>${hex(replayed.checksum())}</code>.`;
    setSpeed(wasSpeed);
  }, 20);
});

function fmtGameTime(ticks: number): string {
  const s = Math.floor(ticks / (1000 / TICK_MS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function hex(n: number): string {
  return n.toString(16).padStart(8, "0");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

boot();

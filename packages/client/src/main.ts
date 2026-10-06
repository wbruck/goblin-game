import {
  FACE_NAMES,
  INCENTIVE_COST,
  NEED_MAX,
  OVERSEER_INCENTIVES,
  SULK_MOOD,
  TICK_MS,
  World,
  type ActionKind,
  type Goblin,
  type Motive,
  type OverseerIncentiveKind,
  type Tile,
} from "@goblin/sim";
import { Renderer, type View } from "./renderer";
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
const spinEl = document.getElementById("spin") as HTMLDivElement;
const faceLabel = document.getElementById("face-label") as HTMLSpanElement;
const rosterEl = document.getElementById("roster") as HTMLUListElement;
const rosterCount = document.getElementById("roster-count") as HTMLSpanElement;
const warrenBar = document.getElementById("warren-bar") as HTMLProgressElement;
const warrenText = document.getElementById("warren-text") as HTMLParagraphElement;

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
let tool: OverseerIncentiveKind | null = null;
/** Goblin picked in the roster; ringed on the board. */
let selectedId: number | null = null;
let hover: Tile | null = null;
/** Current and target view. The view eases toward the target each frame. */
const view: View = { yaw: 0.6, pitch: 0.45 };
const targetView: View = { yaw: 0.6, pitch: 0.45 };
const PITCH_LIMIT = 1.4;
let drag: { x: number; y: number; moved: boolean; yaw: number; pitch: number } | null = null;
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

  view.yaw += (targetView.yaw - view.yaw) * 0.2;
  view.pitch += (targetView.pitch - view.pitch) * 0.2;
  renderer.draw(world, speed > 0 ? accumulator / TICK_MS : 0, hover, view, selectedId);
  updateStats();
  updateLog();
  updateRoster(now);
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
  const labels: Record<OverseerIncentiveKind, string> = { shiny: "Shiny pile", drum: "War drum" };
  for (const k of OVERSEER_INCENTIVES) {
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
    `<span>Warren <b>${world.hoard.warren}</b> / ${world.hoard.warrenCapacity}</span>` +
    `<span>Shinies <b>${world.hoard.shinies}</b></span>`;
  for (const el of toolsEl.querySelectorAll("button")) {
    const k = el.dataset.kind as OverseerIncentiveKind;
    el.disabled = world.hoard.effort < INCENTIVE_COST[k];
  }
  updateWarren();
  faceLabel.textContent = hover ? `${FACE_NAMES[hover.f]} ${hover.u},${hover.v}` : "";
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

function updateWarren(): void {
  const { warren, warrenCapacity, nextHatchAt } = world.hoard;
  warrenBar.max = Math.max(1, warrenCapacity);
  warrenBar.value = warren;
  const text = `Warren ${warren} / ${warrenCapacity} food. Next hatch needs ${nextHatchAt} effort and a full warren.`;
  if (warrenText.textContent !== text) warrenText.textContent = text;
}

const MOTIVE_LABEL: Record<Motive, string> = {
  hungry: "hungry",
  tired: "tired",
  hauling: "hauling",
  foraging: "foraging",
  greedy: "greedy",
  brave: "brave",
  diligent: "diligent",
  sulking: "sulking",
  bored: "bored",
  none: "-",
};

const ACTION_LABEL: Record<ActionKind, string> = {
  idle: "Idling",
  wander: "Wandering",
  gather: "Gathering",
  deliver: "Delivering",
  eat: "Eating",
  rest: "Resting",
  loot: "Looting",
  rally: "Rallying",
  forage: "Foraging",
};

/** Persistent DOM for one roster entry; only text and widths change on refresh. */
interface RosterNode {
  el: HTMLLIElement;
  name: HTMLSpanElement;
  badge: HTMLSpanElement;
  action: HTMLDivElement;
  fullness: HTMLSpanElement;
  energy: HTMLSpanElement;
  mood: HTMLSpanElement;
  carry: HTMLDivElement;
}

const ROSTER_REFRESH_MS = 250;
const rosterNodes = new Map<number, RosterNode>();
let rosterKey = "";
let lastRosterRefresh = -Infinity;

function updateRoster(now: number, force = false): void {
  const goblins = [...world.goblins].sort((a, b) => a.id - b.id);
  const key = goblins.map((g) => g.id).join(",");
  const membershipChanged = key !== rosterKey;
  if (!force && !membershipChanged && now - lastRosterRefresh < ROSTER_REFRESH_MS) return;
  lastRosterRefresh = now;

  if (membershipChanged) {
    rosterKey = key;
    const alive = new Set(goblins.map((g) => g.id));
    for (const [id, node] of rosterNodes) {
      if (!alive.has(id)) {
        node.el.remove();
        rosterNodes.delete(id);
      }
    }
    if (selectedId !== null && !alive.has(selectedId)) selectedId = null;
    // Re-append in id order; appendChild moves existing nodes.
    for (const g of goblins) {
      let node = rosterNodes.get(g.id);
      if (!node) {
        node = makeRosterNode(g.id);
        rosterNodes.set(g.id, node);
      }
      rosterEl.appendChild(node.el);
    }
    rosterCount.textContent = `(${goblins.length})`;
  }

  for (const g of goblins) {
    const node = rosterNodes.get(g.id);
    if (node) fillRosterNode(node, g);
  }
}

function makeRosterNode(id: number): RosterNode {
  const el = document.createElement("li");
  el.className = "goblin-node";
  el.dataset.id = String(id);
  const head = document.createElement("div");
  head.className = "gn-head";
  const name = document.createElement("span");
  name.className = "gn-name";
  const badge = document.createElement("span");
  badge.className = "motive";
  head.append(name, badge);
  const action = document.createElement("div");
  action.className = "gn-action";
  const bars = document.createElement("div");
  bars.className = "gn-bars";
  const bar = (cls: string, title: string): HTMLSpanElement => {
    const track = document.createElement("span");
    track.className = `gn-bar ${cls}`;
    track.title = title;
    const fill = document.createElement("span");
    track.appendChild(fill);
    bars.appendChild(track);
    return fill;
  };
  const fullness = bar("full", "Fullness");
  const energy = bar("energy", "Energy");
  const mood = bar("mood", "Mood");
  const carry = document.createElement("div");
  carry.className = "gn-carry";
  el.append(head, action, bars, carry);
  return { el, name, badge, action, fullness, energy, mood, carry };
}

function pct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fillRosterNode(node: RosterNode, g: Goblin): void {
  setText(node.name, g.name);
  setText(node.badge, MOTIVE_LABEL[g.motive]);
  const motiveClass = `motive m-${g.motive}`;
  if (node.badge.className !== motiveClass) node.badge.className = motiveClass;
  const where = g.target ? ` → ${FACE_NAMES[g.target.f] ?? "?"} ${g.target.u},${g.target.v}` : "";
  setText(node.action, `${ACTION_LABEL[g.action]}${where}`);
  setWidth(node.fullness, pct(100 - (g.hunger / NEED_MAX) * 100));
  setWidth(node.energy, pct((g.energy / NEED_MAX) * 100));
  setWidth(node.mood, pct(((g.mood + NEED_MAX) / (2 * NEED_MAX)) * 100));
  setText(node.carry, `Carrying ${g.carrying} resource, ${g.carryingFood} food`);
  node.el.classList.toggle("selected", g.id === selectedId);
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setWidth(el: HTMLElement, p: number): void {
  const w = `${p}%`;
  if (el.style.width !== w) el.style.width = w;
}

/**
 * View that turns face f toward the viewer, checked against
 * Renderer.rotate(): the face normal's rotated z is positive (front, right,
 * back, left by yaw; top and bottom by pitch). Yaw is taken as the nearest
 * equivalent angle so the cube does not spin through extra turns.
 */
function faceView(f: number): { yaw: number; pitch: number } {
  const SIDE_PITCH = 0.35;
  const sideYaw = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  const yaw = sideYaw[f];
  if (yaw === undefined) return { yaw: targetView.yaw, pitch: f === 4 ? 1.2 : -1.2 };
  const turn = Math.PI * 2;
  const nearest = yaw + Math.round((targetView.yaw - yaw) / turn) * turn;
  return { yaw: nearest, pitch: SIDE_PITCH };
}

rosterEl.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(".goblin-node");
  if (!el) return;
  const id = Number(el.dataset.id);
  if (selectedId === id) {
    selectedId = null;
  } else {
    selectedId = id;
    const g = world.goblins.find((x) => x.id === id);
    if (g) {
      const v = faceView(g.tile.f);
      targetView.yaw = v.yaw;
      targetView.pitch = v.pitch;
    }
  }
  updateRoster(performance.now(), true);
});

canvas.addEventListener("pointerdown", (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  drag = { x: ev.clientX, y: ev.clientY, moved: false, yaw: targetView.yaw, pitch: targetView.pitch };
});
canvas.addEventListener("pointermove", (ev) => {
  if (drag) {
    const dx = ev.clientX - drag.x;
    const dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      targetView.yaw = drag.yaw + dx * 0.01;
      targetView.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, drag.pitch + dy * 0.01));
      view.yaw = targetView.yaw;
      view.pitch = targetView.pitch;
      hover = null;
      return;
    }
  }
  hover = renderer.pick(ev.clientX, ev.clientY, world, view);
});
canvas.addEventListener("pointerup", (ev) => {
  const wasDrag = drag?.moved ?? false;
  drag = null;
  if (wasDrag) return;
  const tile = renderer.pick(ev.clientX, ev.clientY, world, view);
  if (!tile || !tool) return;
  world.enqueue({ type: "placeIncentive", kind: tool, tile });
});
canvas.addEventListener("pointerleave", () => {
  hover = null;
});
spinEl.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest("button");
  if (!b) return;
  const quarter = Math.PI / 2;
  switch (b.dataset.spin) {
    case "left": targetView.yaw -= quarter; break;
    case "right": targetView.yaw += quarter; break;
    case "up": targetView.pitch = Math.min(PITCH_LIMIT, targetView.pitch + quarter); break;
    case "down": targetView.pitch = Math.max(-PITCH_LIMIT, targetView.pitch - quarter); break;
    case "home": targetView.yaw = 0.6; targetView.pitch = 0.45; break;
  }
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
  selectedId = null;
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

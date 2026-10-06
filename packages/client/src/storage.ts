import { SAVE_VERSION, World, type WorldData } from "@goblin/sim";

const KEY_PREFIX = "goblin-hoard-save-v";
/** The key changes with the save version, so saves from older builds are simply never read. */
const KEY = `${KEY_PREFIX}${SAVE_VERSION}`;

/**
 * A save is the world's seed and command history (the session, replayable
 * anywhere) plus a snapshot (so a page load does not replay the segment).
 * `segmentStartTick` marks where the current 12-hour bank began.
 */
export interface SaveFile {
  savedAt: number;
  segmentStartTick: number;
  world: WorldData;
}

export function save(world: World, segmentStartTick: number): void {
  const file: SaveFile = { savedAt: Date.now(), segmentStartTick, world: world.toData() };
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
  } catch (err) {
    console.warn("save failed", err);
  }
}

export function load(): SaveFile | null {
  dropStaleSaves();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const file = JSON.parse(raw) as SaveFile;
    if (!file.world || file.world.version !== SAVE_VERSION) return null;
    return file;
  } catch {
    return null;
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Remove saves written under older version keys; they can never load. */
function dropStaleSaves(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX) && k !== KEY) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

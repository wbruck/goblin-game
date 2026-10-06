import { SAVE_VERSION, World, type WorldData } from "@goblin/sim";

const KEY = "goblin-hoard-save-v2";

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

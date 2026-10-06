import { World, type WorldData } from "@goblin/sim";

const KEY = "goblin-hoard-save-v1";

export interface SaveFile {
  savedAt: number;
  world: WorldData;
}

export function save(world: World): void {
  const file: SaveFile = { savedAt: Date.now(), world: world.toData() };
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
    if (!file.world || file.world.version !== 1) return null;
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

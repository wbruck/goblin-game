import { TICK_MS, type World } from "./world";
import type { LogEvent } from "./types";

export const DEFAULT_OFFLINE_CAP_MS = 12 * 60 * 60 * 1000;

export interface CatchUpReport {
  elapsedMs: number;
  simulatedMs: number;
  discardedMs: number;
  ticks: number;
  effortGained: number;
  goblinsBorn: number;
  shiniesGained: number;
  events: LogEvent[];
}

/**
 * Offline progress by replaying the real simulation. The client runs it in
 * chunks so the page stays responsive, then shows the report. Time past the
 * cap is discarded, and the cap is shown to the player, following what the
 * research found players accept.
 */
export class CatchUp {
  readonly totalTicks: number;
  readonly report: CatchUpReport;
  private done = 0;
  private readonly startEffort: number;
  private readonly startBorn: number;
  private readonly startShinies: number;
  private readonly startLog: number;

  constructor(private readonly world: World, elapsedMs: number, capMs = DEFAULT_OFFLINE_CAP_MS) {
    const simulated = Math.max(0, Math.min(elapsedMs, capMs));
    this.totalTicks = Math.floor(simulated / TICK_MS);
    this.startEffort = world.hoard.lifetimeEffort;
    this.startBorn = world.hoard.born;
    this.startShinies = world.hoard.shinies;
    this.startLog = world.log.length;
    this.report = {
      elapsedMs,
      simulatedMs: this.totalTicks * TICK_MS,
      discardedMs: Math.max(0, elapsedMs - simulated),
      ticks: this.totalTicks,
      effortGained: 0,
      goblinsBorn: 0,
      shiniesGained: 0,
      events: [],
    };
  }

  get remaining(): number {
    return this.totalTicks - this.done;
  }

  get progress(): number {
    return this.totalTicks === 0 ? 1 : this.done / this.totalTicks;
  }

  /** Run up to `n` ticks. Returns true when finished. */
  run(n: number): boolean {
    const target = Math.min(this.totalTicks, this.done + n);
    for (; this.done < target; this.done++) this.world.step({ offline: true });
    if (this.done >= this.totalTicks) this.finish();
    return this.done >= this.totalTicks;
  }

  runAll(): CatchUpReport {
    this.run(this.remaining);
    return this.report;
  }

  private finish(): void {
    const h = this.world.hoard;
    this.report.effortGained = h.lifetimeEffort - this.startEffort;
    this.report.goblinsBorn = h.born - this.startBorn;
    this.report.shiniesGained = h.shinies - this.startShinies;
    this.report.events = this.world.log.slice(this.startLog).filter((e) => e.kind !== "info");
  }
}


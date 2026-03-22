/* ============================================================
   Clout Clicker — Game Engine
   Pure game logic, no React code.
   ============================================================ */

import type {
  GameState,
  SerializedState,
  Buff,
  BuyMode,
  GoldenEffect,
} from './types';
import { BUILDINGS, UPGRADES, ACHIEVEMENTS } from './data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cost of the n-th unit of a building (1-indexed). */
function buildingCost(baseCost: number, owned: number): number {
  return Math.ceil(baseCost * Math.pow(1.15, owned));
}

/** Total cost to buy `qty` units starting from `owned`. */
function bulkCost(baseCost: number, owned: number, qty: number): number {
  let total = 0;
  for (let i = 0; i < qty; i++) {
    total += buildingCost(baseCost, owned + i);
  }
  return total;
}

/** How many units can be bought with `budget` starting from `owned`. */
function maxAffordable(baseCost: number, owned: number, budget: number): number {
  let count = 0;
  let spent = 0;
  while (true) {
    const next = buildingCost(baseCost, owned + count);
    if (spent + next > budget) break;
    spent += next;
    count++;
  }
  return count;
}

/** Weighted random pick from an array of [weight, value] pairs. */
function weightedPick<T>(items: [number, T][]): T {
  const total = items.reduce((s, [w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [w, v] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][1];
}

// ---------------------------------------------------------------------------
// Default state factory
// ---------------------------------------------------------------------------

function createDefaultState(): GameState {
  const buildings: Record<string, number> = {};
  for (const b of BUILDINGS) buildings[b.id] = 0;

  return {
    clout: 0,
    totalCloutEver: 0,
    allTimeCloutEver: 0,

    cps: 0,
    clickPower: 1,

    buildings,
    upgrades: new Set(),

    achievements: new Set(),
    prestigeLevel: 0,
    viralChips: 0,

    clicks: 0,
    sessionClicks: 0,
    peakClickCps: 0,
    goldenCloutClicks: 0,
    goldenCloutThisRun: 0,
    frenzyCount: 0,
    clickFrenzyCount: 0,
    freeUpgradeCount: 0,

    startTime: Date.now(),
    saveTime: Date.now(),
    timePlayed: 0,
    timeSincePrestige: 0,
    longestOffline: 0,

    isLoggedIn: false,
    displayName: '',
    photoURL: '',
    userId: '',

    humbleTimer: 0,
    afkTimer: 0,
    lastClickTime: Date.now(),
    goldenFastClick: false,
    saveLoaded: false,
  };
}

// ---------------------------------------------------------------------------
// GameEngine
// ---------------------------------------------------------------------------

export class GameEngine {
  state: GameState;
  buffs: { frenzy: Buff | null; clickFrenzy: Buff | null } = {
    frenzy: null,
    clickFrenzy: null,
  };

  private tickInterval: number | null = null;
  private listeners: Set<() => void> = new Set();
  private lastTick: number = Date.now();

  constructor() {
    this.state = createDefaultState();
  }

  // -----------------------------------------------------------------------
  // Subscriptions
  // -----------------------------------------------------------------------

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* listener errors must not break the loop */ }
    }
  }

  // -----------------------------------------------------------------------
  // Game loop
  // -----------------------------------------------------------------------

  start(): void {
    if (this.tickInterval !== null) return;
    this.lastTick = Date.now();
    this.tickInterval = window.setInterval(() => this.tick(), 100);
  }

  stop(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000; // seconds
    this.lastTick = now;

    const s = this.state;

    // --- Expire buffs ---
    if (this.buffs.frenzy && now >= this.buffs.frenzy.endTime) {
      this.buffs.frenzy = null;
      this.recalculate();
    }
    if (this.buffs.clickFrenzy && now >= this.buffs.clickFrenzy.endTime) {
      this.buffs.clickFrenzy = null;
      this.recalculate();
    }

    // --- Award CPS income ---
    const cpsMult = this.getActiveCpsMultiplier();
    const earned = s.cps * dt * cpsMult;
    if (earned > 0) {
      s.clout += earned;
      s.totalCloutEver += earned;
    }

    // --- Track time ---
    s.timePlayed += dt;
    s.timeSincePrestige += dt;

    // --- Humble timer (0 buildings) ---
    const totalBuildings = Object.values(s.buildings).reduce((a, b) => a + b, 0);
    if (totalBuildings === 0) {
      s.humbleTimer += dt;
    }

    // --- AFK timer (no clicks) ---
    const sinceLast = (now - s.lastClickTime) / 1000;
    if (sinceLast > 60) {
      s.afkTimer += dt;
    }

    // --- Check achievements ---
    this.checkAchievements();

    // --- Notify subscribers ---
    this.notify();
  }

  // -----------------------------------------------------------------------
  // Multiplier helpers
  // -----------------------------------------------------------------------

  /** Active CPS multiplier from frenzy buff. */
  getActiveCpsMultiplier(): number {
    return this.buffs.frenzy ? this.buffs.frenzy.mult : 1;
  }

  /** Active click multiplier from click frenzy buff. */
  getActiveClickMultiplier(): number {
    return this.buffs.clickFrenzy ? this.buffs.clickFrenzy.mult : 1;
  }

  // -----------------------------------------------------------------------
  // Recalculate CPS and click power
  // -----------------------------------------------------------------------

  recalculate(): void {
    const s = this.state;

    // --- Global multiplier ---
    // Prestige bonus: 1 + viralChips * 0.01
    let globalMult = 1 + s.viralChips * 0.01;

    // Prestige CPS upgrade: extra +5% per chip
    for (const uid of s.upgrades) {
      const u = UPGRADES.find((u) => u.id === uid);
      if (!u) continue;
      if (u.type === 'prestige_cps') {
        globalMult += s.viralChips * 0.05;
      }
      if (u.type === 'global_mult' && u.multiplier) {
        globalMult *= u.multiplier;
      }
    }

    // --- Per-building CPS ---
    let totalCps = 0;

    for (const building of BUILDINGS) {
      const owned = s.buildings[building.id] || 0;
      if (owned === 0) continue;

      // Building multiplier from upgrades
      let buildingMult = 1;
      for (const uid of s.upgrades) {
        const u = UPGRADES.find((u) => u.id === uid);
        if (!u) continue;
        if (u.type === 'building_mult' && u.buildingId === building.id && u.multiplier) {
          buildingMult *= u.multiplier;
        }
      }

      // Synergy: for each synergy upgrade owned, building B gets +1% per unit of building A
      for (const uid of s.upgrades) {
        const u = UPGRADES.find((u) => u.id === uid);
        if (!u) continue;
        if (u.type === 'synergy' && u.buildingB === building.id && u.buildingA) {
          const countA = s.buildings[u.buildingA] || 0;
          const bonus = (u.synergyBonus ?? 0.01) * countA;
          buildingMult *= 1 + bonus;
        }
      }

      totalCps += owned * building.baseCps * buildingMult;
    }

    s.cps = totalCps * globalMult;

    // --- Click power ---
    let clickMult = 1;
    for (const uid of s.upgrades) {
      const u = UPGRADES.find((u) => u.id === uid);
      if (!u) continue;
      if (u.type === 'click_mult' && u.multiplier) {
        clickMult *= u.multiplier;
      }
    }
    s.clickPower = 1 * clickMult * globalMult;

    // Track peak CPS
    if (s.cps > s.peakClickCps) {
      s.peakClickCps = s.cps;
    }
  }

  // -----------------------------------------------------------------------
  // Core actions
  // -----------------------------------------------------------------------

  /** Process a click. Returns the amount of clout earned. */
  click(): number {
    const s = this.state;
    const clickMult = this.getActiveClickMultiplier();
    const earned = (s.clickPower + s.cps * 0.01) * clickMult;

    s.clout += earned;
    s.totalCloutEver += earned;
    s.clicks++;
    s.sessionClicks++;
    s.lastClickTime = Date.now();
    s.afkTimer = 0;

    return earned;
  }

  /** Buy a building. Returns true if purchase succeeded. */
  buyBuilding(id: string, qty: BuyMode): boolean {
    const building = BUILDINGS.find((b) => b.id === id);
    if (!building) return false;

    const s = this.state;
    const owned = s.buildings[id] || 0;

    let amount: number;
    if (qty === 'max') {
      amount = maxAffordable(building.baseCost, owned, s.clout);
    } else {
      amount = qty;
    }

    if (amount <= 0) return false;

    const cost = bulkCost(building.baseCost, owned, amount);
    if (s.clout < cost) return false;

    s.clout -= cost;
    s.buildings[id] = owned + amount;

    this.recalculate();
    this.notify();
    return true;
  }

  /** Buy an upgrade. Returns true if purchase succeeded. */
  buyUpgrade(id: string): boolean {
    const upgrade = UPGRADES.find((u) => u.id === id);
    if (!upgrade) return false;

    const s = this.state;
    if (s.upgrades.has(id)) return false;
    if (s.clout < upgrade.cost) return false;
    if (!upgrade.condition(s)) return false;

    s.clout -= upgrade.cost;
    s.upgrades.add(id);

    this.recalculate();
    this.notify();
    return true;
  }

  // -----------------------------------------------------------------------
  // Prestige
  // -----------------------------------------------------------------------

  canPrestige(): boolean {
    return this.state.totalCloutEver >= 1e12;
  }

  calcViralChips(): number {
    return Math.floor(Math.sqrt(this.state.totalCloutEver / 1e12));
  }

  prestige(): void {
    if (!this.canPrestige()) return;

    const s = this.state;
    const chips = this.calcViralChips();

    // Accumulate all-time stats
    s.allTimeCloutEver += s.totalCloutEver;
    s.viralChips += chips;
    s.prestigeLevel++;

    // Determine which upgrades to keep (prestige upgrades only)
    const keptUpgrades = new Set<string>();
    for (const uid of s.upgrades) {
      const u = UPGRADES.find((u) => u.id === uid);
      if (u?.isPrestigeUpgrade) {
        keptUpgrades.add(uid);
      }
    }

    // Reset run-specific state
    s.clout = 0;
    s.totalCloutEver = 0;
    s.cps = 0;
    s.clickPower = 1;

    for (const b of BUILDINGS) s.buildings[b.id] = 0;
    s.upgrades = keptUpgrades;

    s.clicks = 0;
    s.sessionClicks = 0;
    s.goldenCloutThisRun = 0;
    s.timeSincePrestige = 0;
    s.humbleTimer = 0;
    s.afkTimer = 0;
    s.lastClickTime = Date.now();

    // Keep: achievements, prestigeLevel, viralChips, allTimeCloutEver,
    //       peakClickCps, goldenCloutClicks, frenzyCount, clickFrenzyCount,
    //       freeUpgradeCount, startTime, timePlayed, longestOffline

    // Clear buffs
    this.buffs.frenzy = null;
    this.buffs.clickFrenzy = null;

    this.recalculate();
    this.notify();
  }

  // -----------------------------------------------------------------------
  // Golden clout
  // -----------------------------------------------------------------------

  /** Spawn a golden clout event. Called externally on a timer. */
  spawnGolden(): void {
    // This is a signal method; the UI layer handles the visual spawn.
    // The engine just notifies so the UI can show it.
    this.notify();
  }

  /** Get the spawn interval range in ms, modified by golden_rate upgrades. */
  getGoldenSpawnRange(): { min: number; max: number } {
    let rateMultiplier = 1;
    for (const uid of this.state.upgrades) {
      const u = UPGRADES.find((u) => u.id === uid);
      if (u?.type === 'golden_rate' && u.multiplier) {
        rateMultiplier *= u.multiplier;
      }
    }
    // Base: 5-15 minutes. Rate upgrades reduce the interval.
    const min = (5 * 60 * 1000) / rateMultiplier;
    const max = (15 * 60 * 1000) / rateMultiplier;
    return { min, max };
  }

  /** Process clicking a golden clout. Returns the effect type. */
  clickGolden(): GoldenEffect {
    const s = this.state;
    s.goldenCloutClicks++;
    s.goldenCloutThisRun++;

    const effect = weightedPick<GoldenEffect>([
      [40, 'frenzy'],
      [30, 'lucky'],
      [20, 'clickFrenzy'],
      [10, 'freeUpgrade'],
    ]);

    // Duration modifier from golden_duration upgrades (each +10%)
    let durationMult = 1;
    for (const uid of s.upgrades) {
      const u = UPGRADES.find((u) => u.id === uid);
      if (u?.type === 'golden_duration' && u.multiplier) {
        durationMult += (u.multiplier - 1); // e.g. multiplier 1.1 adds +0.1
      }
    }

    const now = Date.now();

    switch (effect) {
      case 'frenzy': {
        const duration = 77 * 1000 * durationMult;
        this.buffs.frenzy = { mult: 7, endTime: now + duration };
        s.frenzyCount++;
        this.recalculate();
        break;
      }

      case 'lucky': {
        // Lucky amount: min(cps * 900, totalCloutEver * 0.15)
        let luckyAmount = Math.min(s.cps * 900, s.totalCloutEver * 0.15);

        // Lucky bonus upgrade modifier
        for (const uid of s.upgrades) {
          const u = UPGRADES.find((u) => u.id === uid);
          if (u?.type === 'lucky_bonus' && u.multiplier) {
            luckyAmount *= u.multiplier;
          }
        }

        // Minimum of 1 clout from lucky
        luckyAmount = Math.max(luckyAmount, 1);
        s.clout += luckyAmount;
        s.totalCloutEver += luckyAmount;
        break;
      }

      case 'clickFrenzy': {
        const duration = 13 * 1000 * durationMult;
        this.buffs.clickFrenzy = { mult: 777, endTime: now + duration };
        s.clickFrenzyCount++;
        this.recalculate();
        break;
      }

      case 'freeUpgrade': {
        // The UI layer should handle presenting the free upgrade choice.
        // Engine just tracks the stat.
        s.freeUpgradeCount++;
        break;
      }
    }

    this.notify();
    return effect;
  }

  // -----------------------------------------------------------------------
  // Achievements
  // -----------------------------------------------------------------------

  /** Check all achievements. Returns IDs of newly unlocked ones. */
  checkAchievements(): string[] {
    const s = this.state;
    const newlyUnlocked: string[] = [];

    for (const ach of ACHIEVEMENTS) {
      if (s.achievements.has(ach.id)) continue;
      try {
        if (ach.condition(s)) {
          s.achievements.add(ach.id);
          newlyUnlocked.push(ach.id);
        }
      } catch {
        // Achievement condition threw — skip it
      }
    }

    return newlyUnlocked;
  }

  // -----------------------------------------------------------------------
  // Offline income
  // -----------------------------------------------------------------------

  /** Apply offline income based on elapsed time since last save. Returns info or null. */
  applyOfflineIncome(): { earned: number; elapsed: number } | null {
    const s = this.state;
    if (!s.saveTime) return null;

    const now = Date.now();
    const elapsed = (now - s.saveTime) / 1000; // seconds

    if (elapsed < 10) return null; // less than 10 seconds, skip

    // Determine offline cap in hours
    let capHours = 1;
    for (const uid of s.upgrades) {
      const u = UPGRADES.find((u) => u.id === uid);
      if (u?.type === 'offline_cap' && u.multiplier) {
        capHours = u.multiplier; // e.g. prestige_6 sets cap to 4
      }
    }

    const cappedSeconds = Math.min(elapsed, capHours * 3600);
    const earned = s.cps * cappedSeconds;

    if (earned <= 0) return null;

    s.clout += earned;
    s.totalCloutEver += earned;

    // Track longest offline
    if (elapsed > s.longestOffline) {
      s.longestOffline = elapsed;
    }

    return { earned, elapsed: cappedSeconds };
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  serialize(): SerializedState {
    const s = this.state;
    return {
      clout: s.clout,
      totalCloutEver: s.totalCloutEver,
      allTimeCloutEver: s.allTimeCloutEver,
      buildings: { ...s.buildings },
      upgrades: Array.from(s.upgrades),
      achievements: Array.from(s.achievements),
      prestigeLevel: s.prestigeLevel,
      viralChips: s.viralChips,
      clicks: s.clicks,
      peakClickCps: s.peakClickCps,
      goldenCloutClicks: s.goldenCloutClicks,
      goldenCloutThisRun: s.goldenCloutThisRun,
      frenzyCount: s.frenzyCount,
      clickFrenzyCount: s.clickFrenzyCount,
      freeUpgradeCount: s.freeUpgradeCount,
      startTime: s.startTime,
      saveTime: Date.now(),
      timePlayed: s.timePlayed,
      timeSincePrestige: s.timeSincePrestige,
      longestOffline: s.longestOffline,
      displayName: s.displayName,
      photoURL: s.photoURL,
      sessionClicks: s.sessionClicks,
      humbleTimer: s.humbleTimer,
      afkTimer: s.afkTimer,
      goldenFastClick: s.goldenFastClick,
      saveLoaded: true,
    };
  }

  deserialize(data: SerializedState): void {
    const s = this.state;

    s.clout = data.clout ?? 0;
    s.totalCloutEver = data.totalCloutEver ?? 0;
    s.allTimeCloutEver = data.allTimeCloutEver ?? 0;

    // Buildings — merge with defaults so new buildings get 0
    const buildings: Record<string, number> = {};
    for (const b of BUILDINGS) buildings[b.id] = 0;
    if (data.buildings) {
      for (const [k, v] of Object.entries(data.buildings)) {
        buildings[k] = v;
      }
    }
    s.buildings = buildings;

    s.upgrades = new Set(data.upgrades ?? []);
    s.achievements = new Set(data.achievements ?? []);
    s.prestigeLevel = data.prestigeLevel ?? 0;
    s.viralChips = data.viralChips ?? 0;

    s.clicks = data.clicks ?? 0;
    s.sessionClicks = data.sessionClicks ?? 0;
    s.peakClickCps = data.peakClickCps ?? 0;
    s.goldenCloutClicks = data.goldenCloutClicks ?? 0;
    s.goldenCloutThisRun = data.goldenCloutThisRun ?? 0;
    s.frenzyCount = data.frenzyCount ?? 0;
    s.clickFrenzyCount = data.clickFrenzyCount ?? 0;
    s.freeUpgradeCount = data.freeUpgradeCount ?? 0;

    s.startTime = data.startTime ?? Date.now();
    s.saveTime = data.saveTime ?? Date.now();
    s.timePlayed = data.timePlayed ?? 0;
    s.timeSincePrestige = data.timeSincePrestige ?? 0;
    s.longestOffline = data.longestOffline ?? 0;

    s.displayName = data.displayName ?? '';
    s.photoURL = data.photoURL ?? '';

    s.humbleTimer = data.humbleTimer ?? 0;
    s.afkTimer = data.afkTimer ?? 0;
    s.goldenFastClick = data.goldenFastClick ?? false;
    s.saveLoaded = true;
    s.lastClickTime = Date.now();

    // Clear buffs on load
    this.buffs.frenzy = null;
    this.buffs.clickFrenzy = null;

    this.recalculate();
    this.notify();
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset(): void {
    this.state = createDefaultState();
    this.buffs.frenzy = null;
    this.buffs.clickFrenzy = null;
    this.recalculate();
    this.notify();
  }
}

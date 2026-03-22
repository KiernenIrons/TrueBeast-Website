/* ============================================================
   Clout Clicker — Type Definitions
   ============================================================ */

export interface Building {
  id: string;
  name: string;
  emoji: string;
  baseCps: number;
  baseCost: number;
  desc: string;
}

export interface Upgrade {
  id: string;
  name: string;
  desc: string;
  cost: number;
  emoji: string;
  type: 'building_mult' | 'click_mult' | 'golden_duration' | 'global_mult' | 'prestige_cps' | 'golden_rate' | 'lucky_bonus' | 'offline_cap' | 'synergy';
  multiplier?: number;
  buildingId?: string;
  buildingA?: string;
  buildingB?: string;
  synergyBonus?: number;
  isPrestigeUpgrade?: boolean;
  condition: (s: GameState) => boolean;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  category: string;
  shadow?: boolean;
  building?: string;
  condition: (s: GameState) => boolean;
}

export interface Buff {
  mult: number;
  endTime: number;
}

export interface GameState {
  // Currency
  clout: number;
  totalCloutEver: number;
  allTimeCloutEver: number;

  // Production (calculated)
  cps: number;
  clickPower: number;

  // Buildings & Upgrades
  buildings: Record<string, number>;
  upgrades: Set<string>;

  // Achievements & Prestige
  achievements: Set<string>;
  prestigeLevel: number;
  viralChips: number;

  // Stats
  clicks: number;
  sessionClicks: number;
  peakClickCps: number;
  goldenCloutClicks: number;
  goldenCloutThisRun: number;
  frenzyCount: number;
  clickFrenzyCount: number;
  freeUpgradeCount: number;

  // Time
  startTime: number;
  saveTime: number;
  timePlayed: number;
  timeSincePrestige: number;
  longestOffline: number;

  // Profile
  isLoggedIn: boolean;
  displayName: string;
  photoURL: string;
  userId: string;

  // Transient (not saved)
  humbleTimer: number;
  afkTimer: number;
  lastClickTime: number;
  goldenFastClick: boolean;
  saveLoaded: boolean;
}

export interface SerializedState {
  clout: number;
  totalCloutEver: number;
  allTimeCloutEver: number;
  buildings: Record<string, number>;
  upgrades: string[];
  achievements: string[];
  prestigeLevel: number;
  viralChips: number;
  clicks: number;
  peakClickCps: number;
  goldenCloutClicks: number;
  goldenCloutThisRun: number;
  frenzyCount: number;
  clickFrenzyCount: number;
  freeUpgradeCount: number;
  startTime: number;
  saveTime: number;
  timePlayed: number;
  timeSincePrestige: number;
  longestOffline: number;
  displayName: string;
  photoURL: string;
  sessionClicks?: number;
  humbleTimer?: number;
  afkTimer?: number;
  goldenFastClick?: boolean;
  saveLoaded?: boolean;
}

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  photoURL: string;
  peakClickCps: number;
  totalCloutEver: number;
  allTimeCloutEver: number;
  prestigeLevel: number;
  cps: number;
  clicks: number;
}

export type GoldenEffect = 'frenzy' | 'lucky' | 'clickFrenzy' | 'freeUpgrade';
export type BuyMode = 1 | 10 | 100 | 'max';

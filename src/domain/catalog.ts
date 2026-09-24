import { Cost, DecorationType, FacilityType, KikiReward } from './types';

const c = (wood: number, metal: number, paper: number, food: number): Cost[] =>
  (
    [
      ['wood', wood],
      ['metal_scraps', metal],
      ['paper', paper],
      ['food', food]
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([resourceTypeId, amount]) => ({ resourceTypeId, amount }));

const times = (cost: Cost[], k: number): Cost[] => cost.map((x) => ({ ...x, amount: x.amount * k }));

export const START_ROOM = 'FAF_CAB';
export const START_STORAGE = 100;

// ---- base level ----
export const MAX_BASE_LEVEL = 5;
export const STORAGE_PER_LEVEL = 50;
/** Cost to go from `level` to `level + 1`. */
export const upgradeCost = (level: number): Cost[] => c(10 * level, 5 * level, 2 * level, 0);

// ---- barricades ----
export const MAX_BARRICADE_LEVEL = 3;
export const BARRICADE_DURABILITY_PER_LEVEL = 50;
export const barricadeBuildCost = (): Cost[] => c(5, 2, 0, 0);
export const barricadeReinforceCost = (level: number): Cost[] => c(3 * level, 2 * level, 0, 0);
/** A level-N base can hold N+1 barricades. */
export const maxBarricades = (baseLevel: number) => baseLevel + 1;

// ---- facilities ----
export const MAX_FACILITY_LEVEL = 3;
export const FACILITIES: Record<FacilityType, { cost: Cost[]; minBaseLevel: number; description: string }> = {
  WORKBENCH: { cost: c(8, 4, 0, 0), minBaseLevel: 1, description: 'Enables crafting at home' },
  KITCHEN: { cost: c(4, 3, 0, 5), minBaseLevel: 1, description: 'Cook cafeteria leftovers' },
  STUDY_DESK: { cost: c(5, 0, 8, 0), minBaseLevel: 1, description: 'Prepare for exams' },
  INFIRMARY: { cost: c(0, 2, 6, 6), minBaseLevel: 2, description: 'Recover from zombie scratches' },
  GENERATOR: { cost: c(4, 12, 0, 0), minBaseLevel: 3, description: 'Keeps the lights on at night' }
};
/** Upgrading a facility from `level` costs its build cost x (level + 1). */
export const facilityUpgradeCost = (type: FacilityType, level: number) => times(FACILITIES[type].cost, level + 1);

// ---- storage ----
export const STORAGE_EXPANSION = 25;
export const storageExpansionCost = (): Cost[] => c(6, 3, 0, 0);
/** Storage cannot grow past 100 + 100 per base level. */
export const maxStorage = (baseLevel: number) => START_STORAGE + 100 * baseLevel;

// ---- decorations ----
export const DECORATIONS: Record<DecorationType, Cost[]> = {
  POSTER: c(0, 0, 2, 0),
  PLANT: c(0, 0, 1, 1),
  RUG: c(1, 0, 3, 0),
  LAMP: c(1, 2, 0, 0),
  FAF_BANNER: c(0, 0, 4, 0)
};
export const maxDecorations = (baseLevel: number) => 3 + 2 * baseLevel;

// ---- Kiki ----
export const KIKI_FEED_COST: Cost[] = c(0, 0, 0, 2);
export const KIKI_MOOD_PET = 5;
export const KIKI_MOOD_FEED = 20;
export const KIKI_START_MOOD = 50;

/**
 * Reward weights. Feeding Kiki and a good mood make "NOTHING" less likely,
 * so the rare boosters become proportionally more likely.
 */
export function kikiRewardTable(mood: number, fed: boolean): { reward: KikiReward; weight: number }[] {
  const nothing = Math.max(5, 40 - (fed ? 20 : 0) - Math.floor(mood / 5));
  return [
    { reward: 'NOTHING', weight: nothing },
    { reward: 'ENERGY_DRINK', weight: 25 },
    { reward: 'STUDY_NOTES', weight: 20 },
    { reward: 'LUCKY_PAW', weight: 10 },
    { reward: 'GOLDEN_EXAM_TICKET', weight: 5 }
  ];
}

/** Picks from a weighted table using r in [0, 1). */
export function pickWeighted<T>(table: { reward: T; weight: number }[], r: number): T {
  const total = table.reduce((s, x) => s + x.weight, 0);
  let point = r * total;
  for (const row of table) {
    if (point < row.weight) return row.reward;
    point -= row.weight;
  }
  return table[table.length - 1].reward;
}

export function catalog() {
  return {
    startRoom: START_ROOM,
    startStorage: START_STORAGE,
    upgrades: Array.from({ length: MAX_BASE_LEVEL - 1 }, (_, i) => ({
      fromLevel: i + 1,
      toLevel: i + 2,
      cost: upgradeCost(i + 1),
      storageBonus: STORAGE_PER_LEVEL
    })),
    barricades: {
      buildCost: barricadeBuildCost(),
      reinforceCost: Array.from({ length: MAX_BARRICADE_LEVEL - 1 }, (_, i) => ({ fromLevel: i + 1, cost: barricadeReinforceCost(i + 1) })),
      maxLevel: MAX_BARRICADE_LEVEL,
      durabilityPerLevel: BARRICADE_DURABILITY_PER_LEVEL,
      limit: 'baseLevel + 1'
    },
    facilities: Object.entries(FACILITIES).map(([type, f]) => ({ type, ...f, maxLevel: MAX_FACILITY_LEVEL })),
    storage: { expansion: STORAGE_EXPANSION, cost: storageExpansionCost(), limit: '100 + 100 * baseLevel' },
    decorations: Object.entries(DECORATIONS).map(([type, cost]) => ({ type, cost })),
    decorationLimit: '3 + 2 * baseLevel',
    kiki: { feedCost: KIKI_FEED_COST, rewards: kikiRewardTable(KIKI_START_MOOD, false) }
  };
}


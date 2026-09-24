export const FACILITY_TYPES = ['WORKBENCH', 'KITCHEN', 'INFIRMARY', 'STUDY_DESK', 'GENERATOR'] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const DECORATION_TYPES = ['POSTER', 'PLANT', 'RUG', 'LAMP', 'FAF_BANNER'] as const;
export type DecorationType = (typeof DECORATION_TYPES)[number];

export const KIKI_REWARDS = ['NOTHING', 'ENERGY_DRINK', 'STUDY_NOTES', 'LUCKY_PAW', 'GOLDEN_EXAM_TICKET'] as const;
export type KikiReward = (typeof KIKI_REWARDS)[number];
export type BoosterType = Exclude<KikiReward, 'NOTHING'>;

export interface Barricade {
  id: string;
  roomId: string; // World Service room this barricade blocks
  level: number;
  durability: number;
  builtAt: string;
}

export interface Facility {
  type: FacilityType;
  level: number;
  builtAt: string;
}

export interface Decoration {
  id: string;
  type: DecorationType;
  placedAt: string;
}

export interface Booster {
  id: string;
  type: BoosterType;
  obtainedAt: string;
}

export interface KikiState {
  mood: number; // 0..100, higher = better rewards
  interactions: number;
  lastInteractionAt: string | null;
}

export interface Base {
  id: string;
  playerId: string;
  name: string;
  roomId: string; // starts as FAF_CAB
  level: number;
  storageCapacity: number;
  barricades: Barricade[];
  facilities: Facility[];
  decorations: Decoration[];
  boosters: Booster[];
  kiki: KikiState;
  createdAt: string;
  updatedAt: string;
}

export interface Cost {
  resourceTypeId: string;
  amount: number;
}

/** Stored result of a paid/random base action; returned again on a retried actionId. */
export interface BaseActionRecord {
  actionId: string;
  baseId: string;
  kind: string;
  fingerprint: string;
  result: Record<string, unknown>;
  createdAt: string;
}

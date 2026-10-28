import rulesJson from './rules.json' with { type: 'json' };
import type { RulesDataset } from './types.js';

export * from './types.js';
export * from './constants.js';
export * from './lookup.js';
export * from './decide.js';

/** Canonical rules dataset per India Solid Waste Management Rules 2026. */
export const rulesTable: RulesDataset = rulesJson as unknown as RulesDataset;

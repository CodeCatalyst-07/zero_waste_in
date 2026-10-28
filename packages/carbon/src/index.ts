import factorsJson from './factors.json' with { type: 'json' };
import type { CarbonFactorsRegistry } from './types.js';

export * from './types.js';
export * from './calculator.js';

/** Canonical versioned emission factors registry with source and vintage metadata. */
export const carbonFactors: CarbonFactorsRegistry = factorsJson as CarbonFactorsRegistry;

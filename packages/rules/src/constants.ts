import rulesJson from './rules.json' with { type: 'json' };

/** Confidence threshold below which the engine asks clarification questions (placeholder to be tuned on labelled evaluation set). */
export const CONFIDENCE_ASK = 0.5;

/** Confidence threshold at or above which an answer is considered high confidence (placeholder to be tuned on labelled evaluation set). */
export const CONFIDENCE_HIGH = 0.8;

/** Common item identifier slugs for quick-selection UI chips. */
export const COMMON_ITEM_IDS: readonly string[] = [
  'vegetable_peels',
  'cooked_food',
  'newspaper_paper',
  'plastic_bottle',
  'milk_pouch',
  'glass_bottle',
  'diaper',
  'sanitary_pad',
  'tube_light',
  'aa_battery',
  'expired_medicine',
  'paint_can',
] as const;

/** All canonical item identifier slugs defined in the SWM Rules 2026 table. */
export const ITEM_IDS: readonly string[] = (
  rulesJson.rules as readonly { readonly id: string }[]
).map((r) => r.id);

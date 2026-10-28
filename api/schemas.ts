import { z } from 'zod';
import type { Attributes } from '@zerowastein/rules';

/** Regex matching ASCII and Unicode control characters for string sanitization. */
// eslint-disable-next-line no-control-regex
const controlCharRegex = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Strips non-printable ASCII and Unicode control characters from model-generated strings.
 *
 * @param str Input raw string.
 * @returns Cleaned string free of control characters.
 */
export function stripControlCharacters(str: string): string {
  return str.replace(controlCharRegex, '').trim();
}

/** Strict Zod validation schema for model-generated Attributes payloads. */
export const attributesSchema = z
  .object({
    item: z
      .string()
      .transform(stripControlCharacters)
      .pipe(
        z.string().min(1, 'Item identifier cannot be empty').max(100, 'Item identifier too long')
      ),
    isSharp: z.boolean(),
    isBattery: z.boolean(),
    isBulb: z.boolean(),
    isMedicine: z.boolean(),
    isChemical: z.boolean(),
    isElectronic: z.boolean(),
    isHygiene: z.boolean(),
    isFood: z.boolean(),
    isGarden: z.boolean(),
    evidence: z
      .array(
        z
          .string()
          .transform(stripControlCharacters)
          .pipe(z.string().max(80, 'Evidence item must not exceed 80 characters'))
      )
      .max(5, 'Maximum of 5 evidence items permitted'),
    confidence: z
      .number()
      .min(0.0, 'Confidence cannot be negative')
      .max(1.0, 'Confidence cannot exceed 1.0'),
  })
  .strict();

/**
 * Validates and converts unknown raw model responses into sanitized, strictly-typed Attributes.
 *
 * @param raw Unknown JSON object or parsed value.
 * @returns Validated, strictly typed Attributes object.
 */
export function parseAttributesPayload(raw: unknown): Attributes {
  return attributesSchema.parse(raw);
}

/** Standard JSON Schema definition of the Attributes contract for Gemini structured output. */
export const attributesJsonSchema = {
  type: 'object',
  properties: {
    item: { type: 'string', description: 'Canonical item slug from ITEM_IDS or concise label' },
    isSharp: { type: 'boolean', description: 'True if sharp edges, blades, or broken glass' },
    isBattery: { type: 'boolean', description: 'True if contains battery or cells' },
    isBulb: { type: 'boolean', description: 'True if light bulb, CFL, or tube light' },
    isMedicine: { type: 'boolean', description: 'True if expired medicine or drug packaging' },
    isChemical: { type: 'boolean', description: 'True if toxic chemicals, paint, or pesticide' },
    isElectronic: { type: 'boolean', description: 'True if electrical or electronic device' },
    isHygiene: { type: 'boolean', description: 'True if personal sanitary or hygiene waste' },
    isFood: { type: 'boolean', description: 'True if food scraps or kitchen waste' },
    isGarden: { type: 'boolean', description: 'True if organic garden biomass or leaves' },
    evidence: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 5,
      description: 'Up to 5 concise visual evidence tokens',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Model confidence score 0.0 to 1.0',
    },
  },
  required: [
    'item',
    'isSharp',
    'isBattery',
    'isBulb',
    'isMedicine',
    'isChemical',
    'isElectronic',
    'isHygiene',
    'isFood',
    'isGarden',
    'evidence',
    'confidence',
  ],
  additionalProperties: false,
} as const;

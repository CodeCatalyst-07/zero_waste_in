import rulesJson from './rules.json' with { type: 'json' };
import { CONFIDENCE_ASK, CONFIDENCE_HIGH } from './constants.js';
import { findMatchingRow } from './lookup.js';
import type {
  Attributes,
  ConfidenceBand,
  DecideOptions,
  FollowUpOption,
  RuleRow,
  RulesDataset,
  Stream,
  Verdict,
} from './types.js';

/** Canonical table instance loaded for default evaluation. */
const defaultRules: readonly RuleRow[] = (rulesJson as unknown as RulesDataset).rules;

/**
 * Asserts unreachable code branch at compile time for exhaustive union checking.
 *
 * @param value Must be inferred as never if all union variants are handled.
 * @returns Never returns, throws an error if reached at runtime.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected unhandled value: ${JSON.stringify(value)}`);
}

/**
 * Derives a targeted clarification question prioritizing detected hazard attributes.
 *
 * @param attributes Visual and contextual attributes extracted by vision provider.
 * @returns Clarification question with structured follow-up choices.
 */
function buildHazardClarification(attributes: Attributes): {
  readonly question: string;
  readonly options: readonly FollowUpOption[];
} {
  if (attributes.isBattery) {
    return {
      question: 'Does this item contain a battery or cell?',
      options: [
        { label: 'Yes, contains a battery', stream: 'special_care' },
        { label: 'No battery', stream: null },
      ],
    };
  }
  if (attributes.isMedicine) {
    return {
      question: 'Is this an expired medicine or pharmaceutical item?',
      options: [
        { label: 'Yes, medicine', stream: 'special_care' },
        { label: 'No, not medicine', stream: null },
      ],
    };
  }
  if (attributes.isSharp) {
    return {
      question: 'Does this item contain sharp edges, blades, or broken glass?',
      options: [
        { label: 'Yes, sharp or broken glass', stream: 'special_care' },
        { label: 'No sharp parts', stream: null },
      ],
    };
  }
  if (attributes.isChemical) {
    return {
      question: 'Does this item contain paint, pesticides, or toxic chemicals?',
      options: [
        { label: 'Yes, contains chemicals', stream: 'special_care' },
        { label: 'No chemicals', stream: null },
      ],
    };
  }
  if (attributes.isBulb) {
    return {
      question: 'Is this a fluorescent tube, CFL, or light bulb?',
      options: [
        { label: 'Yes, tube or bulb', stream: 'special_care' },
        { label: 'No, not a bulb', stream: null },
      ],
    };
  }
  if (attributes.isElectronic) {
    return {
      question: 'Is this an electronic or electrical device?',
      options: [
        { label: 'Yes, electronic device', stream: 'special_care' },
        { label: 'No electronics', stream: null },
      ],
    };
  }
  if (attributes.isHygiene) {
    return {
      question: 'Is this a sanitary hygiene product or personal care item?',
      options: [
        { label: 'Yes, sanitary item', stream: 'sanitary' },
        { label: 'No, other item', stream: null },
      ],
    };
  }
  if (attributes.isFood) {
    return {
      question: 'Is this food waste or kitchen scraps?',
      options: [
        { label: 'Yes, food waste', stream: 'wet' },
        { label: 'No, other item', stream: null },
      ],
    };
  }
  if (attributes.isGarden) {
    return {
      question: 'Is this garden or plant waste?',
      options: [
        { label: 'Yes, garden waste', stream: 'wet' },
        { label: 'No, other item', stream: null },
      ],
    };
  }

  return {
    question: 'Does it contain a battery, medicine or sharp edge?',
    options: [
      { label: 'Yes, hazard present', stream: 'special_care' },
      { label: 'No hazard', stream: null },
    ],
  };
}

/**
 * Evaluates extracted item attributes against SWM Rules 2026 rules table to decide waste stream.
 *
 * @param attributes Visual and contextual attributes extracted by vision provider.
 * @param table Canonical rule table dataset, defaults to imported SWM Rules 2026 table.
 * @param options Optional evaluation flags such as multi-model disagreement.
 * @returns Definitive verdict (answer, ask, or unclear).
 */
export function decide(
  attributes: Attributes,
  table: readonly RuleRow[] = defaultRules,
  options?: DecideOptions
): Verdict {
  const matchedRow = findMatchingRow(attributes.item, table);

  // Precedence 1: Low confidence or multi-model disagreement requires clarification
  if (attributes.confidence < CONFIDENCE_ASK || options?.disagreement === true) {
    const clarification = buildHazardClarification(attributes);
    return {
      kind: 'ask',
      question: clarification.question,
      options: clarification.options,
      reasonId: options?.disagreement ? 'model_disagreement' : 'low_confidence',
      rowId: matchedRow?.id ?? null,
    };
  }

  const confidenceBand: ConfidenceBand =
    attributes.confidence >= CONFIDENCE_HIGH ? 'high' : 'medium';

  // Precedence 2: Hazard attributes override table rows and other attributes to enforce safety
  const hasHazard =
    attributes.isSharp ||
    attributes.isBattery ||
    attributes.isBulb ||
    attributes.isMedicine ||
    attributes.isChemical ||
    attributes.isElectronic;

  if (hasHazard) {
    if (matchedRow) {
      return {
        kind: 'answer',
        stream: 'special_care',
        itemLabel: matchedRow.label,
        reason:
          matchedRow.stream === 'special_care'
            ? matchedRow.reason
            : 'Contains hazardous components requiring special-care disposal per the SWM Rules 2026.',
        action: matchedRow.action,
        flags: matchedRow.flags,
        confidenceBand,
        source: 'table',
        rowId: matchedRow.id,
      };
    }

    return {
      kind: 'answer',
      stream: 'special_care',
      itemLabel: attributes.item.trim() || 'Hazardous item',
      reason:
        'Hazardous domestic attributes mandate special-care segregation per the SWM Rules 2026.',
      action: 'Keep it separate and hand it to a designated collection point.',
      flags: ['rules_vary_by_city'],
      confidenceBand,
      source: 'attributes',
      rowId: null,
    };
  }

  // Precedence 3: Canonical rules table lookup
  if (matchedRow) {
    if (matchedRow.followUp) {
      return {
        kind: 'ask',
        question: matchedRow.followUp.question,
        options: matchedRow.followUp.options,
        reasonId: 'row_follow_up',
        rowId: matchedRow.id,
      };
    }

    if (matchedRow.stream === null) {
      return {
        kind: 'unclear',
        itemLabel: matchedRow.label,
        guidance:
          matchedRow.guidance ??
          "The rules don't clearly cover this. Seal it in a bottle and ask your local body how to dispose of it.",
        flags: matchedRow.flags,
        rowId: matchedRow.id,
      };
    }

    return {
      kind: 'answer',
      stream: matchedRow.stream,
      itemLabel: matchedRow.label,
      reason: matchedRow.reason,
      action: matchedRow.action,
      flags: matchedRow.flags,
      confidenceBand,
      source: 'table',
      rowId: matchedRow.id,
    };
  }

  // Precedence 4: Fallback attribute precedence when no row matched
  if (attributes.isHygiene) {
    return {
      kind: 'answer',
      stream: 'sanitary',
      itemLabel: attributes.item.trim() || 'Sanitary item',
      reason: 'Sanitary hygiene products require secure containment per the SWM Rules 2026.',
      action: 'Wrap it securely and keep it in the sanitary waste container.',
      flags: ['rules_vary_by_city', 'wrap_before_disposal'],
      confidenceBand,
      source: 'attributes',
      rowId: null,
    };
  }

  if (attributes.isFood || attributes.isGarden) {
    return {
      kind: 'answer',
      stream: 'wet',
      itemLabel: attributes.item.trim() || (attributes.isFood ? 'Food waste' : 'Garden waste'),
      reason:
        'Biodegradable organic matter belongs in the wet compost stream per the SWM Rules 2026.',
      action: 'Put it in the wet (compost) bin.',
      flags: ['rules_vary_by_city'],
      confidenceBand,
      source: 'attributes',
      rowId: null,
    };
  }

  // Residual default stream is dry
  return {
    kind: 'answer',
    stream: 'dry',
    itemLabel: attributes.item.trim() || 'Dry waste item',
    reason:
      'Non-hazardous recyclable or residual household items belong in the dry stream per the SWM Rules 2026.',
    action: 'Put it in the dry bin; rinse if dirty.',
    flags: ['rules_vary_by_city'],
    confidenceBand,
    source: 'attributes',
    rowId: null,
  };
}

/**
 * Resolves a citizen follow-up clarification choice into a definitive waste segregation verdict.
 *
 * @param verdict Prior interactive clarification ask verdict.
 * @param optionIndex Zero-based index of the chosen follow-up option.
 * @param table Canonical rule table dataset, defaults to imported SWM Rules 2026 table.
 * @returns Definitive answer or unclear verdict.
 */
export function resolveFollowUp(
  verdict: Verdict,
  optionIndex: number,
  table: readonly RuleRow[] = defaultRules
): Verdict {
  if (verdict.kind !== 'ask') {
    throw new Error(
      `Cannot resolve follow-up for verdict kind: "${verdict.kind}". Expected "ask".`
    );
  }

  const option = verdict.options[optionIndex];
  if (!option) {
    throw new Error(
      `Invalid follow-up option index ${optionIndex}. Available options: 0 to ${verdict.options.length - 1}.`
    );
  }

  const matchedRow = verdict.rowId ? (table.find((r) => r.id === verdict.rowId) ?? null) : null;

  if (option.stream === null) {
    return {
      kind: 'unclear',
      itemLabel: matchedRow?.label ?? 'Uncertain item',
      guidance:
        option.message ??
        matchedRow?.guidance ??
        "The rules don't clearly cover this. Seal it in a bottle and ask your local body how to dispose of it.",
      flags: matchedRow?.flags ?? ['rules_vary_by_city'],
      rowId: matchedRow?.id ?? 'unknown',
    };
  }

  return {
    kind: 'answer',
    stream: option.stream,
    itemLabel:
      matchedRow?.label ?? (verdict.rowId ? verdict.rowId.replace(/_/g, ' ') : option.label),
    reason:
      matchedRow?.reason ??
      (option.stream === 'special_care'
        ? 'Hazardous domestic attributes mandate special-care segregation per the SWM Rules 2026.'
        : (option.message ?? 'Segregate per statutory guidelines.')),
    action:
      matchedRow?.action ??
      (option.stream === 'special_care'
        ? 'Keep it separate and hand it to a designated collection point.'
        : 'Put it in the designated stream bin.'),
    flags: matchedRow?.flags ?? ['rules_vary_by_city'],
    confidenceBand: 'high',
    source: matchedRow ? 'table' : 'attributes',
    rowId: matchedRow?.id ?? null,
  };
}

/**
 * Validates exhaustiveness of stream handling logic across all statutory streams.
 *
 * @param stream Target statutory waste stream.
 * @returns Human-readable standard stream description.
 */
export function describeStream(stream: Stream): string {
  switch (stream) {
    case 'wet':
      return 'Biodegradable wet waste for municipal or home composting.';
    case 'dry':
      return 'Recyclable or non-biodegradable dry waste for material recovery.';
    case 'sanitary':
      return 'Domestic hygiene waste requiring paper wrapping and dedicated containment.';
    case 'special_care':
      return 'Hazardous domestic items requiring isolated handover.';
    default:
      return assertNever(stream);
  }
}

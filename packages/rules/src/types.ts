/** Four statutory waste streams defined by India Solid Waste Management Rules 2026. */
export type Stream = 'wet' | 'dry' | 'sanitary' | 'special_care';

/** Backward-compatible alias for the statutory Stream type. */
export type WasteStream = Stream;

/** Extracted visual and contextual attributes of an item for waste stream determination. */
export interface Attributes {
  /** Identified item name or category description (canonical id or free label). */
  readonly item: string;
  /** True if the item is or contains sharp edges, blades, or broken glass. */
  readonly isSharp: boolean;
  /** True if the item contains batteries or cells. */
  readonly isBattery: boolean;
  /** True if the item is a bulb, tube light, or contains mercury or phosphor. */
  readonly isBulb: boolean;
  /** True if the item is expired medicine, pharmaceutical, or drug packaging with residue. */
  readonly isMedicine: boolean;
  /** True if the item is paint, pesticide, solvent, or hazardous domestic chemical. */
  readonly isChemical: boolean;
  /** True if the item is electronic or electrical equipment or e-waste. */
  readonly isElectronic: boolean;
  /** True if the item is sanitary waste, diaper, pad, bandage, or hygiene product. */
  readonly isHygiene: boolean;
  /** True if the item is food scraps, peelings, or cooked or raw food waste. */
  readonly isFood: boolean;
  /** True if the item is garden waste, leaves, flowers, or organic biomass. */
  readonly isGarden: boolean;
  /** List of visual or contextual evidence strings supporting the detected attributes. */
  readonly evidence: readonly string[];
  /** Model confidence score between 0.0 and 1.0. */
  readonly confidence: number;
}

/** Informational flags indicating handling requirements, legal regimes, or review needs. */
export type Flag =
  | 'rules_vary_by_city'
  | 'separate_regime_ewaste'
  | 'separate_regime_battery'
  | 'conflicting_sources'
  | 'review_before_launch'
  | 'wrap_before_disposal'
  | 'rinse_first'
  | 'no_dosing_advice'
  | 'fire_risk';

/** Follow-up clarification option presenting user choices. */
export interface FollowUpOption {
  /** Option button label text. */
  readonly label: string;
  /** Resulting waste stream for this option, or null if further guidance needed. */
  readonly stream: Stream | null;
  /** Optional contextual message for this choice. */
  readonly message?: string;
}

/** Follow-up clarification question with branching options. */
export interface FollowUp {
  /** Plain-English clarification question. */
  readonly question: string;
  /** Available choices presented to the user. */
  readonly options: readonly FollowUpOption[];
}

/** Canonical rule table entry for an item category. */
export interface RuleRow {
  /** Unique snake_case slug identifier. */
  readonly id: string;
  /** Canonical display label. */
  readonly label: string;
  /** Conservative plain-English search aliases. */
  readonly aliases: readonly string[];
  /** Statutory waste stream, or null if ambiguous or follow-up required. */
  readonly stream: Stream | null;
  /** Statutory or classification basis. */
  readonly basis: 'definition' | 'separate_regime' | 'judgement' | 'conflict';
  /** Regulatory and operational flags. */
  readonly flags: readonly Flag[];
  /** Plain-English action instruction (max 20 words). */
  readonly action: string;
  /** Plain-English statutory reason (max 20 words). */
  readonly reason: string;
  /** Optional follow-up question when stream is conditional. */
  readonly followUp?: FollowUp;
  /** Optional guidance text when stream is null and cannot be resolved automatically. */
  readonly guidance?: string;
}

/** Complete canonical dataset of rule rows. */
export interface RulesDataset {
  /** Specification version string. */
  readonly version: string;
  /** Array of canonical rule rows. */
  readonly rules: readonly RuleRow[];
}

/** Confidence categorization band. */
export type ConfidenceBand = 'high' | 'medium';

/** Definitive waste segregation verdict returned by the rules engine. */
export type Verdict =
  | {
      readonly kind: 'answer';
      readonly stream: Stream;
      readonly itemLabel: string;
      readonly reason: string;
      readonly action: string;
      readonly flags: readonly Flag[];
      readonly confidenceBand: ConfidenceBand;
      readonly source: 'table' | 'attributes';
      readonly rowId: string | null;
    }
  | {
      readonly kind: 'ask';
      readonly question: string;
      readonly options: readonly FollowUpOption[];
      readonly reasonId: 'low_confidence' | 'row_follow_up' | 'model_disagreement';
      readonly rowId: string | null;
    }
  | {
      readonly kind: 'unclear';
      readonly itemLabel: string;
      readonly guidance: string;
      readonly flags: readonly Flag[];
      readonly rowId: string;
    };

/** Evaluation options passed to the rules engine decision function. */
export interface DecideOptions {
  /** Set to true when ensemble models disagree on attribute extraction. */
  readonly disagreement?: boolean;
}

/** Scored match candidate for text queries against the rules table. */
export interface RankedCandidate {
  /** Matched rule row. */
  readonly row: RuleRow;
  /** Match relevance score (higher is stronger). */
  readonly score: number;
}

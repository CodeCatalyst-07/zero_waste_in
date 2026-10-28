/** Emission factor metrics with verifiable provenance and vintage. */
export interface CarbonFactor {
  /** Carbon factor value expressed in the factor's specific unit. */
  value: number;
  /** Unit of measure (e.g., kgCO2e/kg, kgCO2/kWh, kgCO2/vehicle-km, L/person/day). */
  unit: string;
  /** Authoritative institutional source of the factor. */
  source: string;
  /** Publication vintage year of the factor. */
  year: number;
  /** Human-readable description of the avoidance, intensity, or planning norm. */
  description: string;
  /** Reliability and certainty classification. */
  confidence?: 'high' | 'medium' | 'medium-low';
  /** Value from prior publication cycle where published by the issuing agency. */
  priorYearValue?: number;
}

/** Versioned carbon factors registry structure. */
export interface CarbonFactorsRegistry {
  /** Semantic schema version of the factors dataset. */
  version: string;
  /** ISO 8601 release date of the dataset. */
  updatedAt: string;
  /** Keyed map of stream, electricity, transport, and water factors. */
  factors: Record<string, CarbonFactor>;
}

/** Result of avoided greenhouse gas emissions calculation for segregated waste. */
export interface CarbonCalculationResult {
  /** Net avoided carbon emissions in kilograms of CO2 equivalent. */
  avoidedKgCO2e: number;
  /** Key of the emission factor applied in the calculation. */
  factorKey: string;
  /** Reference to the provenance source of the factor used. */
  source: string;
  /** Publication year of the referenced emission factor. */
  year: number;
}

/** Supported motorized transport modes for the Indian context. */
export type TransportMode =
  | 'scooter'
  | 'motorcycle'
  | 'autorickshaw_petrol'
  | 'autorickshaw_cng'
  | 'hatchback_petrol'
  | 'sedan_petrol'
  | 'hatchback_diesel'
  | 'suv_diesel'
  | 'city_bus'
  | 'domestic_flight';

/** Individual transport trip entry parameters for monthly footprint estimation. */
export interface TripInput {
  /** Client-assigned unique identifier for the trip row. */
  id: string;
  /** Transport mode selection. */
  mode: TransportMode;
  /** Distance traveled per trip in kilometers. */
  distanceKm: number;
  /** Recurrence frequency: per individual trip or aggregate weekly routine. */
  frequency: 'per_trip' | 'per_week';
  /** Number of trips per month when frequency is 'per_trip' (defaults to 1). */
  tripsPerMonth?: number;
  /** Vehicle passenger occupancy (defaults to 1; must be >= 1). */
  occupancy?: number;
}

/** Calculated monthly emissions breakdown for an individual trip routine. */
export interface TransportTripBreakdown {
  /** Trip identifier. */
  id: string;
  /** Transport mode. */
  mode: TransportMode;
  /** Input single distance in km. */
  distanceKm: number;
  /** Input frequency. */
  frequency: 'per_trip' | 'per_week';
  /** Total calculated kilometers in a 30-day month (weekly * 52 / 12). */
  monthlyDistanceKm: number;
  /** Vehicle passenger occupancy applied. */
  occupancy: number;
  /** Net monthly emissions allocated to the user in kg CO2. */
  kgCO2PerMonth: number;
  /** Underlying emission factor value. */
  factorValue: number;
  /** Institutional source citation. */
  source: string;
  /** Publication year. */
  year: number;
  /** Whether the factor was already passenger-indexed rather than vehicle-indexed. */
  isPassengerFactor: boolean;
}

/** Aggregate transport emissions calculation result. */
export interface TransportCalculationResult {
  /** Total transport carbon emissions in kg CO2 per month. */
  totalKgCO2PerMonth: number;
  /** Individual trip breakdowns. */
  trips: TransportTripBreakdown[];
}

/** Grid electricity carbon footprint calculation result. */
export interface ElectricityCalculationResult {
  /** Input monthly electricity consumption in kWh. */
  kwh: number;
  /** Total monthly emissions in kg CO2. */
  kgCO2PerMonth: number;
  /** Applied emission factor value (0.675 kgCO2/kWh). */
  factorValue: number;
  /** Institutional source citation (CEA v22.0). */
  source: string;
  /** Publication year. */
  year: number;
  /** Prior year factor value (0.710 kgCO2/kWh) if available. */
  priorYearValue?: number;
}

/** Combined monthly carbon footprint estimation result. */
export interface FootprintEstimateResult {
  /** Electricity portion of the monthly estimate. */
  electricity: ElectricityCalculationResult;
  /** Transport portion of the monthly estimate. */
  transport: TransportCalculationResult;
  /** Combined total monthly emissions in kg CO2. */
  totalKgCO2PerMonth: number;
}

/** Water municipal planning norm reference calculation. */
export interface WaterPlanningNormResult {
  /** Setting classification: urban (with sewerage) or rural. */
  type: 'urban' | 'rural';
  /** Per-person daily planning norm in liters (135 L urban, 55 L rural). */
  litersPerPersonDay: number;
  /** Household daily planning allowance based on household size. */
  totalLitersPerDay: number;
  /** Household monthly planning allowance (30 days). */
  totalLitersPerMonth: number;
  /** Authoritative institutional guideline source. */
  source: string;
  /** Publication year. */
  year: number;
  /** Human-readable explanation emphasizing planning norm context. */
  label: string;
}

/** Component ID union for the citizen Eco Score. */
export type EcoScoreComponentId =
  'sorting_habit' | 'electricity_trend' | 'water_trend' | 'transport_trend';

/** Detailed evaluation for a single Eco Score component. */
export interface EcoScoreComponent {
  /** Unique component key. */
  id: EcoScoreComponentId;
  /** Friendly component name. */
  name: string;
  /** Baseline nominal weight (sorting 40%, electricity 25%, water 15%, transport 20%). */
  nominalWeight: number;
  /** Effective weight after renormalizing over available components. */
  effectiveWeight: number;
  /** Calculated component score (0 to 100). */
  score: number;
  /** Whether sufficient on-device data exists to evaluate this component. */
  available: boolean;
  /** Human-readable explanation of the data inputs and evaluation. */
  detail: string;
}

/** Final citizen Eco Score evaluation result. */
export interface EcoScoreResult {
  /** Final calculated score (0 to 100), or null if no component data is available. */
  score: number | null;
  /** Number of components with active real data (0 to 4). */
  availableComponentsCount: number;
  /** Evaluation details for all 4 components. */
  components: EcoScoreComponent[];
  /** True if at least one component contributed to the score. */
  isAvailable: boolean;
  /** Plain-text accessible summary for screen readers. */
  summary: string;
}

/** User input values required to compute the Eco Score. */
export interface EcoScoreInput {
  /** Number of items sorted in the last 30 days (from on-device tally). */
  itemsSortedLast30Days?: number;
  /** Current month's electricity usage in kWh (from tracker). */
  electricityCurrentKwh?: number;
  /** Previous month's electricity usage in kWh (from tracker). */
  electricityPreviousKwh?: number;
  /** Current month's water usage in liters (from tracker). */
  waterCurrentLiters?: number;
  /** Previous month's water usage in liters (from tracker). */
  waterPreviousLiters?: number;
  /** Current month's transport footprint in kg CO2. */
  transportCurrentKgCO2?: number;
  /** Previous month's transport footprint in kg CO2. */
  transportPreviousKgCO2?: number;
}

import rawFactors from './factors.json' with { type: 'json' };
import type {
  CarbonCalculationResult,
  CarbonFactorsRegistry,
  EcoScoreComponent,
  EcoScoreInput,
  EcoScoreResult,
  ElectricityCalculationResult,
  FootprintEstimateResult,
  TransportCalculationResult,
  TransportMode,
  TransportTripBreakdown,
  TripInput,
  WaterPlanningNormResult,
} from './types.js';

/** Frozen registry of all statutory and verified emission factors. */
export const carbonFactors: CarbonFactorsRegistry = rawFactors as CarbonFactorsRegistry;

/** Map of transport modes to their respective factors.json keys. */
const TRANSPORT_FACTOR_KEYS: Record<TransportMode, string> = {
  scooter: 'transport_scooter',
  motorcycle: 'transport_motorcycle',
  autorickshaw_petrol: 'transport_autorickshaw_petrol',
  autorickshaw_cng: 'transport_autorickshaw_cng',
  hatchback_petrol: 'transport_hatchback_petrol',
  sedan_petrol: 'transport_sedan_petrol',
  hatchback_diesel: 'transport_hatchback_diesel',
  suv_diesel: 'transport_suv_diesel',
  city_bus: 'transport_city_bus',
  domestic_flight: 'transport_domestic_flight',
};

/** Modes where factor is already indexed per passenger-km rather than vehicle-km. */
const PASSENGER_MODES = new Set<TransportMode>(['city_bus', 'domestic_flight']);

/** Average weeks per standard 30-day month (52 weeks / 12 months). */
export const WEEKS_PER_MONTH = 52 / 12;

/**
 * Calculates estimated grid electricity greenhouse gas emissions per month.
 *
 * Source: CEA CO2 Baseline Database v22.0, FY 2025-26 (0.675 kg CO2/kWh).
 *
 * @param kwh Monthly electricity consumption in kilowatt-hours (must be >= 0).
 * @returns Breakdown including emissions, factor provenance, and prior-year comparison.
 */
export function calculateElectricityEmissions(kwh: number): ElectricityCalculationResult {
  if (typeof kwh !== 'number' || isNaN(kwh) || kwh < 0) {
    throw new TypeError(`Electricity consumption must be a non-negative number; received ${kwh}`);
  }

  const factor = carbonFactors.factors['electricity_grid'];
  if (!factor) {
    throw new Error('Factor "electricity_grid" not found in carbon factors registry');
  }

  const kgCO2PerMonth = Math.round(kwh * factor.value * 100) / 100;

  return {
    kwh,
    kgCO2PerMonth,
    factorValue: factor.value,
    source: factor.source,
    year: factor.year,
    priorYearValue: factor.priorYearValue,
  };
}

/**
 * Calculates monthly transport carbon emissions across a user's logged travel routines.
 *
 * Source: India GHG Program Road Transport Factors & Aviation Consultation Draft (2015).
 * Vehicle factors are divided by passenger occupancy. Passenger-indexed modes (bus, flight) are not divided.
 *
 * @param trips Array of travel routine definitions with mode, distance, and recurrence.
 * @returns Total monthly transport emissions in kg CO2 with per-trip breakdowns.
 */
export function calculateTransportEmissions(trips: TripInput[]): TransportCalculationResult {
  if (!Array.isArray(trips)) {
    throw new TypeError('Trips must be provided as an array');
  }

  const breakdowns: TransportTripBreakdown[] = [];
  let totalKg = 0;

  for (const trip of trips) {
    if (!trip || typeof trip !== 'object') {
      continue;
    }

    const { id, mode, distanceKm, frequency, tripsPerMonth, occupancy: rawOccupancy } = trip;

    if (!mode || !(mode in TRANSPORT_FACTOR_KEYS)) {
      throw new Error(`Unsupported transport mode: ${String(mode)}`);
    }

    if (typeof distanceKm !== 'number' || isNaN(distanceKm) || distanceKm < 0) {
      throw new TypeError(`Trip distance must be a non-negative number; received ${distanceKm}`);
    }

    const occupancy =
      typeof rawOccupancy === 'number' && rawOccupancy >= 1 ? Math.floor(rawOccupancy) : 1;
    const isPassengerFactor = PASSENGER_MODES.has(mode);

    let monthlyDistanceKm = 0;
    if (frequency === 'per_week') {
      monthlyDistanceKm = Math.round(distanceKm * WEEKS_PER_MONTH * 100) / 100;
    } else {
      const count =
        typeof tripsPerMonth === 'number' && tripsPerMonth >= 0 ? Math.floor(tripsPerMonth) : 1;
      monthlyDistanceKm = Math.round(distanceKm * count * 100) / 100;
    }

    const factorKey = TRANSPORT_FACTOR_KEYS[mode];
    const factor = carbonFactors.factors[factorKey];
    if (!factor) {
      throw new Error(`Factor "${factorKey}" not found in carbon factors registry`);
    }

    const effectiveFactor = isPassengerFactor ? factor.value : factor.value / occupancy;
    const kgCO2PerMonth = Math.round(monthlyDistanceKm * effectiveFactor * 100) / 100;

    totalKg += kgCO2PerMonth;

    breakdowns.push({
      id: id || `${mode}-${breakdowns.length}`,
      mode,
      distanceKm,
      frequency: frequency === 'per_week' ? 'per_week' : 'per_trip',
      monthlyDistanceKm,
      occupancy: isPassengerFactor ? 1 : occupancy,
      kgCO2PerMonth,
      factorValue: factor.value,
      source: factor.source,
      year: factor.year,
      isPassengerFactor,
    });
  }

  return {
    totalKgCO2PerMonth: Math.round(totalKg * 100) / 100,
    trips: breakdowns,
  };
}

/**
 * Combines monthly electricity and transport routines into a consolidated carbon footprint estimate.
 *
 * @param electricityKwh Monthly electricity usage in kWh.
 * @param trips Array of commute and travel routines.
 * @returns Consolidated monthly footprint estimate.
 */
export function calculateFootprintEstimate(
  electricityKwh: number,
  trips: TripInput[]
): FootprintEstimateResult {
  const electricity = calculateElectricityEmissions(electricityKwh);
  const transport = calculateTransportEmissions(trips);
  const totalKgCO2PerMonth =
    Math.round((electricity.kgCO2PerMonth + transport.totalKgCO2PerMonth) * 100) / 100;

  return {
    electricity,
    transport,
    totalKgCO2PerMonth,
  };
}

/**
 * Returns the statutory municipal water planning norm for contextual reference.
 *
 * Sources:
 * - Urban: CPHEEO / MoHUA Water Supply Manual (135 L/person/day for communities with sewerage)
 * - Rural: Jal Jeevan Mission / Ministry of Jal Shakti Guidelines (55 L/person/day)
 *
 * NOTE: Planning norms are engineering design allowances for municipal supply, never individual consumption targets.
 *
 * @param type Community infrastructure classification ('urban' or 'rural').
 * @param householdSize Number of residents in the household (defaults to 1).
 * @returns Planning norm metrics and formal disclaimer metadata.
 */
export function getWaterPlanningNorm(
  type: 'urban' | 'rural',
  householdSize = 1
): WaterPlanningNormResult {
  const validSize =
    typeof householdSize === 'number' && householdSize >= 1 ? Math.floor(householdSize) : 1;
  const factorKey = type === 'rural' ? 'water_norm_rural' : 'water_norm_urban';
  const factor = carbonFactors.factors[factorKey];

  if (!factor) {
    throw new Error(`Water norm factor "${factorKey}" not found in carbon registry`);
  }

  const litersPerPersonDay = factor.value;
  const totalLitersPerDay = litersPerPersonDay * validSize;
  const totalLitersPerMonth = totalLitersPerDay * 30;

  return {
    type,
    litersPerPersonDay,
    totalLitersPerDay,
    totalLitersPerMonth,
    source: factor.source,
    year: factor.year,
    label:
      type === 'urban'
        ? 'Urban planning norm (CPHEEO): 135 L/person/day with sewerage infrastructure'
        : 'Rural planning norm (Jal Jeevan Mission): 55 L/person/day piped supply',
  };
}

/**
 * Computes the transparent citizen Eco Score based on verifiable on-device inputs.
 *
 * Formula weights:
 * 1. Sorting habit (40%): items sorted in last 30 days vs 20-item goal (capped at 100%).
 * 2. Electricity trend (25%): current month vs own previous month.
 * 3. Water trend (15%): current month vs own previous month.
 * 4. Transport trend (20%): current month transport footprint vs own previous month.
 *
 * Weights are renormalized across available inputs only. No score is returned if 0 inputs exist.
 *
 * @param input On-device activity and utility metrics.
 * @returns Evaluated score, component breakdown, and plain-text summary.
 */
export function calculateEcoScore(input: EcoScoreInput): EcoScoreResult {
  const components: EcoScoreComponent[] = [];

  // Component 1: Sorting habit (nominal weight 40%)
  const hasSortingData =
    typeof input.itemsSortedLast30Days === 'number' && input.itemsSortedLast30Days >= 0;
  let sortingScore = 0;
  let sortingDetail = 'No items sorted on this device in the last 30 days';

  if (hasSortingData) {
    const count = input.itemsSortedLast30Days!;
    sortingScore = Math.min(100, Math.round((count / 20) * 100));
    sortingDetail = `${count} of 20 items sorted in last 30 days (${sortingScore}%)`;
  }

  components.push({
    id: 'sorting_habit',
    name: 'Sorting activity',
    nominalWeight: 0.4,
    effectiveWeight: 0,
    score: sortingScore,
    available: hasSortingData && input.itemsSortedLast30Days! > 0,
    detail: sortingDetail,
  });

  // Component 2: Electricity trend vs own previous month (nominal weight 25%)
  const hasElecData =
    typeof input.electricityCurrentKwh === 'number' &&
    typeof input.electricityPreviousKwh === 'number' &&
    input.electricityPreviousKwh > 0 &&
    input.electricityCurrentKwh >= 0;

  let elecScore = 0;
  let elecDetail = 'Requires at least 2 consecutive monthly electricity entries';

  if (hasElecData) {
    const curr = input.electricityCurrentKwh!;
    const prev = input.electricityPreviousKwh!;
    if (curr <= prev) {
      elecScore = 100;
      const reduction = Math.round(((prev - curr) / prev) * 100);
      elecDetail =
        reduction > 0
          ? `${reduction}% reduction from previous month (${curr} vs ${prev} kWh)`
          : `Usage unchanged from previous month (${curr} kWh)`;
    } else {
      const increaseRatio = (curr - prev) / prev;
      // 50% increase reaches 0 score
      elecScore = Math.max(0, Math.round((1 - increaseRatio / 0.5) * 100));
      const increasePct = Math.round(increaseRatio * 100);
      elecDetail = `${increasePct}% increase over previous month (${curr} vs ${prev} kWh)`;
    }
  }

  components.push({
    id: 'electricity_trend',
    name: 'Electricity trend',
    nominalWeight: 0.25,
    effectiveWeight: 0,
    score: elecScore,
    available: hasElecData,
    detail: elecDetail,
  });

  // Component 3: Water trend vs own previous month (nominal weight 15%)
  const hasWaterData =
    typeof input.waterCurrentLiters === 'number' &&
    typeof input.waterPreviousLiters === 'number' &&
    input.waterPreviousLiters > 0 &&
    input.waterCurrentLiters >= 0;

  let waterScore = 0;
  let waterDetail = 'Requires at least 2 consecutive monthly water entries';

  if (hasWaterData) {
    const curr = input.waterCurrentLiters!;
    const prev = input.waterPreviousLiters!;
    if (curr <= prev) {
      waterScore = 100;
      const reduction = Math.round(((prev - curr) / prev) * 100);
      waterDetail =
        reduction > 0
          ? `${reduction}% reduction from previous month (${curr} vs ${prev} L)`
          : `Usage unchanged from previous month (${curr} L)`;
    } else {
      const increaseRatio = (curr - prev) / prev;
      waterScore = Math.max(0, Math.round((1 - increaseRatio / 0.5) * 100));
      const increasePct = Math.round(increaseRatio * 100);
      waterDetail = `${increasePct}% increase over previous month (${curr} vs ${prev} L)`;
    }
  }

  components.push({
    id: 'water_trend',
    name: 'Water trend',
    nominalWeight: 0.15,
    effectiveWeight: 0,
    score: waterScore,
    available: hasWaterData,
    detail: waterDetail,
  });

  // Component 4: Transport trend vs own previous month (nominal weight 20%)
  const hasTransportData =
    typeof input.transportCurrentKgCO2 === 'number' &&
    typeof input.transportPreviousKgCO2 === 'number' &&
    input.transportPreviousKgCO2 > 0 &&
    input.transportCurrentKgCO2 >= 0;

  let transportScore = 0;
  let transportDetail = 'Requires at least 2 consecutive monthly transport entries';

  if (hasTransportData) {
    const curr = input.transportCurrentKgCO2!;
    const prev = input.transportPreviousKgCO2!;
    if (curr <= prev) {
      transportScore = 100;
      const reduction = Math.round(((prev - curr) / prev) * 100);
      transportDetail =
        reduction > 0
          ? `${reduction}% reduction from previous month (${curr} vs ${prev} kg CO2)`
          : `Emissions unchanged from previous month (${curr} kg CO2)`;
    } else {
      const increaseRatio = (curr - prev) / prev;
      transportScore = Math.max(0, Math.round((1 - increaseRatio / 0.5) * 100));
      const increasePct = Math.round(increaseRatio * 100);
      transportDetail = `${increasePct}% increase over previous month (${curr} vs ${prev} kg CO2)`;
    }
  }

  components.push({
    id: 'transport_trend',
    name: 'Transport trend',
    nominalWeight: 0.2,
    effectiveWeight: 0,
    score: transportScore,
    available: hasTransportData,
    detail: transportDetail,
  });

  // Renormalize weights across available components only
  const activeComponents = components.filter((c) => c.available);
  const availableCount = activeComponents.length;

  if (availableCount === 0) {
    return {
      score: null,
      availableComponentsCount: 0,
      components,
      isAvailable: false,
      summary:
        'No Eco Score yet. Sort items or record monthly utilities to generate your score based on real data.',
    };
  }

  const totalNominalWeight = activeComponents.reduce((sum, c) => sum + c.nominalWeight, 0);

  let weightedScoreSum = 0;
  for (const component of components) {
    if (component.available) {
      component.effectiveWeight =
        Math.round((component.nominalWeight / totalNominalWeight) * 100) / 100;
      weightedScoreSum += component.score * (component.nominalWeight / totalNominalWeight);
    } else {
      component.effectiveWeight = 0;
    }
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(weightedScoreSum)));

  return {
    score: finalScore,
    availableComponentsCount: availableCount,
    components,
    isAvailable: true,
    summary: `Eco Score is ${finalScore} out of 100, calculated from ${availableCount} of 4 verifiable data inputs.`,
  };
}

/**
 * Calculates estimated avoided carbon emissions in kgCO2e for segregated waste by stream and mass.
 *
 * @param stream Target statutory waste stream (wet, dry, sanitary, special_care).
 * @param weightGrams Discarded item mass in grams.
 * @returns Carbon calculation result with authoritative factor citation.
 */
export function calculateAvoidedEmissions(
  stream: string,
  weightGrams: number
): CarbonCalculationResult {
  if (typeof weightGrams !== 'number' || isNaN(weightGrams) || weightGrams < 0) {
    throw new TypeError(`Waste mass must be a non-negative number; received ${weightGrams}`);
  }

  let factorKey = 'wet_composting_avoided_ch4';
  if (stream === 'dry') {
    factorKey = 'dry_plastic_recycling_avoided';
  } else if (stream === 'sanitary') {
    factorKey = 'sanitary_controlled_incineration';
  } else if (stream === 'special_care') {
    factorKey = 'special_care_tsdf_hazardous_mitigation';
  }

  const factor = carbonFactors.factors[factorKey];
  if (!factor) {
    throw new Error(`Emission factor "${factorKey}" not found in carbon registry`);
  }

  const massKg = weightGrams / 1000;
  const avoidedKgCO2e = Math.round(massKg * factor.value * 1000) / 1000;

  return {
    avoidedKgCO2e,
    factorKey,
    source: factor.source,
    year: factor.year,
  };
}

/**
 * Computes lifetime aggregate emission mitigations across multiple waste streams.
 *
 * @param streamTotals Map of waste streams to cumulative segregated kilograms.
 * @returns Total avoided emissions in kgCO2e.
 */
export function calculateTotalAvoidedEmissions(streamTotals: Record<string, number>): number {
  if (!streamTotals || typeof streamTotals !== 'object') {
    return 0;
  }

  let totalAvoided = 0;

  for (const [stream, kg] of Object.entries(streamTotals)) {
    if (typeof kg === 'number' && kg > 0) {
      const grams = kg * 1000;
      const result = calculateAvoidedEmissions(stream, grams);
      totalAvoided += result.avoidedKgCO2e;
    }
  }

  return Math.round(totalAvoided * 100) / 100;
}

import { describe, expect, it } from 'vitest';
import {
  calculateAvoidedEmissions,
  calculateEcoScore,
  calculateElectricityEmissions,
  calculateFootprintEstimate,
  calculateTotalAvoidedEmissions,
  calculateTransportEmissions,
  carbonFactors,
  getWaterPlanningNorm,
  type TripInput,
} from '../src/index.js';

describe('packages/carbon: factors.json provenance & schema', () => {
  it('loads versioned factors where every factor has a verifiable source and year', () => {
    expect(carbonFactors.version).toBe('2026.2.0');
    expect(Object.keys(carbonFactors.factors).length).toBeGreaterThanOrEqual(18);

    const validUnits = new Set([
      'kgCO2e/kg',
      'kgCO2/kWh',
      'kgCO2/vehicle-km',
      'kgCO2/passenger-km',
      'L/person/day',
    ]);

    for (const [key, factor] of Object.entries(carbonFactors.factors)) {
      expect(factor.value).toBeGreaterThan(0);
      expect(typeof factor.source).toBe('string');
      expect(factor.source.length).toBeGreaterThan(5);
      expect(typeof factor.year).toBe('number');
      expect(factor.year).toBeGreaterThanOrEqual(2015);
      expect(validUnits.has(factor.unit)).toBe(true);
      expect(factor.description.length).toBeGreaterThan(10);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('contains statutory electricity factor with prior-year tracking', () => {
    const elec = carbonFactors.factors['electricity_grid']!;
    expect(elec).toBeDefined();
    expect(elec.value).toBe(0.675);
    expect(elec.priorYearValue).toBe(0.71);
    expect(elec.source).toContain('CEA');
  });

  it('contains road transport factors from India GHG Program stakeholder draft', () => {
    const scooter = carbonFactors.factors['transport_scooter']!;
    expect(scooter.value).toBe(0.037);

    const motorcycle = carbonFactors.factors['transport_motorcycle']!;
    expect(motorcycle.value).toBe(0.033);

    const autoPetrol = carbonFactors.factors['transport_autorickshaw_petrol']!;
    expect(autoPetrol.value).toBe(0.1135);

    const autoCng = carbonFactors.factors['transport_autorickshaw_cng']!;
    expect(autoCng.value).toBe(0.1077);

    const hatchPetrol = carbonFactors.factors['transport_hatchback_petrol']!;
    expect(hatchPetrol.value).toBe(0.117);

    const sedanPetrol = carbonFactors.factors['transport_sedan_petrol']!;
    expect(sedanPetrol.value).toBe(0.142);

    const hatchDiesel = carbonFactors.factors['transport_hatchback_diesel']!;
    expect(hatchDiesel.value).toBe(0.105);

    const suvDiesel = carbonFactors.factors['transport_suv_diesel']!;
    expect(suvDiesel.value).toBe(0.186);

    const bus = carbonFactors.factors['transport_city_bus']!;
    expect(bus.value).toBe(0.0152);

    const flight = carbonFactors.factors['transport_domestic_flight']!;
    expect(flight.value).toBe(0.121);
    expect(flight.description).toContain('no uplift');
  });

  it('contains CPHEEO and Jal Jeevan Mission water planning norms', () => {
    const urban = carbonFactors.factors['water_norm_urban']!;
    expect(urban.value).toBe(135);
    expect(urban.source).toContain('CPHEEO');

    const rural = carbonFactors.factors['water_norm_rural']!;
    expect(rural.value).toBe(55);
    expect(rural.source).toContain('Jal Jeevan Mission');
  });
});

describe('packages/carbon: electricity calculator', () => {
  it.each([
    { kwh: 0, expectedKg: 0 },
    { kwh: 100, expectedKg: 67.5 },
    { kwh: 200, expectedKg: 135.0 },
    { kwh: 250.5, expectedKg: 169.09 },
  ])(
    'calculates electricity emissions for $kwh kWh -> $expectedKg kg CO2',
    ({ kwh, expectedKg }) => {
      const result = calculateElectricityEmissions(kwh);
      expect(result.kgCO2PerMonth).toBe(expectedKg);
      expect(result.factorValue).toBe(0.675);
      expect(result.priorYearValue).toBe(0.71);
    }
  );

  it('rejects negative or invalid kilowatt-hours', () => {
    expect(() => calculateElectricityEmissions(-10)).toThrow(TypeError);
    expect(() => calculateElectricityEmissions(NaN)).toThrow(TypeError);
  });
});

describe('packages/carbon: transport calculator', () => {
  it('calculates vehicle emissions divided by occupancy', () => {
    // 100 km in hatchback petrol (<1000cc, factor 0.117)
    // Solo driver: 100 * 0.117 / 1 = 11.7 kg CO2
    const solo = calculateTransportEmissions([
      {
        id: 'trip-1',
        mode: 'hatchback_petrol',
        distanceKm: 100,
        frequency: 'per_trip',
        tripsPerMonth: 1,
        occupancy: 1,
      },
    ]);
    expect(solo.totalKgCO2PerMonth).toBe(11.7);
    expect(solo.trips[0]?.kgCO2PerMonth).toBe(11.7);

    // Carpool of 4: 100 * 0.117 / 4 = 2.925 -> 2.93 kg CO2
    const carpool = calculateTransportEmissions([
      {
        id: 'trip-2',
        mode: 'hatchback_petrol',
        distanceKm: 100,
        frequency: 'per_trip',
        tripsPerMonth: 1,
        occupancy: 4,
      },
    ]);
    expect(carpool.totalKgCO2PerMonth).toBe(2.93);
    expect(carpool.trips[0]?.kgCO2PerMonth).toBe(2.93);
  });

  it('does NOT divide passenger-indexed modes (bus, flight) by vehicle occupancy', () => {
    // City bus: 100 km * 0.0152 = 1.52 kg CO2
    const bus = calculateTransportEmissions([
      {
        id: 'bus-1',
        mode: 'city_bus',
        distanceKm: 100,
        frequency: 'per_trip',
        tripsPerMonth: 1,
        occupancy: 40, // Even if 40 is entered, bus is passenger-km
      },
    ]);
    expect(bus.totalKgCO2PerMonth).toBe(1.52);
    expect(bus.trips[0]?.isPassengerFactor).toBe(true);

    // Domestic flight: 500 km * 0.121 = 60.5 kg CO2
    const flight = calculateTransportEmissions([
      {
        id: 'flight-1',
        mode: 'domestic_flight',
        distanceKm: 500,
        frequency: 'per_trip',
        tripsPerMonth: 1,
      },
    ]);
    expect(flight.totalKgCO2PerMonth).toBe(60.5);
  });

  it('converts weekly commute routine into standard monthly kilometers', () => {
    // 10 km per week on scooter (0.037 kg/km)
    // Monthly km = 10 * (52 / 12) = 43.33 km
    // Emissions = 43.33 * 0.037 = 1.60 kg CO2
    const weeklyScooter = calculateTransportEmissions([
      {
        id: 'commute',
        mode: 'scooter',
        distanceKm: 10,
        frequency: 'per_week',
      },
    ]);
    expect(weeklyScooter.trips[0]?.monthlyDistanceKm).toBe(43.33);
    expect(weeklyScooter.totalKgCO2PerMonth).toBe(1.6);
  });

  it('rejects unsupported modes or negative distances', () => {
    expect(() =>
      calculateTransportEmissions([
        {
          id: 'bad',
          // @ts-expect-error Testing invalid runtime mode
          mode: 'helicopter',
          distanceKm: 10,
          frequency: 'per_trip',
        },
      ])
    ).toThrow();

    expect(() =>
      calculateTransportEmissions([
        {
          id: 'neg',
          mode: 'motorcycle',
          distanceKm: -5,
          frequency: 'per_trip',
        },
      ])
    ).toThrow(TypeError);
  });
});

describe('packages/carbon: combined footprint estimate', () => {
  it('combines electricity and transport routines into total kg CO2', () => {
    const result = calculateFootprintEstimate(100, [
      {
        id: 'trip-1',
        mode: 'motorcycle',
        distanceKm: 100,
        frequency: 'per_trip',
        tripsPerMonth: 1,
      },
    ]);

    // Elec: 100 * 0.675 = 67.5 kg
    // Moto: 100 * 0.033 = 3.3 kg
    // Total: 70.8 kg
    expect(result.electricity.kgCO2PerMonth).toBe(67.5);
    expect(result.transport.totalKgCO2PerMonth).toBe(3.3);
    expect(result.totalKgCO2PerMonth).toBe(70.8);
  });
});

describe('packages/carbon: water planning norms', () => {
  it('returns CPHEEO urban planning allowance for household sizes', () => {
    const single = getWaterPlanningNorm('urban', 1);
    expect(single.litersPerPersonDay).toBe(135);
    expect(single.totalLitersPerDay).toBe(135);
    expect(single.totalLitersPerMonth).toBe(4050);
    expect(single.label).toContain('CPHEEO');

    const family = getWaterPlanningNorm('urban', 4);
    expect(family.totalLitersPerDay).toBe(540);
    expect(family.totalLitersPerMonth).toBe(16200);
  });

  it('returns Jal Jeevan Mission rural planning norm', () => {
    const rural = getWaterPlanningNorm('rural', 2);
    expect(rural.litersPerPersonDay).toBe(55);
    expect(rural.totalLitersPerDay).toBe(110);
    expect(rural.totalLitersPerMonth).toBe(3300);
    expect(rural.label).toContain('Jal Jeevan Mission');
  });
});

describe('packages/carbon: Eco Score calculation', () => {
  it('returns null and unavailable when zero user data inputs exist', () => {
    const score = calculateEcoScore({});
    expect(score.score).toBeNull();
    expect(score.isAvailable).toBe(false);
    expect(score.availableComponentsCount).toBe(0);
    expect(score.summary).toContain('No Eco Score yet');
  });

  it('evaluates sorting habit only and renormalizes weight to 100%', () => {
    // 10 items sorted vs 20 goal = 50%
    const score10 = calculateEcoScore({ itemsSortedLast30Days: 10 });
    expect(score10.score).toBe(50);
    expect(score10.availableComponentsCount).toBe(1);
    expect(score10.isAvailable).toBe(true);
    expect(score10.components.find((c) => c.id === 'sorting_habit')?.effectiveWeight).toBe(1);

    // 25 items sorted vs 20 goal = capped at 100%
    const score25 = calculateEcoScore({ itemsSortedLast30Days: 25 });
    expect(score25.score).toBe(100);
  });

  it('renormalizes across sorting (40%) and electricity trend (25%)', () => {
    // Sorting: 20 items (score 100)
    // Electricity: 80 kWh current vs 100 kWh previous (20% reduction -> score 100)
    // Total: (100 * 0.4 + 100 * 0.25) / (0.4 + 0.25) = 100
    const fullPass = calculateEcoScore({
      itemsSortedLast30Days: 20,
      electricityCurrentKwh: 80,
      electricityPreviousKwh: 100,
    });
    expect(fullPass.score).toBe(100);
    expect(fullPass.availableComponentsCount).toBe(2);

    // Electricity increase of 25%: curr 125, prev 100
    // Increase ratio = 0.25. Score = 1 - (0.25/0.5) = 50%
    // Weighted: (100 * 0.4 + 50 * 0.25) / 0.65 = 52.5 / 0.65 = 80.77 -> 81
    const elecIncrease = calculateEcoScore({
      itemsSortedLast30Days: 20,
      electricityCurrentKwh: 125,
      electricityPreviousKwh: 100,
    });
    expect(elecIncrease.score).toBe(81);
    expect(elecIncrease.components.find((c) => c.id === 'electricity_trend')?.score).toBe(50);
  });

  it('clamps excessive consumption increase (>=50%) to 0 component score', () => {
    // 60% electricity surge: 160 kWh vs 100 kWh
    const surge = calculateEcoScore({
      itemsSortedLast30Days: 20,
      electricityCurrentKwh: 160,
      electricityPreviousKwh: 100,
    });
    const elecComp = surge.components.find((c) => c.id === 'electricity_trend');
    expect(elecComp?.score).toBe(0);
    // (100 * 0.4 + 0 * 0.25) / 0.65 = 40 / 0.65 = 61.5 -> 62
    expect(surge.score).toBe(62);
  });

  it('calculates full 4-component score accurately with nominal weights summing to 1.0', () => {
    const full = calculateEcoScore({
      itemsSortedLast30Days: 20, // score 100 (w=0.40)
      electricityCurrentKwh: 100, // score 100 (w=0.25)
      electricityPreviousKwh: 100,
      waterCurrentLiters: 3000, // score 100 (w=0.15)
      waterPreviousLiters: 3000,
      transportCurrentKgCO2: 50, // score 100 (w=0.20)
      transportPreviousKgCO2: 50,
    });

    expect(full.score).toBe(100);
    expect(full.availableComponentsCount).toBe(4);
    expect(full.summary).toContain('Eco Score is 100 out of 100');
  });

  it('handles edge cases: zero previous month gracefully by marking component unavailable', () => {
    const zeroPrev = calculateEcoScore({
      itemsSortedLast30Days: 10,
      electricityCurrentKwh: 100,
      electricityPreviousKwh: 0, // cannot compute ratio against 0
    });
    expect(zeroPrev.availableComponentsCount).toBe(1);
    expect(zeroPrev.components.find((c) => c.id === 'electricity_trend')?.available).toBe(false);
  });

  it('calculates water and transport trend increases and reductions', () => {
    const withIncreases = calculateEcoScore({
      itemsSortedLast30Days: 15,
      electricityCurrentKwh: 80,
      electricityPreviousKwh: 100, // 20% reduction -> score 100
      waterCurrentLiters: 3500,
      waterPreviousLiters: 3000, // increase
      transportCurrentKgCO2: 60,
      transportPreviousKgCO2: 50, // increase
    });

    const waterComp = withIncreases.components.find((c) => c.id === 'water_trend');
    expect(waterComp?.available).toBe(true);
    expect(waterComp?.detail).toContain('increase');

    const transportComp = withIncreases.components.find((c) => c.id === 'transport_trend');
    expect(transportComp?.available).toBe(true);
    expect(transportComp?.detail).toContain('increase');

    const withReductions = calculateEcoScore({
      itemsSortedLast30Days: 15,
      waterCurrentLiters: 2000,
      waterPreviousLiters: 2500, // reduction
      transportCurrentKgCO2: 40,
      transportPreviousKgCO2: 50, // reduction
    });

    expect(withReductions.components.find((c) => c.id === 'water_trend')?.detail).toContain('reduction');
    expect(withReductions.components.find((c) => c.id === 'transport_trend')?.detail).toContain('reduction');
  });
});

describe('packages/carbon: avoided waste emissions', () => {
  it('calculates avoided emissions by stream', () => {
    const wet = calculateAvoidedEmissions('wet', 2000);
    expect(wet.avoidedKgCO2e).toBe(0.7); // 2 kg * 0.35

    const dry = calculateAvoidedEmissions('dry', 1000);
    expect(dry.avoidedKgCO2e).toBe(1.45); // 1 kg * 1.45

    const sanitary = calculateAvoidedEmissions('sanitary', 1000);
    expect(sanitary.avoidedKgCO2e).toBe(0.18);

    const specialCare = calculateAvoidedEmissions('special_care', 500);
    expect(specialCare.avoidedKgCO2e).toBe(0.22);

    const otherStream = calculateAvoidedEmissions('unknown_stream', 1000);
    expect(otherStream.avoidedKgCO2e).toBe(0.35); // defaults to wet factor

    const total = calculateTotalAvoidedEmissions({ wet: 2, dry: 1, sanitary: 1, special_care: 0.5 });
    expect(total).toBeGreaterThan(2);

    expect(calculateTotalAvoidedEmissions(null as any)).toBe(0);
    expect(calculateTotalAvoidedEmissions(undefined as any)).toBe(0);
  });

  it('rejects invalid waste mass inputs', () => {
    expect(() => calculateAvoidedEmissions('wet', -10)).toThrow(TypeError);
    expect(() => calculateAvoidedEmissions('wet', NaN)).toThrow(TypeError);
    expect(() => calculateAvoidedEmissions('wet', 'invalid' as any)).toThrow(TypeError);
  });

  it('handles transport trips with fallback options and default parameters', () => {
    const res = calculateTransportEmissions([
      {
        mode: 'scooter',
        distanceKm: 10,
        // missing id, frequency, tripsPerMonth, occupancy
      } as unknown as TripInput,
      {
        id: 'bus-trip',
        mode: 'city_bus',
        distanceKm: 20,
        frequency: 'per_week',
        occupancy: 2, // passenger factor mode ignores occupancy divisor
      },
    ]);

    expect(res.trips.length).toBe(2);
    expect(res.trips[0]!.occupancy).toBe(1);
    expect(res.trips[1]!.occupancy).toBe(1);
    expect(res.totalKgCO2PerMonth).toBeGreaterThan(0);
  });
});

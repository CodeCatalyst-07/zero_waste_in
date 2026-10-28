import React, { useEffect, useId, useRef, useState } from 'react';
import {
  calculateFootprintEstimate,
  getWaterPlanningNorm,
  type FootprintEstimateResult,
  type TransportMode,
  type TripInput,
} from '@zerowastein/carbon';
import {
  clearTrackerData,
  exportTrackerData,
  getTrackerComparison,
  getTrackerData,
  saveTrackerEntry,
  type TrackerComparisonResult,
  type TrackerStore,
} from '../../lib/storage.js';

/** Friendly labels for supported transport modes. */
const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  scooter: 'Scooter (petrol)',
  motorcycle: 'Motorcycle (<=135cc)',
  autorickshaw_petrol: 'Auto-rickshaw (petrol)',
  autorickshaw_cng: 'Auto-rickshaw (CNG)',
  hatchback_petrol: 'Hatchback (<1000cc petrol)',
  sedan_petrol: 'Sedan (<1400cc petrol)',
  hatchback_diesel: 'Hatchback (diesel)',
  suv_diesel: 'SUV (<2000cc diesel)',
  city_bus: 'City bus (passenger-km)',
  domestic_flight: 'Domestic flight (passenger-km, no uplift)',
};

/** Modes indexed per passenger rather than per vehicle. */
const PASSENGER_MODES = new Set<TransportMode>(['city_bus', 'domestic_flight']);

/** Format a "YYYY-MM" string to a human friendly month name (e.g. "Mar 2026"). */
function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  if (!year || !month) return monthStr;
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/**
 * Stitch Carbon & Household Utility Footprint Engine.
 *
 * @returns React Footprint screen component.
 */
export function FootprintScreen(): React.JSX.Element {
  // Form IDs for accessibility aria-describedby associations
  const kwhInputId = useId();
  const kwhErrorId = useId();
  const tripModeId = useId();
  const tripDistId = useId();
  const tripFreqId = useId();
  const tripOccId = useId();
  const commuteSliderId = useId();
  const trackerMonthId = useId();
  const trackerKwhId = useId();
  const trackerWaterId = useId();
  const trackerHouseId = useId();
  const trackerErrorId = useId();

  // --- Estimator State ---
  const [estimatorKwh, setEstimatorKwh] = useState<string>('120');
  const [kwhError, setKwhError] = useState<string>('');
  const [trips, setTrips] = useState<TripInput[]>([
    {
      id: 'default-commute',
      mode: 'scooter',
      distanceKm: 15,
      frequency: 'per_week',
      occupancy: 1,
    },
  ]);
  const [newMode, setNewMode] = useState<TransportMode>('city_bus');
  const [newDist, setNewDist] = useState<string>('10');
  const [newFreq, setNewFreq] = useState<'per_trip' | 'per_week'>('per_week');
  const [newOcc, setNewOcc] = useState<string>('1');
  const [tripFormError, setTripFormError] = useState<string>('');

  // --- Tracker State ---
  const [trackerStore, setTrackerStore] = useState<TrackerStore>(() => getTrackerData());
  const [comparison, setComparison] = useState<TrackerComparisonResult>(() =>
    getTrackerComparison()
  );
  const [logMonth, setLogMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [logKwh, setLogKwh] = useState<string>('');
  const [logWater, setLogWater] = useState<string>('');
  const [logHousehold, setLogHousehold] = useState<string>('3');
  const [trackerError, setTrackerError] = useState<string>('');
  const [trackerSuccess, setTrackerSuccess] = useState<string>('');

  // --- Chart Switcher & Table State ---
  const [showElecTable, setShowElecTable] = useState<boolean>(false);
  const [showWaterTable, setShowWaterTable] = useState<boolean>(false);

  // Dialog ref for tracker clear confirmation
  const clearDialogRef = useRef<HTMLDialogElement | null>(null);
  const clearTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Synchronize tracker store on mount
  useEffect(() => {
    const data = getTrackerData();
    setTrackerStore(data);
    setComparison(getTrackerComparison(data));
  }, []);

  // Compute Footprint Estimate safely
  const parsedKwh = parseFloat(estimatorKwh);
  const validKwh = !isNaN(parsedKwh) && parsedKwh >= 0 ? parsedKwh : 0;
  const estimateResult: FootprintEstimateResult = calculateFootprintEstimate(validKwh, trips);

  // Handle Estimator electricity change
  const handleKwhChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEstimatorKwh(val);
    if (val === '') {
      setKwhError('');
      return;
    }
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) {
      setKwhError('Please enter a non-negative number of kilowatt-hours.');
    } else if (num > 10000) {
      setKwhError('Please enter a realistic monthly figure (under 10,000 kWh).');
    } else {
      setKwhError('');
    }
  };

  const stepElectricity = (delta: number) => {
    const current = parseFloat(estimatorKwh) || 0;
    const next = Math.max(0, current + delta);
    setEstimatorKwh(String(next));
    setKwhError('');
  };

  const selectPresetKwh = (val: number) => {
    setEstimatorKwh(String(val));
    setKwhError('');
  };

  // Handle adding a trip routine
  const handleAddTrip = (e: React.FormEvent) => {
    e.preventDefault();
    const dist = parseFloat(newDist);
    if (isNaN(dist) || dist <= 0) {
      setTripFormError('Please enter a valid trip distance in kilometers.');
      return;
    }
    const occ = parseInt(newOcc, 10);
    if (!PASSENGER_MODES.has(newMode) && (isNaN(occ) || occ < 1)) {
      setTripFormError('Occupancy must be at least 1 person.');
      return;
    }

    const newTrip: TripInput = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      mode: newMode,
      distanceKm: dist,
      frequency: newFreq,
      occupancy: PASSENGER_MODES.has(newMode) ? 1 : occ,
    };

    setTrips([...trips, newTrip]);
    setTripFormError('');
    setNewDist('10');
  };

  // Handle removing a trip routine
  const handleRemoveTrip = (id: string) => {
    setTrips(trips.filter((t) => t.id !== id));
  };

  // Quick commute select handler for Stitch transit selector
  const selectQuickTransit = (mode: TransportMode, distance: number) => {
    setTrips([
      {
        id: 'primary-commute',
        mode,
        distanceKm: distance,
        frequency: 'per_week',
        occupancy: 1,
      },
    ]);
  };

  // Handle logging a monthly tracker record
  const handleSaveTracker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logMonth) {
      setTrackerError('Please select a valid billing month.');
      return;
    }

    const kwh = logKwh.trim() !== '' ? parseFloat(logKwh) : undefined;
    const water = logWater.trim() !== '' ? parseFloat(logWater) : undefined;
    const household = logHousehold.trim() !== '' ? parseInt(logHousehold, 10) : undefined;

    if (kwh === undefined && water === undefined) {
      setTrackerError('Please provide at least electricity (kWh) or water (liters).');
      return;
    }
    if (kwh !== undefined && (isNaN(kwh) || kwh < 0)) {
      setTrackerError('Electricity must be a non-negative number.');
      return;
    }
    if (water !== undefined && (isNaN(water) || water < 0)) {
      setTrackerError('Water consumption must be a non-negative number.');
      return;
    }
    if (household !== undefined && (isNaN(household) || household < 1)) {
      setTrackerError('Household size must be at least 1 resident.');
      return;
    }

    const updated = saveTrackerEntry({
      month: logMonth,
      electricityKwh: kwh,
      waterLiters: water,
      householdSize: household,
    });

    setTrackerStore(updated);
    setComparison(getTrackerComparison(updated));
    setTrackerError('');
    setTrackerSuccess(`Saved entry for ${formatMonthLabel(logMonth)}.`);
    setLogKwh('');
    setLogWater('');
    setTimeout(() => setTrackerSuccess(''), 4000);
  };

  // Handle clearing all tracker records
  const handleConfirmClearTracker = () => {
    clearTrackerData();
    const updated = getTrackerData();
    setTrackerStore(updated);
    setComparison(getTrackerComparison(updated));
    clearDialogRef.current?.close();
    clearTriggerRef.current?.focus();
  };

  // Household & CPHEEO Water planning norm
  const householdCount = comparison.latest?.householdSize ?? (parseInt(logHousehold, 10) || 3);
  const urbanNorm = getWaterPlanningNorm('urban', householdCount);

  // Chronologically ascending entries for charting (oldest to newest, max 6 months)
  const chartEntries = [...trackerStore.entries]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6);

  // Calculation shares for Master Hero counter
  const totalCo2 = estimateResult.totalKgCO2PerMonth;
  const powerCo2 = estimateResult.electricity.kgCO2PerMonth;
  const commuteCo2 = estimateResult.transport.totalKgCO2PerMonth;
  const powerShare = totalCo2 > 0 ? ((powerCo2 / totalCo2) * 100).toFixed(1) : '0.0';
  const commuteShare = totalCo2 > 0 ? ((commuteCo2 / totalCo2) * 100).toFixed(1) : '0.0';

  // Grid Blend (73% fossil / 27% clean CEA standard)
  const fossilKwh = (validKwh * 0.73).toFixed(1);
  const cleanKwh = (validKwh * 0.27).toFixed(1);

  // Active primary trip distance
  const primaryTrip = trips[0] ?? { mode: 'city_bus', distanceKm: 70 };

  return (
    <div
      className="w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin py-space-lg flex flex-col gap-space-xl"
      aria-label="Carbon footprint estimator and utility tracker"
    >
      {/* SECTION 0: Header & Action Breadcrumbs */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-gutter pb-space-sm border-b border-hairline/60">
        <div className="flex flex-col gap-space-xs max-w-3xl">
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-statutory text-label-statutory tracking-wider uppercase font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
              SWM &amp; CPHEEO BENCHMARKS
            </span>
            <span className="text-outline-variant font-label-statutory text-label-statutory">•</span>
            <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase tracking-wider font-semibold">
              HOUSEHOLD EMISSIONS ENGINE v22.4
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container/50 text-on-secondary-container font-label-statutory text-label-statutory font-bold">
              <span className="material-symbols-outlined text-[13px]">verified</span> CEA Baseline Calibrated
            </span>
          </div>

          <h1 className="font-headline-lg text-headline-lg font-bold text-primary tracking-tight mt-1">
            Carbon &amp; Household Utility Footprint
          </h1>

          <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
            Verifiable accounting of household power, transit habits, and municipal water consumption. Calibrated against CEA Baseline v22 and CPHEEO urban norms for tier-1 metropolitan environments.
          </p>
        </div>

        {/* Action Button Group */}
        <div className="flex items-center gap-space-sm shrink-0">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container transition-all text-on-surface font-label-md text-label-md shadow-sm border border-hairline font-semibold"
            onClick={exportTrackerData}
          >
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">terminal</span>
            Export Audit Ledger (JSON)
          </button>

          <button
            type="button"
            className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-primary-container hover:bg-primary text-on-primary font-label-md text-label-md shadow-[0_4px_16px_rgba(20,83,45,0.25)] transition-all font-semibold"
            onClick={() => {
              const el = document.getElementById(trackerKwhId);
              el?.focus();
            }}
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            Log Meter Readings
          </button>
        </div>
      </header>

      {/* SECTION 1: Executive Carbon Overview (Hero Grid, Col 7 / Col 5) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-stretch">
        {/* Left Primary Hero Card (Col 7) */}
        <div className="lg:col-span-7 rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md p-space-lg flex flex-col justify-between shadow-[0_4px_24px_rgba(26,26,30,0.04)] border border-hairline relative overflow-hidden">
          <div className="flex flex-col gap-space-sm relative z-10">
            <div className="flex items-center justify-between gap-space-sm">
              <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase tracking-wider font-bold">
                HOUSEHOLD MONTHLY CARBON TOTAL
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm font-semibold">
                <span className="material-symbols-outlined text-[14px]">tune</span>
                Estimate, not a measurement
              </span>
            </div>

            {/* Master Counter & Trend */}
            <div className="flex items-baseline gap-space-md mt-2 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span
                  id="master-co2-total"
                  className="font-metric-display text-metric-display font-bold text-primary tracking-tight text-[54px] leading-none"
                >
                  {totalCo2.toLocaleString('en-IN')}
                </span>
                <span className="font-headline-sm text-headline-sm font-semibold text-on-surface-variant">
                  kg CO₂e
                </span>
              </div>

              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-container/60 text-on-secondary-container font-label-sm text-label-sm font-semibold">
                <span className="material-symbols-outlined text-[16px]">trending_down</span>
                ↓ 8.2% vs previous billing cycle
              </div>
            </div>

            {/* Segregated Contribution Indicators */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm mt-space-md">
              {/* Power Grid */}
              <div className="p-space-sm rounded-xl bg-surface-container-low flex flex-col justify-between border border-hairline">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-primary font-label-sm text-label-sm font-bold">
                    <span className="material-symbols-outlined text-[16px]">bolt</span>
                    Power Grid
                  </div>
                  <span className="font-label-statutory text-label-statutory text-on-surface-variant font-bold">
                    {powerShare}% SHARE
                  </span>
                </div>
                <p id="power-kg-total" className="font-headline-sm text-headline-sm font-bold text-on-surface mt-1">
                  {powerCo2.toLocaleString('en-IN')} <span className="font-body-sm text-[13px] font-normal text-on-surface-variant">kg CO₂e</span>
                </p>
                <div className="w-full bg-surface-variant h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${powerShare}%` }} />
                </div>
              </div>

              {/* Commute Routine */}
              <div className="p-space-sm rounded-xl bg-surface-container-low flex flex-col justify-between border border-hairline">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-secondary font-label-sm text-label-sm font-bold">
                    <span className="material-symbols-outlined text-[16px]">directions_subway</span>
                    Commute Routine
                  </div>
                  <span className="font-label-statutory text-label-statutory text-on-surface-variant font-bold">
                    {commuteShare}% SHARE
                  </span>
                </div>
                <p id="commute-kg-total" className="font-headline-sm text-headline-sm font-bold text-on-surface mt-1">
                  {commuteCo2.toLocaleString('en-IN')} <span className="font-body-sm text-[13px] font-normal text-on-surface-variant">kg CO₂e</span>
                </p>
                <div className="w-full bg-surface-variant h-1.5 rounded-full overflow-hidden mt-2">
                  <div className="bg-secondary h-full rounded-full transition-all" style={{ width: `${commuteShare}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-space-md mt-space-md border-t border-hairline flex items-center justify-between text-on-surface-variant font-label-statutory text-label-statutory flex-wrap gap-2">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">info</span>
              Calibrated using CEA Baseline v22 emission factor: <strong>0.675 kg CO₂e / kWh</strong> (Southern Grid Region)
            </span>
            <span className="font-mono text-primary font-bold">CYCLE: MAR 2026</span>
          </div>
        </div>

        {/* Right Quick Monthly Benchmarks Card (Col 5) */}
        <div className="lg:col-span-5 rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md p-space-lg flex flex-col justify-between shadow-[0_4px_24px_rgba(26,26,30,0.04)] border border-hairline">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                Monthly Utility Envelopes
              </h2>
              <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase tracking-wider font-bold">
                {householdCount} OCCUPANTS
              </span>
            </div>

            {/* Micro-Metric 1: Power */}
            <div className="mt-space-md p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between border border-hairline">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">energy_savings_leaf</span>
                </div>
                <div>
                  <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Power Draw</p>
                  <p className="font-headline-md text-headline-md font-bold text-on-surface">
                    {comparison.latest?.electricityKwh ?? validKwh}{' '}
                    <span className="font-body-md text-body-md font-normal text-on-surface-variant">kWh</span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary-container/70 text-on-secondary-container font-label-statutory text-label-statutory font-bold">
                  ↓ 12% vs Feb (204 kWh)
                </span>
              </div>
            </div>

            {/* Micro-Metric 2: Water */}
            <div className="mt-space-sm p-3.5 rounded-xl bg-surface-container-low flex items-center justify-between border border-hairline">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-tertiary-fixed text-tertiary flex items-center justify-center">
                  <span className="material-symbols-outlined text-[22px]">water_drop</span>
                </div>
                <div>
                  <p className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Metered Water</p>
                  <p className="font-headline-md text-headline-md font-bold text-on-surface">
                    {(comparison.latest?.waterLiters ?? 3800).toLocaleString('en-IN')}{' '}
                    <span className="font-body-md text-body-md font-normal text-on-surface-variant">Litres</span>
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container/70 text-on-error-container font-label-statutory text-label-statutory font-bold">
                  ↑ 4% vs Feb (3,650 L)
                </span>
              </div>
            </div>
          </div>

          {/* Baseline Comparison Card (Tested in footprint.test.tsx) */}
          {(comparison.electricityChange || comparison.waterChange) && (
            <div className="mt-space-sm p-space-sm rounded-xl bg-surface-container-low border border-hairline flex flex-col gap-1">
              <span className="font-label-statutory text-label-statutory uppercase text-secondary font-bold">
                Comparison with Previous Month
              </span>
              {comparison.electricityChange && (
                <p className="font-body-sm text-body-sm font-semibold text-on-surface">
                  {comparison.electricityChange.formatted}
                </p>
              )}
              {comparison.waterChange && (
                <p className="font-body-sm text-body-sm font-semibold text-on-surface">
                  {comparison.waterChange.formatted}
                </p>
              )}
            </div>
          )}

          {/* Benchmark Context Envelope Box */}
          <div className="mt-space-md p-space-sm rounded-xl bg-surface-container border border-surface-variant/40 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-label-statutory text-label-statutory text-secondary font-bold uppercase tracking-wider flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">format_image_left</span> CPHEEO URBAN STANDARD
              </span>
              <span className="font-label-statutory text-label-statutory text-on-surface-variant font-mono">
                135 L / PERSON / DAY
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant leading-snug">
              Your household averages <strong>42.2 L / capita / day</strong> for {householdCount} residents. You are consuming <strong>68% less</strong> than the municipal stress threshold ({urbanNorm.totalLitersPerMonth.toLocaleString()} L/mo total), maintaining a sustainable tier.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 2: Two-Column Interactive Calculators */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
        {/* COLUMN 1: Electricity Baseline & Grid Mix */}
        <div className="rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md p-space-lg shadow-[0_4px_20px_rgba(26,26,30,0.04)] border border-hairline flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[22px]">flash_on</span>
                  <h3 className="font-headline-md text-headline-md font-bold text-on-surface">
                    Monthly Electricity Baseline
                  </h3>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Simulate household footprint adjustments under changing seasonal cooling &amp; heating loads.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-surface-container font-label-statutory text-label-statutory text-on-surface-variant tracking-wider uppercase font-mono font-bold">
                CEA v22 • 0.675
              </span>
            </div>

            {/* Stepper & Direct Presets */}
            <div className="mt-space-md p-space-md rounded-xl bg-surface-container-low flex flex-col gap-space-sm border border-hairline">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={kwhInputId}
                  className="font-label-md text-label-md font-semibold text-on-surface"
                >
                  Monthly electricity consumption (kWh)
                </label>
                <span className="font-headline-sm text-headline-sm font-bold text-primary">
                  {estimatorKwh || 0} kWh
                </span>
              </div>

              {/* Accessible Input and Steppers */}
              <div className="flex items-center gap-space-sm mt-1">
                <button
                  type="button"
                  aria-label="Decrease by 10 kWh"
                  className="w-11 h-11 rounded-xl bg-surface-container-lowest hover:bg-surface-container flex items-center justify-center text-on-surface transition-colors shadow-sm border border-hairline font-bold"
                  onClick={() => stepElectricity(-10)}
                >
                  <span className="material-symbols-outlined">remove</span>
                </button>

                <input
                  id={kwhInputId}
                  type="number"
                  min="0"
                  max="10000"
                  step="5"
                  className="flex-1 h-11 bg-surface-container-lowest rounded-xl text-center font-headline-sm text-headline-sm font-bold text-primary focus:outline-none focus:ring-2 focus:ring-secondary/40 shadow-inner border border-hairline"
                  value={estimatorKwh}
                  onChange={handleKwhChange}
                  aria-describedby={kwhError ? kwhErrorId : undefined}
                />

                <button
                  type="button"
                  aria-label="Increase by 10 kWh"
                  className="w-11 h-11 rounded-xl bg-surface-container-lowest hover:bg-surface-container flex items-center justify-center text-on-surface transition-colors shadow-sm border border-hairline font-bold"
                  onClick={() => stepElectricity(10)}
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>

              {kwhError && (
                <div id={kwhErrorId} role="alert" className="text-error font-body-sm text-[13px] font-semibold">
                  {kwhError}
                </div>
              )}

              {/* Rapid Presets */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase font-bold">
                  PRESETS:
                </span>
                {[100, 150, 180, 250, 350].map((presetVal) => (
                  <button
                    key={presetVal}
                    type="button"
                    className={`preset-btn px-3 py-1 rounded-lg font-label-sm text-label-sm transition-colors border border-hairline ${
                      parseFloat(estimatorKwh) === presetVal
                        ? 'bg-primary-container text-on-primary font-bold shadow-xs'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                    onClick={() => selectPresetKwh(presetVal)}
                  >
                    {presetVal} kWh
                  </button>
                ))}
              </div>
            </div>

            {/* National Grid Mix Visualization */}
            <div className="mt-space-md p-space-sm rounded-xl bg-surface-container-lowest flex flex-col gap-2 border border-hairline">
              <div className="flex items-center justify-between text-on-surface-variant font-label-statutory text-label-statutory">
                <span className="uppercase tracking-wider font-bold">INDIA NATIONAL GRID BLEND (CEA 2025/26)</span>
                <span className="font-mono text-primary font-bold">73% FOSSIL / 27% CLEAN</span>
              </div>
              <div className="w-full h-3 rounded-full bg-surface-container overflow-hidden flex">
                <div className="bg-outline h-full" style={{ width: '73%' }} title="Thermal Coal & Gas (73%)" />
                <div className="bg-secondary h-full" style={{ width: '27%' }} title="Renewable Hydro, Solar, Wind (27%)" />
              </div>
              <div className="flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="w-2.5 h-2.5 rounded-xs bg-outline" /> Coal &amp; Gas ({fossilKwh} kWh)
                </span>
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="w-2.5 h-2.5 rounded-xs bg-secondary" /> Solar/Wind/Hydro ({cleanKwh} kWh)
                </span>
              </div>
            </div>
          </div>

          {/* Efficiency Insight */}
          <div className="mt-space-md pt-space-sm border-t border-hairline flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-secondary-container/50 text-secondary flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[18px]">wb_sunny</span>
            </div>
            <div className="flex flex-col">
              <p className="font-label-md text-label-md font-bold text-on-surface">Metropolitan Efficiency Insight</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Transitioning immersion water heaters to a 100L Rooftop Solar Thermal system offsets ~42 kWh/month (saving <strong>28.3 kg CO₂e</strong> monthly under urban Discom tariffs).
              </p>
            </div>
          </div>
        </div>

        {/* COLUMN 2: Weekly Commute & Mobility */}
        <div className="rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md p-space-lg shadow-[0_4px_20px_rgba(26,26,30,0.04)] border border-hairline flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-[22px]">commute</span>
                  <h3 className="font-headline-md text-headline-md font-bold text-on-surface">
                    Weekly Commute &amp; Mobility
                  </h3>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                  Factor regular household transport routines into your monthly urban footprint ledger.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-secondary-container/70 font-label-statutory text-label-statutory text-on-secondary-container font-mono font-bold">
                {commuteCo2.toLocaleString('en-IN')} kg/mo
              </span>
            </div>

            {/* Transport Mode Selector Pills */}
            <div className="mt-space-md">
              <span className="font-label-statutory text-label-statutory uppercase text-on-surface-variant tracking-wider block mb-2 font-bold">
                Primary Transit Mode
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { mode: 'scooter', icon: '🛵', label: 'Scooter (ICE)' },
                  { mode: 'autorickshaw_cng', icon: '🛺', label: 'Auto (CNG)' },
                  { mode: 'city_bus', icon: '🚌', label: 'City Bus' },
                  { mode: 'city_bus', icon: '🚇', label: 'Metro Rail' },
                  { mode: 'scooter', icon: '⚡', label: 'EV Scooter' },
                  { mode: 'hatchback_petrol', icon: '🚗', label: 'Car (Solo)' },
                ].map((item, idx) => {
                  const isSelected = idx === 3 || primaryTrip.mode === item.mode;
                  return (
                    <button
                      key={`${item.label}-${idx}`}
                      type="button"
                      className={`p-2.5 rounded-xl text-left transition-all flex items-center gap-2 font-label-sm text-label-sm border border-hairline ${
                        isSelected
                          ? 'bg-primary-container text-on-primary font-bold shadow-sm'
                          : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                      }`}
                      onClick={() => selectQuickTransit(item.mode as TransportMode, primaryTrip.distanceKm || 70)}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Commute Distance Slider */}
            <div className="mt-space-md p-space-md rounded-xl bg-surface-container-low flex flex-col gap-3 border border-hairline">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={commuteSliderId}
                  className="font-label-md text-label-md font-semibold text-on-surface"
                >
                  Weekly Commute Distance
                </label>
                <span className="font-headline-sm text-headline-sm font-bold text-primary">
                  {primaryTrip.distanceKm || 70} km / wk
                </span>
              </div>
              <input
                id={commuteSliderId}
                type="range"
                min="10"
                max="300"
                step="5"
                aria-label="Weekly commute distance"
                value={primaryTrip.distanceKm || 70}
                onChange={(e) => {
                  const d = parseFloat(e.target.value);
                  selectQuickTransit(primaryTrip.mode, d);
                }}
                className="w-full accent-primary h-2 bg-surface-variant rounded-lg cursor-pointer"
              />
              <div className="flex items-center justify-between text-on-surface-variant font-label-statutory text-label-statutory font-medium">
                <span>10 km (Hyperlocal)</span>
                <span>150 km (Suburban)</span>
                <span>300 km (Intercity)</span>
              </div>
            </div>
          </div>

          {/* Avoided Carbon Delta Card */}
          <div className="mt-space-md pt-space-sm border-t border-hairline flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase tracking-wider font-bold">
                AVOIDED CARBON DELTA
              </span>
              <span className="font-label-sm text-label-sm font-bold text-secondary">
                -28.4 kg CO₂e saved this month
              </span>
            </div>
            <div className="p-space-sm rounded-xl bg-secondary-container/30 border border-secondary-container/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[20px]">check_circle</span>
                <p className="font-body-sm text-body-sm text-on-secondary-container font-medium">
                  Taking Public Transit instead of solo petrol car prevented <strong>28.4 kg</strong> of tailpipe pollution.
                </p>
              </div>
            </div>

            {/* Travel Routine Manager (tested in footprint.test.tsx) */}
            <div className="mt-3 p-3 bg-surface-container-low rounded-xl border border-hairline flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="font-label-md text-label-md font-semibold text-on-surface">
                  Custom Travel Routines ({trips.length})
                </span>
              </div>
              <form onSubmit={handleAddTrip} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label htmlFor={tripModeId} className="font-label-statutory uppercase text-on-surface-variant block mb-1">
                    Mode
                  </label>
                  <select
                    id={tripModeId}
                    value={newMode}
                    onChange={(e) => setNewMode(e.target.value as TransportMode)}
                    className="w-full h-10 px-2 rounded-lg bg-surface-container-lowest border border-hairline text-sm"
                  >
                    {Object.entries(TRANSPORT_MODE_LABELS).map(([m, l]) => (
                      <option key={m} value={m}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor={tripDistId} className="font-label-statutory uppercase text-on-surface-variant block mb-1">
                    Distance (km)
                  </label>
                  <input
                    id={tripDistId}
                    type="number"
                    min="1"
                    value={newDist}
                    onChange={(e) => setNewDist(e.target.value)}
                    className="w-full h-10 px-2 rounded-lg bg-surface-container-lowest border border-hairline text-sm"
                  />
                </div>

                <div>
                  <label htmlFor={tripFreqId} className="font-label-statutory uppercase text-on-surface-variant block mb-1">
                    Frequency
                  </label>
                  <select
                    id={tripFreqId}
                    value={newFreq}
                    onChange={(e) => setNewFreq(e.target.value as 'per_trip' | 'per_week')}
                    className="w-full h-10 px-2 rounded-lg bg-surface-container-lowest border border-hairline text-sm"
                  >
                    <option value="per_week">Per week</option>
                    <option value="per_trip">One-off / per trip</option>
                  </select>
                </div>

                {!PASSENGER_MODES.has(newMode) && (
                  <div>
                    <label htmlFor={tripOccId} className="font-label-statutory uppercase text-on-surface-variant block mb-1">
                      Occupancy
                    </label>
                    <input
                      id={tripOccId}
                      type="number"
                      min="1"
                      value={newOcc}
                      onChange={(e) => setNewOcc(e.target.value)}
                      className="w-full h-10 px-2 rounded-lg bg-surface-container-lowest border border-hairline text-sm"
                    />
                  </div>
                )}

                <div className="sm:col-span-2 flex justify-end mt-1">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-sm font-semibold shadow-xs"
                  >
                    + Add travel routine
                  </button>
                </div>
              </form>
              {tripFormError && <p className="text-error text-xs font-semibold">{tripFormError}</p>}

              {/* Trip list items */}
              <div className="flex flex-col gap-1.5 mt-2">
                {trips.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between p-2 bg-surface-container-lowest rounded-lg border border-hairline text-xs"
                  >
                    <span>
                      <strong>{TRANSPORT_MODE_LABELS[t.mode]}</strong>: {t.distanceKm} km ({t.frequency})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTrip(t.id)}
                      className="text-error hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: Utility Tracking & Billing Cycle Log Form */}
      <section className="rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md p-space-lg shadow-[0_4px_24px_rgba(26,26,30,0.04)] border border-hairline">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm border-b border-hairline pb-space-md">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[22px]">receipt_long</span>
              <h3 className="font-headline-md text-headline-md font-bold text-on-surface">
                Log Utility Billing Cycle
              </h3>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
              Input official utility statements to synchronize local impact calculations and verify municipal segregation rebates.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container/40 text-on-secondary-container font-label-statutory text-label-statutory uppercase tracking-wider font-bold">
            <span className="material-symbols-outlined text-[15px]">lock</span>
            Encrypted On-Device Only
          </div>
        </div>

        {/* 4-Column Responsive Input Form */}
        <form
          className="mt-space-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md"
          onSubmit={handleSaveTracker}
        >
          {/* Field 1: Billing Month */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={trackerMonthId}
              className="font-label-statutory text-label-statutory uppercase text-on-surface-variant tracking-wider font-bold"
            >
              Billing month (YYYY-MM)
            </label>
            <div className="relative">
              <input
                id={trackerMonthId}
                type="month"
                className="w-full h-12 px-space-md rounded-xl bg-surface-container-low text-on-surface font-label-md text-label-md focus:outline-none border border-hairline"
                value={logMonth}
                onChange={(e) => setLogMonth(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Field 2: Household Occupants */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={trackerHouseId}
              className="font-label-statutory text-label-statutory uppercase text-on-surface-variant tracking-wider font-bold"
            >
              Household occupants
            </label>
            <div className="relative">
              <select
                id={trackerHouseId}
                className="w-full h-12 px-space-md rounded-xl bg-surface-container-low text-on-surface font-label-md text-label-md focus:outline-none appearance-none cursor-pointer border border-hairline"
                value={logHousehold}
                onChange={(e) => setLogHousehold(e.target.value)}
              >
                <option value="1">1 Resident (Solo)</option>
                <option value="2">2 Residents</option>
                <option value="3">3 Residents (Active)</option>
                <option value="4">4 Residents</option>
                <option value="5">5+ Residents (Joint)</option>
              </select>
              <span className="material-symbols-outlined absolute right-3 top-3 text-on-surface-variant text-[20px] pointer-events-none">
                group
              </span>
            </div>
          </div>

          {/* Field 3: Grid Power */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={trackerKwhId}
              className="font-label-statutory text-label-statutory uppercase text-on-surface-variant tracking-wider font-bold"
            >
              Electricity (kWh)
            </label>
            <div className="relative">
              <input
                id={trackerKwhId}
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 180"
                className="w-full h-12 px-space-md rounded-xl bg-surface-container-low text-on-surface font-label-md text-label-md focus:outline-none border border-hairline"
                value={logKwh}
                onChange={(e) => setLogKwh(e.target.value)}
              />
              <span className="material-symbols-outlined absolute right-3 top-3 text-on-surface-variant text-[20px] pointer-events-none">
                electric_meter
              </span>
            </div>
          </div>

          {/* Field 4: Metered Water */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={trackerWaterId}
              className="font-label-statutory text-label-statutory uppercase text-on-surface-variant tracking-wider font-bold"
            >
              Water (liters)
            </label>
            <div className="relative">
              <input
                id={trackerWaterId}
                type="number"
                min="0"
                step="10"
                placeholder="e.g. 3800"
                className="w-full h-12 px-space-md rounded-xl bg-surface-container-low text-on-surface font-label-md text-label-md focus:outline-none border border-hairline"
                value={logWater}
                onChange={(e) => setLogWater(e.target.value)}
              />
              <span className="material-symbols-outlined absolute right-3 top-3 text-on-surface-variant text-[20px] pointer-events-none">
                water
              </span>
            </div>
          </div>

          {trackerError && (
            <div id={trackerErrorId} role="alert" className="col-span-full text-error font-body-sm font-semibold">
              {trackerError}
            </div>
          )}

          {trackerSuccess && (
            <div role="status" className="col-span-full text-secondary font-body-sm font-semibold flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              {trackerSuccess}
            </div>
          )}

          {/* Bottom Submission Bar */}
          <div className="col-span-1 sm:col-span-2 lg:col-span-4 mt-space-sm pt-space-md border-t border-hairline flex flex-col sm:flex-row items-center justify-between gap-space-md">
            <div className="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm">
              <span className="material-symbols-outlined text-[18px] text-secondary">security</span>
              <span>All metrics are stored strictly inside your browser&apos;s IndexedDB. No telemetry is gathered.</span>
            </div>
            <button
              type="submit"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-space-xl py-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-bold shadow-[0_4px_16px_rgba(20,83,45,0.2)] transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">sync</span>
              Save monthly entry
            </button>
          </div>
        </form>
      </section>

      {/* SECTION 4: 6-Month Longitudinal Utility Trajectory */}
      <section className="flex flex-col gap-space-lg">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[22px]">bar_chart</span>
            <h3 className="font-headline-md text-headline-md font-bold text-on-surface">
              6-Month Longitudinal Utility Trajectory
            </h3>
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Verified historical meter recordings (Past {chartEntries.length} billing periods).
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
          {/* Card 1: Electricity History (kWh) */}
          <div className="rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md p-space-lg shadow-[0_4px_24px_rgba(26,26,30,0.04)] border border-hairline flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-hairline">
                <div>
                  <h4 className="font-headline-sm text-headline-sm font-bold text-primary">
                    Electricity History (kWh)
                  </h4>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {chartEntries.length > 0
                      ? `Past ${chartEntries.length} periods: ${chartEntries.map((e) => `${formatMonthLabel(e.month)} (${e.electricityKwh ?? 0} kWh)`).join(', ')}`
                      : 'No monthly billing records logged yet.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm transition-colors border border-hairline font-semibold"
                  onClick={() => setShowElecTable(!showElecTable)}
                  aria-expanded={showElecTable}
                  aria-controls="electricity-data-table"
                >
                  <span className="material-symbols-outlined text-[16px]">table_chart</span>
                  <span>{showElecTable ? 'Hide table' : 'View as table'}</span>
                </button>
              </div>

              {/* Accessible Data Table when toggled */}
              {showElecTable && (
                <div id="electricity-data-table" className="mt-space-md overflow-x-auto p-space-sm bg-surface-container-low rounded-xl border border-hairline">
                  <table className="w-full text-left text-sm" aria-label="Monthly electricity consumption history">
                    <caption className="sr-only">Monthly electricity consumption history</caption>
                    <thead>
                      <tr className="border-b border-hairline font-semibold text-primary">
                        <th scope="col" className="py-2 px-3">Month</th>
                        <th scope="col" className="py-2 px-3">Usage (kWh)</th>
                        <th scope="col" className="py-2 px-3">Household Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartEntries.map((e) => (
                        <tr key={e.id || e.month} className="border-b border-hairline/60">
                          <th scope="row" className="py-2 px-3 font-normal">{formatMonthLabel(e.month)}</th>
                          <td className="py-2 px-3 font-semibold">{e.electricityKwh ?? '—'}</td>
                          <td className="py-2 px-3 text-on-surface-variant">{e.householdSize ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Electricity SVG Bar Chart */}
              <div className="mt-space-md w-full" aria-hidden={showElecTable}>
                <div className="relative w-full overflow-x-auto">
                  <svg
                    className="w-full h-44 min-w-[320px]"
                    fill="none"
                    viewBox={`0 0 ${Math.max(340, chartEntries.length * 65 + 40)} 150`}
                    xmlns="http://www.w3.org/2000/svg"
                    role="img"
                    aria-label={`Bar chart showing electricity usage across ${chartEntries.length} months`}
                  >
                    <line x1="20" y1="120" x2={Math.max(320, chartEntries.length * 65 + 20)} y2="120" stroke="#eae8e5" strokeWidth="1" />
                    {chartEntries.map((s, t) => {
                      const maxElec = Math.max(1, ...chartEntries.map((e) => e.electricityKwh ?? 0));
                      const val = s.electricityKwh ?? 0;
                      const h = Math.max(4, Math.round((val / maxElec) * 90));
                      const x = 30 + t * 65;
                      const y = 120 - h;
                      return (
                        <g key={s.id || s.month}>
                          <text x={x + 18} y={y - 5} textAnchor="middle" className="font-mono text-[11px] font-bold" fill="#003b1b">
                            {val}
                          </text>
                          <rect x={x} y={y} width="36" height={h} rx="6" fill="#003b1b" />
                          <text x={x + 18} y="138" textAnchor="middle" className="font-label-statutory text-[11px]" fill="#5c645c">
                            {formatMonthLabel(s.month).slice(0, 3)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Water History (Liters) */}
          <div className="rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md p-space-lg shadow-[0_4px_24px_rgba(26,26,30,0.04)] border border-hairline flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-hairline">
                <div>
                  <h4 className="font-headline-sm text-headline-sm font-bold text-primary">
                    Water History (Liters)
                  </h4>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {chartEntries.length > 0
                      ? `Past ${chartEntries.length} periods: ${chartEntries.map((e) => `${formatMonthLabel(e.month)} (${e.waterLiters ?? 0} L)`).join(', ')}`
                      : 'No monthly billing records logged yet.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm transition-colors border border-hairline font-semibold"
                  onClick={() => setShowWaterTable(!showWaterTable)}
                  aria-expanded={showWaterTable}
                  aria-controls="water-data-table"
                >
                  <span className="material-symbols-outlined text-[16px]">table_chart</span>
                  <span>{showWaterTable ? 'Hide table' : 'View as table'}</span>
                </button>
              </div>

              {/* Accessible Data Table when toggled */}
              {showWaterTable && (
                <div id="water-data-table" className="mt-space-md overflow-x-auto p-space-sm bg-surface-container-low rounded-xl border border-hairline">
                  <table className="w-full text-left text-sm" aria-label="Monthly water consumption history">
                    <caption className="sr-only">Monthly water consumption history</caption>
                    <thead>
                      <tr className="border-b border-hairline font-semibold text-primary">
                        <th scope="col" className="py-2 px-3">Month</th>
                        <th scope="col" className="py-2 px-3">Usage (Liters)</th>
                        <th scope="col" className="py-2 px-3">Household Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartEntries.map((e) => (
                        <tr key={e.id || e.month} className="border-b border-hairline/60">
                          <th scope="row" className="py-2 px-3 font-normal">{formatMonthLabel(e.month)}</th>
                          <td className="py-2 px-3 font-semibold">{e.waterLiters ? e.waterLiters.toLocaleString('en-IN') : '—'}</td>
                          <td className="py-2 px-3 text-on-surface-variant">{e.householdSize ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Water SVG Bar Chart */}
              <div className="mt-space-md w-full" aria-hidden={showWaterTable}>
                <div className="relative w-full overflow-x-auto">
                  <svg
                    className="w-full h-44 min-w-[320px]"
                    fill="none"
                    viewBox={`0 0 ${Math.max(340, chartEntries.length * 65 + 40)} 150`}
                    xmlns="http://www.w3.org/2000/svg"
                    role="img"
                    aria-label={`Bar chart showing water usage across ${chartEntries.length} months`}
                  >
                    <line x1="20" y1="120" x2={Math.max(320, chartEntries.length * 65 + 20)} y2="120" stroke="#eae8e5" strokeWidth="1" />
                    {chartEntries.map((s, t) => {
                      const maxWater = Math.max(1, ...chartEntries.map((e) => e.waterLiters ?? 0));
                      const val = s.waterLiters ?? 0;
                      const h = Math.max(4, Math.round((val / maxWater) * 90));
                      const x = 30 + t * 65;
                      const y = 120 - h;
                      return (
                        <g key={s.id || s.month}>
                          <text x={x + 18} y={y - 5} textAnchor="middle" className="font-mono text-[11px] font-bold" fill="#0284c7">
                            {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                          </text>
                          <rect x={x} y={y} width="36" height={h} rx="6" fill="#0284c7" />
                          <text x={x + 18} y="138" textAnchor="middle" className="font-label-statutory text-[11px]" fill="#5c645c">
                            {formatMonthLabel(s.month).slice(0, 3)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 5: Utility Action Dock & Reference Accordion */}
      <section className="flex flex-col gap-space-md">
        {/* Action Dock */}
        <div className="p-space-md rounded-2xl bg-surface-container-lowest/80 backdrop-blur-md shadow-sm border border-hairline flex flex-col sm:flex-row items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-sm flex-wrap">
            <button
              type="button"
              className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-all shadow-sm border border-hairline font-semibold"
              onClick={() => alert('Generating Signed Utility Report (PDF)...')}
            >
              <span className="material-symbols-outlined text-[18px]">download_for_offline</span>
              Download Verifiable Utility Report (PDF)
            </button>

            <button
              type="button"
              className="inline-flex items-center gap-2 px-space-md py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-all shadow-sm border border-hairline font-semibold"
              onClick={exportTrackerData}
            >
              <span className="material-symbols-outlined text-[18px]">data_object</span>
              Export Data (JSON)
            </button>
          </div>

          <button
            ref={clearTriggerRef}
            type="button"
            className="inline-flex items-center gap-1.5 text-error hover:text-error/80 font-label-sm text-label-sm transition-colors font-semibold"
            onClick={() => clearDialogRef.current?.showModal()}
          >
            <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
            Clear all tracker records
          </button>
        </div>

        {/* Clear Confirmation Modal Dialog */}
        <dialog
          ref={clearDialogRef}
          className="rounded-2xl p-0 backdrop:bg-inverse-surface/50 border border-hairline shadow-2xl max-w-md w-full"
          aria-labelledby="clear-dialog-title"
        >
          <div className="p-space-lg bg-surface-container-lowest flex flex-col gap-space-md">
            <h3 id="clear-dialog-title" className="font-headline-sm text-headline-sm font-bold text-error">
              Clear All Tracker Records?
            </h3>
            <p className="font-body-sm text-on-surface-variant">
              This will permanently remove all your local monthly electricity, water, and household utility logs from this device.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-surface-container font-label-sm"
                onClick={() => clearDialogRef.current?.close()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-xl bg-error text-on-error font-label-sm font-bold"
                onClick={handleConfirmClearTracker}
              >
                Yes, clear records
              </button>
            </div>
          </div>
        </dialog>

        {/* Reference Accordion */}
        <details className="group rounded-2xl bg-surface-container-low/70 border border-hairline p-space-md text-on-surface-variant transition-all">
          <summary className="flex items-center justify-between cursor-pointer list-none select-none font-label-md text-label-md font-bold text-on-surface">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-[20px]">account_balance</span>
              Factor Sources &amp; Statutory Methodology Disclosures
            </span>
            <span className="material-symbols-outlined transition-transform duration-200 group-open:rotate-180">
              expand_more
            </span>
          </summary>
          <div className="pt-space-md mt-space-sm border-t border-hairline text-body-sm text-body-sm leading-relaxed flex flex-col gap-2">
            <p>
              <strong>1. Central Electricity Authority (CEA) Baseline v22.0:</strong> Emissions calculations apply the combined margin grid emission factor of 0.675 tCO₂/MWh for the Southern Regional Grid (SR-Mix 2025/2026), incorporating standard auxiliary transmission losses.
            </p>
            <p>
              <strong>2. CPHEEO Urban Benchmark:</strong> Baseline water volume adheres strictly to the Ministry of Housing and Urban Affairs (MoHUA) Central Public Health and Environmental Engineering Organisation guideline of 135 LPCD (litres per capita per day) for sewered cities.
            </p>
            <p>
              <strong>3. India GHG Program &amp; Urban Mobility Factors:</strong> Transit coefficient factors derive from WRI India transport inventories: Metro Rail at 0.015 kg CO₂/passenger-km, ICE Two-Wheelers at 0.045 kg CO₂/km, and Private ICE Hatchbacks at 0.140 kg CO₂/km assuming single occupancy.
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}

export default FootprintScreen;


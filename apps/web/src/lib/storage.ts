import type { Stream } from '@zerowastein/rules';

/** Storage key name adhering to versioned namespace convention. */
export const STORAGE_KEY = 'zerowastein:v1:tally';

/** Current schema version number. */
export const SCHEMA_VERSION = 1;

/** Maximum retained item history records. */
export const MAX_HISTORY_ITEMS = 50;

/** Minimal record of a confirmed waste item classification. */
export interface ImpactEntry {
  /** Unique item entry identifier. */
  readonly id: string;
  /** Unix timestamp in milliseconds when item was categorized. */
  readonly timestamp: number;
  /** Canonical display name of the sorted item. */
  readonly itemLabel: string;
  /** Statutory waste stream. */
  readonly stream: Stream;
  /** True if item was routed into special-care domestic hazardous stream. */
  readonly isSpecialCare: boolean;
}

/** Complete persisted tally data structure stored on-device. */
export interface ImpactTally {
  /** Schema version identifier. */
  readonly version: typeof SCHEMA_VERSION;
  /** Lifetime count of items sorted on this device. */
  readonly totalCount: number;
  /** Lifetime count of hazardous special-care items prevented from landfilling. */
  readonly specialCareCount: number;
  /** Chronological list of recent sorted items (capped at 50). */
  readonly history: readonly ImpactEntry[];
}

/** Initial clean tally state. */
const INITIAL_TALLY: ImpactTally = {
  version: SCHEMA_VERSION,
  totalCount: 0,
  specialCareCount: 0,
  history: [],
};

/**
 * Validates that an unknown object strictly matches the ImpactEntry interface.
 *
 * @param obj Unknown JSON object.
 * @returns True if object is a valid ImpactEntry.
 */
function isValidImpactEntry(obj: unknown): obj is ImpactEntry {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  const entry = obj as Record<string, unknown>;
  const validStreams = new Set(['wet', 'dry', 'sanitary', 'special_care']);

  return (
    typeof entry['id'] === 'string' &&
    typeof entry['timestamp'] === 'number' &&
    typeof entry['itemLabel'] === 'string' &&
    typeof entry['stream'] === 'string' &&
    validStreams.has(entry['stream']) &&
    typeof entry['isSpecialCare'] === 'boolean'
  );
}

/**
 * Validates unknown localStorage content against the ImpactTally schema.
 *
 * @param obj Unknown parsed JSON value.
 * @returns True if value conforms to ImpactTally schema.
 */
export function isValidImpactTally(obj: unknown): obj is ImpactTally {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  const candidate = obj as Record<string, unknown>;

  if (candidate['version'] !== SCHEMA_VERSION) {
    return false;
  }
  if (typeof candidate['totalCount'] !== 'number' || candidate['totalCount'] < 0) {
    return false;
  }
  if (typeof candidate['specialCareCount'] !== 'number' || candidate['specialCareCount'] < 0) {
    return false;
  }
  if (!Array.isArray(candidate['history'])) {
    return false;
  }

  return candidate['history'].every(isValidImpactEntry);
}

/**
 * Reads and validates the impact tally from localStorage, returning safe defaults upon corruption.
 *
 * @returns Validated ImpactTally data structure.
 */
export function getImpactTally(): ImpactTally {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return INITIAL_TALLY;
    }
    const parsed = JSON.parse(raw);
    if (isValidImpactTally(parsed)) {
      return parsed;
    }
    // Auto-reset corrupt or outdated data safely
    localStorage.removeItem(STORAGE_KEY);
    return INITIAL_TALLY;
  } catch {
    return INITIAL_TALLY;
  }
}

/**
 * Persists an updated impact tally safely into localStorage.
 *
 * @param tally Validated ImpactTally payload.
 */
function saveImpactTally(tally: ImpactTally): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tally));
  } catch {
    // Gracefully handle storage quota or private-browsing restrictions
  }
}

/**
 * Records a verified item classification into the local tally history without storing photos or user text.
 *
 * @param itemLabel Canonical label of the categorized item.
 * @param stream Statutory waste stream.
 * @returns Updated impact tally.
 */
export function recordImpactItem(itemLabel: string, stream: Stream): ImpactTally {
  const current = getImpactTally();
  const isSpecialCare = stream === 'special_care';

  const newEntry: ImpactEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    itemLabel: itemLabel.trim(),
    stream,
    isSpecialCare,
  };

  const updatedHistory = [newEntry, ...current.history].slice(0, MAX_HISTORY_ITEMS);

  const updatedTally: ImpactTally = {
    version: SCHEMA_VERSION,
    totalCount: current.totalCount + 1,
    specialCareCount: isSpecialCare ? current.specialCareCount + 1 : current.specialCareCount,
    history: updatedHistory,
  };

  saveImpactTally(updatedTally);
  return updatedTally;
}

/**
 * Clears all on-device tally and item history data.
 */
export function clearImpactTally(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore private browsing or blocked storage errors
  }
}

/**
 * Generates and triggers download of a sanitized JSON file containing on-device impact data.
 */
export function exportImpactTally(): void {
  const data = getImpactTally();
  const serialized = JSON.stringify(data, null, 2);
  const blob = new Blob([serialized], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `zerowastein-impact-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}

/** Storage key name for on-device monthly utility tracker entries. */
export const TRACKER_STORAGE_KEY = 'zerowastein:v1:tracker';

/** Current schema version for utility tracker store. */
export const TRACKER_SCHEMA_VERSION = 1;

/** Maximum retained monthly history records for utility tracking (24 months). */
export const MAX_TRACKER_MONTHS = 24;

/** Record of a single month's recorded household utility consumption. */
export interface MonthlyTrackerEntry {
  /** Unique entry identifier (defaults to month string YYYY-MM). */
  readonly id: string;
  /** ISO format year-month representation (e.g. "2026-03"). */
  readonly month: string;
  /** Monthly grid electricity consumption in kilowatt-hours. */
  readonly electricityKwh?: number;
  /** Monthly domestic water consumption in liters. */
  readonly waterLiters?: number;
  /** Number of residents residing in the household during this billing period. */
  readonly householdSize?: number;
  /** Timestamp when this entry was created or last modified. */
  readonly updatedAt: number;
}

/** Complete persisted utility tracker data structure stored on-device. */
export interface TrackerStore {
  /** Schema version identifier. */
  readonly schemaVersion: typeof TRACKER_SCHEMA_VERSION;
  /** Chronological history of monthly utility logs, ordered newest to oldest (capped at 24). */
  readonly entries: readonly MonthlyTrackerEntry[];
}

/** Initial clean tracker store state. */
const INITIAL_TRACKER_STORE: TrackerStore = {
  schemaVersion: TRACKER_SCHEMA_VERSION,
  entries: [],
};

/**
 * Validates that an unknown object strictly matches the MonthlyTrackerEntry interface.
 *
 * @param obj Unknown JSON object.
 * @returns True if object is a valid MonthlyTrackerEntry.
 */
function isValidTrackerEntry(obj: unknown): obj is MonthlyTrackerEntry {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  const entry = obj as Record<string, unknown>;

  if (typeof entry['id'] !== 'string' || !entry['id']) {
    return false;
  }
  if (typeof entry['month'] !== 'string' || !/^\d{4}-\d{2}$/.test(entry['month'])) {
    return false;
  }
  if (typeof entry['updatedAt'] !== 'number' || entry['updatedAt'] < 0) {
    return false;
  }
  if (
    entry['electricityKwh'] !== undefined &&
    (typeof entry['electricityKwh'] !== 'number' || entry['electricityKwh'] < 0)
  ) {
    return false;
  }
  if (
    entry['waterLiters'] !== undefined &&
    (typeof entry['waterLiters'] !== 'number' || entry['waterLiters'] < 0)
  ) {
    return false;
  }
  if (
    entry['householdSize'] !== undefined &&
    (typeof entry['householdSize'] !== 'number' || entry['householdSize'] < 1)
  ) {
    return false;
  }

  return true;
}

/**
 * Validates unknown localStorage content against the TrackerStore schema.
 *
 * @param obj Unknown parsed JSON value.
 * @returns True if value conforms to TrackerStore schema.
 */
export function isValidTrackerStore(obj: unknown): obj is TrackerStore {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  const candidate = obj as Record<string, unknown>;

  if (candidate['schemaVersion'] !== TRACKER_SCHEMA_VERSION) {
    return false;
  }
  if (!Array.isArray(candidate['entries'])) {
    return false;
  }

  return candidate['entries'].every(isValidTrackerEntry);
}

/**
 * Reads and validates the utility tracker data from localStorage, returning safe defaults on error.
 *
 * @returns Validated TrackerStore data structure.
 */
export function getTrackerData(): TrackerStore {
  try {
    const raw = localStorage.getItem(TRACKER_STORAGE_KEY);
    if (!raw) {
      return INITIAL_TRACKER_STORE;
    }
    const parsed = JSON.parse(raw);
    if (isValidTrackerStore(parsed)) {
      return parsed;
    }
    localStorage.removeItem(TRACKER_STORAGE_KEY);
    return INITIAL_TRACKER_STORE;
  } catch {
    return INITIAL_TRACKER_STORE;
  }
}

/**
 * Persists an updated tracker store safely into localStorage.
 *
 * @param store Validated TrackerStore payload.
 */
function saveTrackerStore(store: TrackerStore): void {
  try {
    localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Gracefully handle storage quota or private-browsing restrictions
  }
}

/**
 * Inserts or updates a monthly utility entry, maintaining chronological sort and 24-month cap.
 *
 * @param entry Parameters for the monthly entry.
 * @returns Updated tracker store.
 */
export function saveTrackerEntry(
  entry: Omit<MonthlyTrackerEntry, 'id' | 'updatedAt'>
): TrackerStore {
  const current = getTrackerData();
  const id = entry.month;
  const newEntry: MonthlyTrackerEntry = {
    ...entry,
    id,
    updatedAt: Date.now(),
  };

  // Filter out any existing entry for the same month, prepend new/updated, sort descending, cap at 24
  const existingWithoutMonth = current.entries.filter((e) => e.month !== entry.month);
  const updatedEntries = [newEntry, ...existingWithoutMonth]
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, MAX_TRACKER_MONTHS);

  const updatedStore: TrackerStore = {
    schemaVersion: TRACKER_SCHEMA_VERSION,
    entries: updatedEntries,
  };

  saveTrackerStore(updatedStore);
  return updatedStore;
}

/**
 * Deletes a specific monthly tracker record by identifier.
 *
 * @param id Entry identifier (YYYY-MM).
 * @returns Updated tracker store.
 */
export function deleteTrackerEntry(id: string): TrackerStore {
  const current = getTrackerData();
  const updatedEntries = current.entries.filter((e) => e.id !== id);
  const updatedStore: TrackerStore = {
    schemaVersion: TRACKER_SCHEMA_VERSION,
    entries: updatedEntries,
  };
  saveTrackerStore(updatedStore);
  return updatedStore;
}

/**
 * Clears all on-device utility tracker data.
 */
export function clearTrackerData(): void {
  try {
    localStorage.removeItem(TRACKER_STORAGE_KEY);
  } catch {
    // Ignore private browsing or blocked storage errors
  }
}

/**
 * Generates and triggers download of a sanitized JSON file containing utility tracking data.
 */
export function exportTrackerData(): void {
  const data = getTrackerData();
  const serialized = JSON.stringify(data, null, 2);
  const blob = new Blob([serialized], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `zerowastein-tracker-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}

/** Comparison metrics comparing the latest recorded month with the user's own previous month. */
export interface UtilityChangeMetric {
  /** Signed difference (current - previous). */
  readonly delta: number;
  /** Absolute percentage change relative to previous month. */
  readonly percentage: number;
  /** Direction indicator: up (increase), down (decrease), or flat (unchanged). */
  readonly direction: 'up' | 'down' | 'flat';
  /** Formatted human-readable string with explicit +/- sign and direction context. */
  readonly formatted: string;
}

/** Result of comparing the most recent month entry against the previous month baseline. */
export interface TrackerComparisonResult {
  readonly latest?: MonthlyTrackerEntry;
  readonly previous?: MonthlyTrackerEntry;
  readonly electricityChange?: UtilityChangeMetric;
  readonly waterChange?: UtilityChangeMetric;
}

/**
 * Calculates comparative changes between the latest month and the immediate preceding month.
 *
 * @param store Optional tracker store instance; defaults to reading on-device store.
 * @returns Comparison result with signed deltas and direction indications.
 */
export function getTrackerComparison(
  store: TrackerStore = getTrackerData()
): TrackerComparisonResult {
  const sorted = [...store.entries].sort((a, b) => b.month.localeCompare(a.month));
  const latest = sorted[0];
  const previous = sorted[1];

  if (!latest || !previous) {
    return { latest, previous };
  }

  let electricityChange: UtilityChangeMetric | undefined;
  if (latest.electricityKwh !== undefined && previous.electricityKwh !== undefined) {
    const delta = Math.round((latest.electricityKwh - previous.electricityKwh) * 10) / 10;
    const direction: 'up' | 'down' | 'flat' = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const percentage =
      previous.electricityKwh > 0
        ? Math.round((Math.abs(delta) / previous.electricityKwh) * 100)
        : 0;
    const sign = delta > 0 ? '+' : '';
    const formatted = `${sign}${delta} kWh (${percentage}% ${direction === 'up' ? 'more than' : direction === 'down' ? 'less than' : 'same as'} previous month)`;

    electricityChange = { delta, percentage, direction, formatted };
  }

  let waterChange: UtilityChangeMetric | undefined;
  if (latest.waterLiters !== undefined && previous.waterLiters !== undefined) {
    const delta = latest.waterLiters - previous.waterLiters;
    const direction: 'up' | 'down' | 'flat' = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const percentage =
      previous.waterLiters > 0 ? Math.round((Math.abs(delta) / previous.waterLiters) * 100) : 0;
    const sign = delta > 0 ? '+' : '';
    const formatted = `${sign}${delta} L (${percentage}% ${direction === 'up' ? 'more than' : direction === 'down' ? 'less than' : 'same as'} previous month)`;

    waterChange = { delta, percentage, direction, formatted };
  }

  return {
    latest,
    previous,
    electricityChange,
    waterChange,
  };
}

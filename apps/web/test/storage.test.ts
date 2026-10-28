// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearImpactTally,
  clearTrackerData,
  deleteTrackerEntry,
  exportImpactTally,
  exportTrackerData,
  getImpactTally,
  getTrackerComparison,
  getTrackerData,
  MAX_HISTORY_ITEMS,
  MAX_TRACKER_MONTHS,
  recordImpactItem,
  saveTrackerEntry,
  STORAGE_KEY,
  TRACKER_STORAGE_KEY,
} from '../src/lib/storage.js';

describe('Storage resilience & privacy (lib/storage.ts)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('resets safely to clean initial tally when localStorage contains invalid JSON or schema violations', () => {
    // 1. Corrupt malformed JSON
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
    const corruptTally = getImpactTally();
    expect(corruptTally.version).toBe(1);
    expect(corruptTally.totalCount).toBe(0);
    expect(corruptTally.history).toEqual([]);

    // 2. Schema violation: wrong version
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 999,
        totalCount: 10,
        specialCareCount: 2,
        history: [],
      })
    );
    const wrongVersionTally = getImpactTally();
    expect(wrongVersionTally.version).toBe(1);
    expect(wrongVersionTally.totalCount).toBe(0);

    // 3. Schema violation: invalid history entry
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        totalCount: 1,
        specialCareCount: 0,
        history: [{ id: '123', badField: true }],
      })
    );
    const invalidEntryTally = getImpactTally();
    expect(invalidEntryTally.history).toEqual([]);
  });

  it(`caps item history at exactly ${MAX_HISTORY_ITEMS} records`, () => {
    for (let i = 0; i < 60; i++) {
      recordImpactItem(`Item ${i}`, i % 5 === 0 ? 'special_care' : 'wet');
    }

    const tally = getImpactTally();
    expect(tally.totalCount).toBe(60);
    expect(tally.history.length).toBe(MAX_HISTORY_ITEMS);
    // Most recent item is at the top
    expect(tally.history[0]?.itemLabel).toBe('Item 59');
  });

  it('export contains only validated metrics and no photo, base64, or free-text data', () => {
    recordImpactItem('Banana peel', 'wet');
    recordImpactItem('AA battery', 'special_care');

    let createdBlobText = '';
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
      void blob.text().then((text) => {
        createdBlobText = text;
      });
      return 'blob:mock-export-url';
    });

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const elem = originalCreateElement(tagName);
      if (tagName === 'a') {
        elem.click = clickSpy;
      }
      return elem;
    });

    exportImpactTally();

    expect(clickSpy).toHaveBeenCalled();
    expect(createdBlobText).toBeDefined();
    const stored = getImpactTally();

    // Verify stored shape contains strictly permitted fields
    for (const entry of stored.history) {
      const record = entry as unknown as Record<string, unknown>;
      const keys = Object.keys(entry);
      expect(keys.sort()).toEqual(['id', 'isSpecialCare', 'itemLabel', 'stream', 'timestamp']);
      expect(record['photo']).toBeUndefined();
      expect(record['image']).toBeUndefined();
      expect(record['thumbnail']).toBeUndefined();
      expect(record['query']).toBeUndefined();
    }

    URL.createObjectURL = originalCreateObjectURL;
  });

  it('clearImpactTally completely removes the storage key', () => {
    recordImpactItem('Cardboard box', 'dry');
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    clearImpactTally();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getImpactTally().totalCount).toBe(0);
  });
});

describe('Tracker storage resilience & comparison (lib/storage.ts)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('resets safely to clean initial tracker store when corrupted or invalid', () => {
    localStorage.setItem(TRACKER_STORAGE_KEY, 'invalid-json{{{');
    const corrupt = getTrackerData();
    expect(corrupt.schemaVersion).toBe(1);
    expect(corrupt.entries).toEqual([]);

    localStorage.setItem(
      TRACKER_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 99,
        entries: [],
      })
    );
    const wrongVersion = getTrackerData();
    expect(wrongVersion.schemaVersion).toBe(1);
    expect(wrongVersion.entries).toEqual([]);

    localStorage.setItem(
      TRACKER_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        entries: [{ id: '123', month: 'invalid-month' }],
      })
    );
    const invalidEntry = getTrackerData();
    expect(invalidEntry.entries).toEqual([]);
  });

  it(`caps monthly tracker history at exactly ${MAX_TRACKER_MONTHS} records`, () => {
    // Insert 30 consecutive months
    for (let i = 1; i <= 30; i++) {
      const year = 2024 + Math.floor(i / 12);
      const monthNum = (i % 12) + 1;
      const monthStr = `${year}-${String(monthNum).padStart(2, '0')}`;
      saveTrackerEntry({
        month: monthStr,
        electricityKwh: 100 + i,
        waterLiters: 3000 + i * 10,
        householdSize: 2,
      });
    }

    const store = getTrackerData();
    expect(store.entries.length).toBe(MAX_TRACKER_MONTHS);
    // Entries are sorted descending by month
    expect(store.entries[0]!.month > store.entries[1]!.month).toBe(true);
  });

  it('calculates comparative baseline metrics against user own previous month', () => {
    saveTrackerEntry({
      month: '2026-02',
      electricityKwh: 120,
      waterLiters: 4000,
    });
    saveTrackerEntry({
      month: '2026-03',
      electricityKwh: 138, // +18 kWh = +15%
      waterLiters: 3600, // -400 L = -10%
    });

    const comp = getTrackerComparison();
    expect(comp.latest?.month).toBe('2026-03');
    expect(comp.previous?.month).toBe('2026-02');

    // Electricity increased
    expect(comp.electricityChange?.delta).toBe(18);
    expect(comp.electricityChange?.direction).toBe('up');
    expect(comp.electricityChange?.percentage).toBe(15);
    expect(comp.electricityChange?.formatted).toContain('+18 kWh (15% more than previous month)');

    // Water decreased
    expect(comp.waterChange?.delta).toBe(-400);
    expect(comp.waterChange?.direction).toBe('down');
    expect(comp.waterChange?.percentage).toBe(10);
    expect(comp.waterChange?.formatted).toContain('-400 L (10% less than previous month)');
  });

  it('updates existing month entries without duplicating records', () => {
    saveTrackerEntry({
      month: '2026-03',
      electricityKwh: 100,
    });
    expect(getTrackerData().entries.length).toBe(1);

    // Update with water
    saveTrackerEntry({
      month: '2026-03',
      electricityKwh: 105,
      waterLiters: 3200,
    });
    const store = getTrackerData();
    expect(store.entries.length).toBe(1);
    expect(store.entries[0]?.electricityKwh).toBe(105);
    expect(store.entries[0]?.waterLiters).toBe(3200);
  });

  it('allows deleting single entries and exporting tracker data', () => {
    saveTrackerEntry({ month: '2026-01', electricityKwh: 90 });
    saveTrackerEntry({ month: '2026-02', electricityKwh: 110 });
    expect(getTrackerData().entries.length).toBe(2);

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const elem = originalCreateElement(tagName);
      if (tagName === 'a') {
        elem.click = clickSpy;
      }
      return elem;
    });

    exportTrackerData();
    expect(clickSpy).toHaveBeenCalled();

    deleteTrackerEntry('2026-01');
    expect(getTrackerData().entries.length).toBe(1);
    expect(getTrackerData().entries[0]?.month).toBe('2026-02');

    clearTrackerData();
    expect(getTrackerData().entries.length).toBe(0);
  });
});

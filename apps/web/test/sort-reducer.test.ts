import { describe, expect, it } from 'vitest';
import {
  INITIAL_SORT_STATE,
  sortReducer,
  type SortState,
} from '../src/features/sort/sort-reducer.js';
import type { Verdict } from '@zerowastein/rules';

describe('sortReducer state transitions', () => {
  it('starts in idle initial state', () => {
    expect(INITIAL_SORT_STATE.status).toBe('idle');
    expect(INITIAL_SORT_STATE.itemLabel).toBe('');
    expect(INITIAL_SORT_STATE.thumbnail).toBeNull();
    expect(INITIAL_SORT_STATE.verdict).toBeNull();
    expect(INITIAL_SORT_STATE.error).toBeNull();
  });

  it('transitions idle -> preparing on START_PREPARING', () => {
    const next = sortReducer(INITIAL_SORT_STATE, { type: 'START_PREPARING' });
    expect(next.status).toBe('preparing');
    expect(next.error).toBeNull();
  });

  it('transitions to loading on START_LOADING with metadata', () => {
    const next = sortReducer(INITIAL_SORT_STATE, {
      type: 'START_LOADING',
      payload: {
        itemLabel: 'Glass jar',
        isPhoto: true,
        thumbnail: 'data:image/jpeg;base64,mock',
      },
    });

    expect(next.status).toBe('loading');
    expect(next.itemLabel).toBe('Glass jar');
    expect(next.isPhoto).toBe(true);
    expect(next.thumbnail).toBe('data:image/jpeg;base64,mock');
  });

  it('transitions to result on SET_RESULT', () => {
    const mockVerdict: Verdict = {
      kind: 'answer',
      stream: 'dry',
      itemLabel: 'Glass jar',
      reason: 'Recyclable container.',
      action: 'Put in dry bin.',
      flags: [],
      confidenceBand: 'high',
      source: 'table',
      rowId: 'glass_bottle',
    };

    const next = sortReducer(INITIAL_SORT_STATE, {
      type: 'SET_RESULT',
      payload: {
        verdict: mockVerdict,
        itemLabel: 'Glass jar',
        meta: { source: 'table', providerUsed: null, crossChecked: false, degraded: false },
        thumbnail: null,
      },
    });

    expect(next.status).toBe('result');
    expect(next.verdict).toEqual(mockVerdict);
    expect(next.itemLabel).toBe('Glass jar');
    expect(next.error).toBeNull();
  });

  it('transitions to ask on SET_ASK', () => {
    const mockAskVerdict: Verdict = {
      kind: 'ask',
      question: 'Is it completely empty?',
      options: [
        { label: 'Yes', stream: 'dry' },
        { label: 'No', stream: 'special_care' },
      ],
      reasonId: 'row_follow_up',
      rowId: 'aerosol_cans',
    };

    const next = sortReducer(INITIAL_SORT_STATE, {
      type: 'SET_ASK',
      payload: {
        verdict: mockAskVerdict,
        itemLabel: 'Aerosol can',
        thumbnail: null,
      },
    });

    expect(next.status).toBe('ask');
    expect(next.verdict).toEqual(mockAskVerdict);
    expect(next.itemLabel).toBe('Aerosol can');
  });

  it('transitions to unclear on SET_UNCLEAR', () => {
    const mockUnclearVerdict: Verdict = {
      kind: 'unclear',
      itemLabel: 'Used cooking oil',
      guidance: 'Seal in bottle and check with municipality.',
      flags: [],
      rowId: 'used_cooking_oil',
    };

    const next = sortReducer(INITIAL_SORT_STATE, {
      type: 'SET_UNCLEAR',
      payload: {
        verdict: mockUnclearVerdict,
        itemLabel: 'Used cooking oil',
        thumbnail: null,
      },
    });

    expect(next.status).toBe('unclear');
    expect(next.verdict).toEqual(mockUnclearVerdict);
  });

  it('transitions to error on SET_ERROR with message and candidates', () => {
    const next = sortReducer(INITIAL_SORT_STATE, {
      type: 'SET_ERROR',
      payload: {
        code: 'RATE_LIMITED',
        message: 'Busy right now. Try again in a minute, or type the item.',
        candidates: [],
      },
    });

    expect(next.status).toBe('error');
    expect(next.error?.code).toBe('RATE_LIMITED');
    expect(next.error?.message).toMatch(/busy right now/i);
    expect(next.candidates).toEqual([]);
  });

  it('cancels from loading to idle on CANCEL', () => {
    const loadingState: SortState = {
      ...INITIAL_SORT_STATE,
      status: 'loading',
      itemLabel: 'Banana peel',
    };

    const next = sortReducer(loadingState, { type: 'CANCEL' });
    expect(next.status).toBe('idle');
    expect(next.error).toBeNull();
  });

  it('ignores CANCEL if not in loading or preparing state', () => {
    const resultState: SortState = {
      ...INITIAL_SORT_STATE,
      status: 'result',
    };

    const next = sortReducer(resultState, { type: 'CANCEL' });
    expect(next.status).toBe('result');
  });

  it('resets to clean idle state on RESET while preserving offline state', () => {
    const errorState: SortState = {
      ...INITIAL_SORT_STATE,
      status: 'error',
      isOffline: true,
      error: { code: 'NETWORK_ERROR', message: 'Offline' },
    };

    const next = sortReducer(errorState, { type: 'RESET' });
    expect(next.status).toBe('idle');
    expect(next.error).toBeNull();
    expect(next.isOffline).toBe(true);
  });

  it('updates network connectivity on SET_OFFLINE', () => {
    const offlineState = sortReducer(INITIAL_SORT_STATE, {
      type: 'SET_OFFLINE',
      payload: { isOffline: true },
    });
    expect(offlineState.isOffline).toBe(true);

    const onlineState = sortReducer(offlineState, {
      type: 'SET_OFFLINE',
      payload: { isOffline: false },
    });
    expect(onlineState.isOffline).toBe(false);
  });
});

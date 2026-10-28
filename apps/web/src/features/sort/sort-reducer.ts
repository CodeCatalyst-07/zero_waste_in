import type { ClassifyMeta } from '@zerowastein/contract';
import type { RankedCandidate, Verdict } from '@zerowastein/rules';

/** High-level state machine phases for the waste sorting workflow. */
export type SortStatus = 'idle' | 'preparing' | 'loading' | 'result' | 'ask' | 'unclear' | 'error';

/** Error representation with user recovery guidance. */
export interface SortErrorState {
  readonly code: string;
  readonly message: string;
}

/** Complete immutable state model for the waste sorting screen. */
export interface SortState {
  readonly status: SortStatus;
  readonly itemLabel: string;
  readonly thumbnail: string | null;
  readonly isPhoto: boolean;
  readonly verdict: Verdict | null;
  readonly meta: ClassifyMeta | null;
  readonly error: SortErrorState | null;
  readonly candidates: readonly RankedCandidate[];
  readonly isOffline: boolean;
}

/** Initial clean sort flow state. */
export const INITIAL_SORT_STATE: SortState = {
  status: 'idle',
  itemLabel: '',
  thumbnail: null,
  isPhoto: false,
  verdict: null,
  meta: null,
  error: null,
  candidates: [],
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
};

/** Discriminated union of all supported sort workflow actions. */
export type SortAction =
  | { type: 'START_PREPARING' }
  | {
      type: 'START_LOADING';
      payload: { itemLabel: string; isPhoto: boolean; thumbnail?: string | null };
    }
  | {
      type: 'SET_RESULT';
      payload: {
        verdict: Verdict;
        itemLabel: string;
        meta?: ClassifyMeta | null;
        thumbnail?: string | null;
      };
    }
  | {
      type: 'SET_ASK';
      payload: {
        verdict: Verdict;
        itemLabel: string;
        thumbnail?: string | null;
      };
    }
  | {
      type: 'SET_UNCLEAR';
      payload: {
        verdict: Verdict;
        itemLabel: string;
        thumbnail?: string | null;
      };
    }
  | {
      type: 'SET_ERROR';
      payload: {
        code: string;
        message: string;
        candidates?: readonly RankedCandidate[];
      };
    }
  | { type: 'CANCEL' }
  | { type: 'RESET' }
  | { type: 'SET_OFFLINE'; payload: { isOffline: boolean } };

/**
 * Pure state reducer governing all sort workflow transitions, error handling, and recovery paths.
 *
 * @param state Current sort workflow state.
 * @param action Dispatched sort workflow action.
 * @returns Next state.
 */
export function sortReducer(state: SortState, action: SortAction): SortState {
  switch (action.type) {
    case 'START_PREPARING':
      return {
        ...state,
        status: 'preparing',
        error: null,
        candidates: [],
      };

    case 'START_LOADING':
      return {
        ...state,
        status: 'loading',
        itemLabel: action.payload.itemLabel,
        isPhoto: action.payload.isPhoto,
        thumbnail: action.payload.thumbnail ?? null,
        error: null,
        candidates: [],
      };

    case 'SET_RESULT':
      return {
        ...state,
        status: 'result',
        verdict: action.payload.verdict,
        itemLabel: action.payload.itemLabel,
        meta: action.payload.meta ?? null,
        thumbnail: action.payload.thumbnail ?? state.thumbnail,
        error: null,
        candidates: [],
      };

    case 'SET_ASK':
      return {
        ...state,
        status: 'ask',
        verdict: action.payload.verdict,
        itemLabel: action.payload.itemLabel,
        thumbnail: action.payload.thumbnail ?? state.thumbnail,
        error: null,
        candidates: [],
      };

    case 'SET_UNCLEAR':
      return {
        ...state,
        status: 'unclear',
        verdict: action.payload.verdict,
        itemLabel: action.payload.itemLabel,
        thumbnail: action.payload.thumbnail ?? state.thumbnail,
        error: null,
        candidates: [],
      };

    case 'SET_ERROR':
      return {
        ...state,
        status: 'error',
        error: {
          code: action.payload.code,
          message: action.payload.message,
        },
        candidates: action.payload.candidates ?? [],
      };

    case 'CANCEL':
      if (state.status !== 'loading' && state.status !== 'preparing') {
        return state;
      }
      return {
        ...state,
        status: 'idle',
        error: null,
        thumbnail: null,
      };

    case 'RESET':
      return {
        ...INITIAL_SORT_STATE,
        isOffline: state.isOffline,
      };

    case 'SET_OFFLINE':
      return {
        ...state,
        isOffline: action.payload.isOffline,
      };

    default:
      return state;
  }
}

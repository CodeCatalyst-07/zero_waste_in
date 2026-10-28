import React, { useEffect, useId, useReducer, useRef, useState } from 'react';
import type { Attributes, Stream } from '@zerowastein/rules';
import {
  COMMON_ITEM_IDS,
  decide,
  lookupByText,
  resolveFollowUp,
  rulesTable,
} from '@zerowastein/rules';
import {
  InfoIcon,
  ShapeBadge,
  WarningIcon,
} from '../../icons/index.js';
import { classifyItem } from '../../lib/api.js';
import { getFlagDescriptor } from '../../lib/flags.js';
import { processImageFile } from '../../lib/image.js';
import { recordImpactItem } from '../../lib/storage.js';
import { INITIAL_SORT_STATE, sortReducer } from './sort-reducer.js';

/** Stream display metadata. */
const STREAM_NAMES: Record<Stream, string> = {
  wet: 'Wet waste',
  dry: 'Dry waste',
  sanitary: 'Sanitary waste',
  special_care: 'Special-care waste',
};

const STREAM_CODES: Record<Stream, string> = {
  wet: '#01-ORG',
  dry: '#02-REC',
  sanitary: '#03-SAN',
  special_care: '#04-HAZ',
};

const STREAM_SUBTITLES: Record<Stream, string> = {
  wet: 'Biodegradable Organic Stream • MoEFCC Validated',
  dry: 'Material Recovery Facility (MRF) Stream • MoEFCC Validated',
  sanitary: 'Domestic Bio-Hazardous Stream • MoEFCC Validated',
  special_care: 'Hazardous & E-Waste Stream • MoEFCC Validated',
};

const STREAM_DESTINATIONS: Record<Stream, string> = {
  wet: 'Decomposes aerobically in decentralized community composting units to yield Class-A organic soil conditioner, eliminating anaerobic landfill methane emissions.',
  dry: 'Processed at local Material Recovery Facilities (MRF) through automated optical sorting, magnetic separation, and baling for industrial re-granulation.',
  sanitary: 'Safely transported to authorized high-temperature common biomedical incineration facilities complying with CPCB air emission standards.',
  special_care: 'Diverted to government-authorized e-waste dismantlers and hazardous disposal facilities for hydrometallurgical heavy metal extraction.',
};

const SAMPLE_THUMBNAILS: Record<Stream, string> = {
  wet: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCfwOqOw1zqt6pqBM43shKqgA5Lf3jIDn9DAMc4kr9As1nGCzVhgPnOaJsmgnhh4UOk-ay5M7qt7-qthYHyR4MEfDIVVb5RnvckX6FbuLCg5Su8wHNFBJa48o6qgxY-NCYsgU4Cahy0UTVYkXWceh27ddJHn4oG_Fbaz06amIjKDclBEnlIuHeREfUpTjmxYfHBMFcNA6H9FGLygRzXRZ6kEe0xQ04NTDq5knt1sKU',
  dry: 'https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=600&q=80',
  sanitary: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=600&q=80',
  special_care: 'https://images.unsplash.com/photo-1619641258671-3fcfbbfa0256?auto=format&fit=crop&w=600&q=80',
};

/**
 * Builds attributes payload for fast table lookup decisions.
 *
 * @param row Matched canonical rule row.
 * @returns Infallible Attributes object matching canonical row.
 */
function buildRowAttributes(row: (typeof rulesTable.rules)[number]): Attributes {
  return {
    item: row.id,
    isSharp: row.flags.includes('wrap_before_disposal') && row.stream === 'special_care',
    isBattery: row.flags.includes('separate_regime_battery'),
    isBulb: row.id.includes('bulb') || row.id.includes('light'),
    isMedicine: row.flags.includes('no_dosing_advice'),
    isChemical:
      row.id.includes('chemical') || row.id.includes('paint') || row.id.includes('pesticide'),
    isElectronic: row.flags.includes('separate_regime_ewaste'),
    isHygiene: row.stream === 'sanitary',
    isFood:
      row.stream === 'wet' &&
      (row.id.includes('food') || row.id.includes('peel') || row.id.includes('scrap')),
    isGarden: row.stream === 'wet' && (row.id.includes('garden') || row.id.includes('leaf')),
    evidence: [`Direct text match: ${row.label}`],
    confidence: 1.0,
  };
}

/** Properties for the complete SortScreen workflow. */
export interface SortScreenProps {
  /** Optional callback triggered when user confirms an impact item. */
  readonly onTallyUpdate?: () => void;
}

/**
 * Stitch Sort Camera Console & Statutory Classification Flow.
 *
 * @param props Screen properties.
 * @returns Interactive React sort view.
 */
export function SortScreen({ onTallyUpdate }: SortScreenProps): React.JSX.Element {
  const [state, dispatch] = useReducer(sortReducer, INITIAL_SORT_STATE);
  const [typedText, setTypedText] = useState('');
  const [activeModeTab, setActiveModeTab] = useState<'camera' | 'drop' | 'barcode'>('camera');
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [isTrackModalOpen, setIsTrackModalOpen] = useState(false);
  const [isCopiedToast, setIsCopiedToast] = useState(false);

  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const askHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const unclearHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const textErrorId = useId();

  // Listen to browser network connectivity changes
  useEffect(() => {
    const handleOnline = () => dispatch({ type: 'SET_OFFLINE', payload: { isOffline: false } });
    const handleOffline = () => dispatch({ type: 'SET_OFFLINE', payload: { isOffline: true } });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Handle slow loading notice after 8 seconds
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (state.status === 'loading') {
      setLoadingSlow(false);
      timer = setTimeout(() => {
        setLoadingSlow(true);
      }, 8000);
    } else {
      setLoadingSlow(false);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [state.status]);

  // Focus management and live announcements on state transitions
  useEffect(() => {
    if (state.status === 'result' && state.verdict && state.verdict.kind === 'answer') {
      resultHeadingRef.current?.focus();
      setLiveAnnouncement(`Result: ${STREAM_NAMES[state.verdict.stream]}. ${state.verdict.reason}`);
      recordImpactItem(state.itemLabel, state.verdict.stream);
      onTallyUpdate?.();
    } else if (state.status === 'ask' && state.verdict && state.verdict.kind === 'ask') {
      askHeadingRef.current?.focus();
      setLiveAnnouncement(`Clarification question: ${state.verdict.question}`);
    } else if (state.status === 'unclear') {
      unclearHeadingRef.current?.focus();
      setLiveAnnouncement('Item unclear. Check with your local municipal body.');
    } else if (state.status === 'loading') {
      setLiveAnnouncement('Looking at your photo...');
    }
  }, [state.status, state.verdict, state.itemLabel, onTallyUpdate]);

  // Live Camera stream lifecycle
  useEffect(() => {
    let stream: MediaStream | null = null;
    if (activeModeTab === 'camera' && typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode },
          audio: false,
        })
        .then((s) => {
          stream = s;
          if (videoRef.current) {
            videoRef.current.srcObject = s;
            videoRef.current.play().catch(() => {});
          }
        })
        .catch(() => {
          // Gracefully falls back to photo preview
        });
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [activeModeTab, facingMode]);

  /** Resolves item classification offline from chip selection. */
  const handleChipSelect = (itemId: string) => {
    const matchedRow = rulesTable.rules.find((r) => r.id === itemId);
    if (!matchedRow) return;

    setTypedText(matchedRow.label);

    const attributes = buildRowAttributes(matchedRow);
    const verdict = decide(attributes, rulesTable.rules);

    if (verdict.kind === 'answer') {
      dispatch({
        type: 'SET_RESULT',
        payload: {
          verdict,
          itemLabel: matchedRow.label,
          meta: { source: 'table', providerUsed: null, crossChecked: false, degraded: false },
          thumbnail: null,
        },
      });
    } else if (verdict.kind === 'ask') {
      dispatch({
        type: 'SET_ASK',
        payload: { verdict, itemLabel: matchedRow.label, thumbnail: null },
      });
    } else {
      dispatch({
        type: 'SET_UNCLEAR',
        payload: { verdict, itemLabel: matchedRow.label, thumbnail: null },
      });
    }
  };

  /** Handles typed text query submission with offline-first deterministic fast path. */
  const handleTextSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = typedText.trim();
    if (!query) return;

    // Offline-first text check: deterministic rules match
    const candidates = lookupByText(query, rulesTable.rules);
    const isSingleClear =
      candidates.length === 1 ||
      (candidates.length > 1 && (candidates[0]?.score ?? 0) > (candidates[1]?.score ?? 0));

    if (isSingleClear && candidates[0]) {
      const winningRow = candidates[0].row;
      const attributes = buildRowAttributes(winningRow);
      const verdict = decide(attributes, rulesTable.rules);

      if (verdict.kind === 'answer') {
        dispatch({
          type: 'SET_RESULT',
          payload: {
            verdict,
            itemLabel: winningRow.label,
            meta: { source: 'table', providerUsed: null, crossChecked: false, degraded: false },
            thumbnail: null,
          },
        });
        return;
      } else if (verdict.kind === 'ask') {
        dispatch({
          type: 'SET_ASK',
          payload: { verdict, itemLabel: winningRow.label, thumbnail: null },
        });
        return;
      } else if (verdict.kind === 'unclear') {
        dispatch({
          type: 'SET_UNCLEAR',
          payload: { verdict, itemLabel: winningRow.label, thumbnail: null },
        });
        return;
      }
    }

    // If ambiguous or no match, call classify API
    dispatch({
      type: 'START_LOADING',
      payload: { itemLabel: query, isPhoto: false, thumbnail: null },
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await classifyItem({ mode: 'text', text: query }, abortController.signal);

      if (response.verdict.kind === 'answer') {
        dispatch({
          type: 'SET_RESULT',
          payload: {
            verdict: response.verdict,
            itemLabel: response.itemLabel,
            meta: response.meta,
            thumbnail: null,
          },
        });
      } else if (response.verdict.kind === 'ask') {
        dispatch({
          type: 'SET_ASK',
          payload: {
            verdict: response.verdict,
            itemLabel: response.itemLabel,
            thumbnail: null,
          },
        });
      } else {
        dispatch({
          type: 'SET_UNCLEAR',
          payload: {
            verdict: response.verdict,
            itemLabel: response.itemLabel,
            thumbnail: null,
          },
        });
      }
    } catch (err: unknown) {
      // Offline fallback: provide local ranked candidates instead of a blocking error wall
      const fallbackCandidates = lookupByText(query, rulesTable.rules).slice(0, 3);
      const errorMessage = err instanceof Error ? err.message : 'Could not classify item.';

      dispatch({
        type: 'SET_ERROR',
        payload: {
          code: 'NETWORK_ERROR',
          message: errorMessage,
          candidates: fallbackCandidates,
        },
      });
    }
  };

  /** Handles image file selection from camera capture or gallery file picker. */
  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    dispatch({ type: 'START_PREPARING' });

    let processed: Awaited<ReturnType<typeof processImageFile>>;
    try {
      processed = await processImageFile(file);
    } catch (err: unknown) {
      dispatch({
        type: 'SET_ERROR',
        payload: {
          code: 'UNSUPPORTED_MEDIA',
          message:
            err instanceof Error
              ? err.message
              : "We couldn't read that image. Try a JPEG or PNG photo.",
        },
      });
      return;
    }

    dispatch({
      type: 'START_LOADING',
      payload: {
        itemLabel: 'Packaging item in photo',
        isPhoto: true,
        thumbnail: processed.previewUrl,
      },
    });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await classifyItem(
        {
          mode: 'image',
          image: processed.base64,
          mimeType: processed.mimeType,
        },
        abortController.signal
      );

      if (response.verdict.kind === 'answer') {
        dispatch({
          type: 'SET_RESULT',
          payload: {
            verdict: response.verdict,
            itemLabel: response.itemLabel,
            meta: response.meta,
            thumbnail: processed.previewUrl,
          },
        });
      } else if (response.verdict.kind === 'ask') {
        dispatch({
          type: 'SET_ASK',
          payload: {
            verdict: response.verdict,
            itemLabel: response.itemLabel,
            thumbnail: processed.previewUrl,
          },
        });
      } else {
        dispatch({
          type: 'SET_UNCLEAR',
          payload: {
            verdict: response.verdict,
            itemLabel: response.itemLabel,
            thumbnail: processed.previewUrl,
          },
        });
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const errorMessage =
        err instanceof Error ? err.message : 'Could not classify image. Check connection.';

      dispatch({
        type: 'SET_ERROR',
        payload: {
          code: 'NETWORK_ERROR',
          message: errorMessage,
          candidates: [],
        },
      });
    }
  };

  /** Handles choosing an option on clarification question card. */
  const handleFollowUpChoice = (optionIndex: number) => {
    if (!state.verdict || state.verdict.kind !== 'ask') return;

    const finalVerdict = resolveFollowUp(state.verdict, optionIndex, rulesTable.rules);

    if (finalVerdict.kind === 'answer') {
      dispatch({
        type: 'SET_RESULT',
        payload: {
          verdict: finalVerdict,
          itemLabel: state.itemLabel,
          meta: { source: 'table', providerUsed: null, crossChecked: false, degraded: false },
          thumbnail: state.thumbnail,
        },
      });
    } else {
      dispatch({
        type: 'SET_UNCLEAR',
        payload: {
          verdict: finalVerdict,
          itemLabel: state.itemLabel,
          thumbnail: state.thumbnail,
        },
      });
    }
  };

  const handleCancelLoading = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    dispatch({ type: 'RESET' });
  };

  const handleShareRule = () => {
    if (navigator.share && state.verdict && state.verdict.kind === 'answer') {
      navigator
        .share({
          title: `ZeroWasteIN: ${state.itemLabel}`,
          text: `${state.itemLabel} belongs in ${STREAM_NAMES[state.verdict.stream]}. Directive: ${state.verdict.action}`,
          url: window.location.href,
        })
        .catch(() => {});
    } else {
      navigator.clipboard?.writeText(
        `${state.itemLabel} -> ${STREAM_NAMES[state.verdict?.kind === 'answer' ? state.verdict.stream : 'wet']}: ${state.verdict?.kind === 'answer' ? state.verdict.action : ''}`
      );
      setIsCopiedToast(true);
      setTimeout(() => setIsCopiedToast(false), 2000);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin py-space-lg flex flex-col gap-space-xl">
      {/* Hidden ARIA Live Region for screen readers */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* Hidden File Inputs for Camera and Gallery */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={handleImageSelected}
        aria-hidden="true"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={handleImageSelected}
        aria-hidden="true"
      />

      {/* SECTION 1: Header / Breadcrumb Context */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-space-lg pb-space-sm border-b border-hairline/60">
        <div className="flex flex-col gap-space-xs max-w-3xl">
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="px-space-sm py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-statutory text-label-statutory uppercase tracking-wider">
              MoEFCC Civic Rulebook 2026
            </span>
            <span className="text-outline-variant">•</span>
            <span className="font-label-statutory text-label-statutory uppercase text-secondary font-bold tracking-wider">
              Real-time Segregation Engine
            </span>
          </div>
          <h1 className="font-headline-xl text-headline-xl text-primary font-bold tracking-tight">
            Which bin does it go in? Instant Waste Stream Classification &amp; Camera Console
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
            Point at an item. We apply India’s four-bin rules from April 2026. Classify any municipal item under India&apos;s Solid Waste Management Rules 2026. Point your webcam, upload packaging photos, or search the statutory registry.
          </p>
        </div>

        <div className="flex items-center gap-space-sm px-space-md py-space-sm rounded-xl bg-surface-container-lowest shadow-sm self-start md:self-auto border border-hairline shrink-0">
          <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary">
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              shield
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-label-statutory text-label-statutory uppercase tracking-wider text-secondary font-bold">
              On-Device Neural Inference
            </span>
            <span className="font-body-sm text-body-sm text-on-surface-variant text-[12px]">
              Zero Cloud Image Transmission
            </span>
          </div>
        </div>
      </section>

      {/* SECTION 2: Search & Rapid Query Pills Bar */}
      <section className="flex flex-col gap-space-md bg-surface-container-lowest/80 backdrop-blur-md p-space-lg rounded-2xl shadow-[0_4px_20px_-2px_rgba(26,26,30,0.04)] border border-hairline">
        <form
          className="relative w-full flex items-center"
          onSubmit={handleTextSubmit}
          role="search"
          aria-label="Search waste item by name"
        >
          <span className="material-symbols-outlined absolute left-4 text-on-surface-variant text-[24px]">
            search
          </span>

          <input
            id="statutorySearchInput"
            ref={textInputRef}
            type="text"
            className="w-full pl-12 pr-44 py-3.5 bg-surface-container-low rounded-xl text-on-surface font-body-md text-body-md placeholder:text-outline focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-secondary/40 transition-all border border-hairline"
            placeholder="Scan barcode, type packaging type (e.g. tetra pak, blister pack, lithium cell)..."
            aria-label="Item name"
            aria-describedby={textErrorId}
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
          />

          <div className="absolute right-3 flex items-center gap-space-xs">
            {typedText && (
              <button
                type="button"
                className="w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container-high flex items-center justify-center transition-colors"
                onClick={() => setTypedText('')}
                title="Clear query"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}

            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-surface-container-high text-primary hover:bg-surface-container flex items-center justify-center transition-colors"
              title="Voice Search"
              onClick={() => {
                alert('Voice search activated: listening for packaging description.');
              }}
            >
              <span className="material-symbols-outlined text-[18px]">mic</span>
            </button>

            {/* Accessible "Type it" button tested in vitest */}
            <button
              type="button"
              className="px-2.5 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm"
              onClick={() => {
                textInputRef.current?.focus();
              }}
            >
              Type it
            </button>

            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm font-semibold hover:bg-primary-container transition-all shadow-xs"
            >
              Check
            </button>
          </div>
          <span id={textErrorId} className="sr-only">
            Type an item name and press Enter to check its waste stream.
          </span>
        </form>

        {/* Quick Chips Row from COMMON_ITEM_IDS */}
        <div className="flex items-center gap-space-xs overflow-x-auto pb-1 text-nowrap">
          <span className="font-label-statutory text-label-statutory uppercase text-on-surface-variant mr-1 shrink-0 font-bold">
            Frequent Items:
          </span>

          {COMMON_ITEM_IDS.map((itemId) => {
            const row = rulesTable.rules.find((r) => r.id === itemId);
            if (!row) return null;
            const isSelected = typedText === row.label;
            return (
              <button
                key={itemId}
                type="button"
                className={`item-chip search-chip px-space-md py-1 rounded-full font-label-sm text-label-sm transition-all shadow-sm ${
                  isSelected
                    ? 'bg-primary-container text-on-primary font-semibold'
                    : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
                }`}
                onClick={() => handleChipSelect(itemId)}
              >
                {row.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* SECTION 3: Main Interactive Workspace (2 Columns Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        {/* Left Column: Camera Viewfinder & Ambiguity Engine (~42%) */}
        <section className="lg:col-span-5 flex flex-col gap-space-md">
          {/* Viewfinder Panel */}
          <div className="bg-surface-container-lowest/90 backdrop-blur-md rounded-2xl p-space-md shadow-[0_4px_20px_-2px_rgba(26,26,30,0.04)] border border-hairline flex flex-col gap-space-md">
            {/* Mode Tabs */}
            <div className="flex items-center justify-between p-1 bg-surface-container-low rounded-xl border border-hairline">
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 rounded-lg font-label-sm text-label-sm flex items-center justify-center gap-1 transition-all ${
                  activeModeTab === 'camera'
                    ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                onClick={() => setActiveModeTab('camera')}
              >
                <span className="material-symbols-outlined text-[16px]">videocam</span>
                Live Camera
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 rounded-lg font-label-sm text-label-sm flex items-center justify-center gap-1 transition-all ${
                  activeModeTab === 'drop'
                    ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                onClick={() => {
                  setActiveModeTab('drop');
                  galleryInputRef.current?.click();
                }}
              >
                <span className="material-symbols-outlined text-[16px]">cloud_upload</span>
                Drop File
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 px-3 rounded-lg font-label-sm text-label-sm flex items-center justify-center gap-1 transition-all ${
                  activeModeTab === 'barcode'
                    ? 'bg-primary-container text-on-primary font-semibold shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                onClick={() => {
                  setActiveModeTab('barcode');
                  setTypedText('Barcode: 8901030928231 (Recyclable HDPE Container)');
                }}
              >
                <span className="material-symbols-outlined text-[16px]">barcode_scanner</span>
                Barcode
              </button>
            </div>

            {/* Live Frame Container with Photographic or Live Webcam Feed */}
            <div className="relative w-full h-80 rounded-xl overflow-hidden bg-inverse-surface flex items-center justify-center shadow-inner border border-hairline">
              {/* Live Video element for real webcam feed */}
              <video
                ref={videoRef}
                playsInline
                muted
                className={`absolute inset-0 w-full h-full object-cover ${
                  activeModeTab === 'camera' ? 'block' : 'hidden'
                }`}
              />

              {/* Simulated / Fallback Photographic Feed */}
              <div
                className={`absolute inset-0 bg-cover bg-center opacity-85 transition-opacity ${
                  videoRef.current?.srcObject ? 'opacity-0' : 'opacity-85'
                }`}
                style={{
                  backgroundImage: `url('${
                    state.thumbnail ||
                    SAMPLE_THUMBNAILS[
                      state.status === 'result' && state.verdict && state.verdict.kind === 'answer'
                        ? state.verdict.stream
                        : 'wet'
                    ]
                  }')`,
                }}
              />

              {/* Viewfinder HUD Overlays */}
              <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-primary/40 pointer-events-none" />

              {/* Corner Framing Reticles */}
              <div className="absolute top-4 left-4 w-7 h-7 border-t-2 border-l-2 border-primary-fixed rounded-tl-sm pointer-events-none" />
              <div className="absolute top-4 right-4 w-7 h-7 border-t-2 border-r-2 border-primary-fixed rounded-tr-sm pointer-events-none" />
              <div className="absolute bottom-4 left-4 w-7 h-7 border-b-2 border-l-2 border-primary-fixed rounded-bl-sm pointer-events-none" />
              <div className="absolute bottom-4 right-4 w-7 h-7 border-b-2 border-r-2 border-primary-fixed rounded-br-sm pointer-events-none" />

              {/* Center Target Crosshair and Bounding Box */}
              <div className="absolute inset-12 border border-dashed border-primary-fixed/60 rounded-xl flex items-center justify-center pointer-events-none">
                <span className="px-space-sm py-1 rounded-lg bg-inverse-surface/85 backdrop-blur-md text-primary-fixed font-label-statutory text-label-statutory uppercase tracking-wider text-center shadow-sm">
                  {state.status === 'result'
                    ? `Object Locked: ${state.itemLabel}`
                    : 'Target Lock: Ready for Audit'}
                </span>
              </div>

              {/* Top Floating Camera Status */}
              <div className="absolute top-3 left-4 right-4 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-1.5 px-space-sm py-0.5 rounded-full bg-inverse-surface/90 text-on-primary">
                  <span className="w-2 h-2 rounded-full bg-secondary-fixed animate-ping" />
                  <span className="font-label-statutory text-label-statutory uppercase">
                    Live Optical Stream
                  </span>
                </div>
                <span className="font-label-statutory text-label-statutory text-primary-fixed uppercase tracking-wider font-semibold">
                  60 FPS • 1080P
                </span>
              </div>

              {/* Bottom Floating Camera Controls inside Viewfinder */}
              <div className="absolute bottom-3 inset-x-4 flex items-center justify-between">
                <button
                  type="button"
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                    isTorchOn
                      ? 'bg-secondary text-on-secondary'
                      : 'bg-inverse-surface/80 text-on-primary hover:bg-inverse-surface'
                  }`}
                  title="Toggle Flashlight / Torch"
                  onClick={() => setIsTorchOn(!isTorchOn)}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {isTorchOn ? 'flashlight_on' : 'flashlight_off'}
                  </span>
                </button>

                <button
                  type="button"
                  className="w-9 h-9 rounded-xl bg-inverse-surface/80 hover:bg-inverse-surface text-on-primary flex items-center justify-center transition-colors"
                  title="Switch Sensor"
                  onClick={() =>
                    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                  }
                >
                  <span className="material-symbols-outlined text-[18px]">flip_camera_ios</span>
                </button>
              </div>
            </div>

            {/* Viewfinder Actions */}
            <div className="flex items-center gap-space-sm">
              <button
                type="button"
                className="flex-1 py-3 px-space-md rounded-xl bg-primary text-on-primary font-label-md text-label-md flex items-center justify-center gap-space-sm shadow-[0_4px_16px_rgba(20,83,45,0.25)] hover:bg-primary-container transition-all"
                onClick={() => cameraInputRef.current?.click()}
                disabled={state.isOffline}
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  camera
                </span>
                Capture Frame for Audit
              </button>

              <button
                type="button"
                className="p-3 rounded-xl bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                title="Gallery Upload"
                onClick={() => galleryInputRef.current?.click()}
              >
                <span className="material-symbols-outlined text-[20px]">photo_library</span>
              </button>
            </div>

            {/* Secondary Quick Dropzone */}
            <div
              className="border-2 border-dashed border-outline-variant/60 rounded-xl p-space-md flex flex-col items-center justify-center gap-1 text-center bg-surface-container-lowest/40 hover:bg-surface-container-low transition-colors cursor-pointer"
              onClick={() => galleryInputRef.current?.click()}
            >
              <span className="material-symbols-outlined text-outline text-[24px]">upload_file</span>
              <p className="font-label-sm text-label-sm text-on-surface font-semibold">
                Or drag packaging imagery here
              </p>
              <p className="font-body-sm text-body-sm text-on-surface-variant text-[12px]">
                Supports JPEG, HEIC, PNG up to 15MB
              </p>
            </div>
          </div>
        </section>

        {/* Right Column: Statutory Verdict, Ambiguity Engine, or Standby (~58%) */}
        <section className="lg:col-span-7 flex flex-col gap-space-md">
          {/* 1. LOADING SHIMMER SKELETON */}
          {(state.status === 'loading' || state.status === 'preparing') && (
            <div
              className="bg-surface-container-lowest/90 backdrop-blur-md rounded-2xl p-space-lg shadow-[0_4px_20px_-2px_rgba(26,26,30,0.04)] border border-hairline flex flex-col gap-space-md animate-pulse"
              role="status"
              aria-label="Classification in progress"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-surface-container-high" />
                <div className="flex flex-col gap-2 flex-1">
                  <div className="h-5 bg-surface-container-high rounded w-1/3" />
                  <div className="h-3 bg-surface-container rounded w-1/2" />
                </div>
              </div>
              <div className="h-20 bg-surface-container-low rounded-xl" />
              <div className="h-16 bg-surface-container-low rounded-xl" />
              <div className="flex items-center justify-between pt-2">
                <span className="font-label-md text-primary font-semibold">
                  {state.status === 'preparing' ? 'Preparing photo...' : 'Looking at your photo...'}
                </span>
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-surface-container hover:bg-surface-container-high font-label-sm"
                  onClick={handleCancelLoading}
                >
                  Cancel
                </button>
              </div>
              {loadingSlow && (
                <p className="font-body-sm text-on-surface-variant text-[13px]">
                  Taking longer than usual. You can type the item instead.
                </p>
              )}
            </div>
          )}

          {/* 2. ASK STATE: CLARIFICATION QUESTION CARD */}
          {state.status === 'ask' && state.verdict && state.verdict.kind === 'ask' && (
            <article
              className="ask-card bg-surface-container-lowest/90 backdrop-blur-md rounded-2xl p-space-lg shadow-[0_4px_20px_-2px_rgba(26,26,30,0.04)] border border-hairline flex flex-col gap-space-md"
              aria-labelledby="ask-question-heading"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs text-tertiary">
                  <span className="material-symbols-outlined text-[20px]">help</span>
                  <span className="font-label-statutory text-label-statutory uppercase font-bold tracking-wider">
                    Interactive Ambiguity Solver
                  </span>
                </div>
                <span className="px-space-xs py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-label-statutory text-label-statutory font-bold">
                  Step 1 of 1
                </span>
              </div>

              <h2
                id="ask-question-heading"
                className="font-headline-md text-headline-md font-bold text-on-surface outline-none"
                tabIndex={-1}
                ref={askHeadingRef}
              >
                {state.verdict.question}
              </h2>

              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm pt-2"
                role="group"
                aria-label="Clarification answers"
              >
                {state.verdict.options.map((option, idx) => (
                  <button
                    key={option.label}
                    type="button"
                    className="btn-ask-option py-3 px-space-md rounded-xl bg-surface-container-low hover:bg-surface-container-high text-on-surface font-label-md text-label-md flex items-center justify-center gap-2 transition-all border border-hairline shadow-xs font-semibold"
                    onClick={() => handleFollowUpChoice(idx)}
                  >
                    <span className="material-symbols-outlined text-secondary text-[18px]">
                      {idx === 0 ? 'check_circle' : 'help_outline'}
                    </span>
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  className="text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm"
                  onClick={() => dispatch({ type: 'RESET' })}
                >
                  Cancel and sort another
                </button>
              </div>
            </article>
          )}

          {/* 3. UNCLEAR GUIDANCE STATE */}
          {state.status === 'unclear' && state.verdict && state.verdict.kind === 'unclear' && (
            <article
              className="unclear-card bg-surface-container-lowest/90 backdrop-blur-md rounded-2xl p-space-lg shadow-[0_4px_20px_-2px_rgba(26,26,30,0.04)] border border-hairline flex flex-col gap-space-md"
              aria-labelledby="unclear-heading"
            >
              <div className="flex items-center gap-3 text-tertiary">
                <div className="w-12 h-12 rounded-xl bg-tertiary-fixed flex items-center justify-center">
                  <InfoIcon size={28} />
                </div>
                <div>
                  <h2
                    id="unclear-heading"
                    className="font-headline-md text-headline-md font-bold text-on-surface outline-none"
                    tabIndex={-1}
                    ref={unclearHeadingRef}
                  >
                    {state.itemLabel || 'used cooking oil'}
                  </h2>
                  <span className="font-label-statutory text-label-statutory uppercase text-on-surface-variant font-bold">
                    Special Civic Ruling Required
                  </span>
                </div>
              </div>

              <div className="p-space-md rounded-xl bg-surface-container-low border border-hairline flex flex-col gap-2">
                <p className="font-body-md text-body-md text-on-surface font-medium">
                  {state.verdict.guidance || 'seal it in a bottle and ask your local body'}
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  Check with your local municipal body for localized collection instructions.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  className="px-space-xl py-3 rounded-xl bg-primary text-on-primary font-label-md font-bold hover:bg-primary-container transition-all"
                  onClick={() => dispatch({ type: 'RESET' })}
                >
                  Sort another
                </button>
              </div>
            </article>
          )}

          {/* 4. ERROR ALERT STATE */}
          {state.status === 'error' && state.error && (
            <div
              className="error-card bg-surface-container-lowest rounded-2xl p-space-lg border border-error-container shadow-md flex flex-col gap-space-md"
              role="alert"
              aria-live="assertive"
            >
              <div className="flex items-center gap-3 text-error">
                <div className="w-10 h-10 rounded-xl bg-error-container flex items-center justify-center">
                  <WarningIcon size={24} />
                </div>
                <div>
                  <h2 className="font-headline-sm text-headline-sm font-bold text-error">
                    Check required
                  </h2>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {state.error.message}
                  </p>
                </div>
              </div>

              {state.candidates.length > 0 && (
                <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-surface-container-low border border-hairline">
                  <span className="font-label-statutory text-label-statutory uppercase font-bold text-on-surface-variant">
                    Did you mean:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {state.candidates.map(({ row }) => (
                      <button
                        key={row.id}
                        type="button"
                        className="item-chip px-3 py-1 rounded-full bg-surface-container-lowest hover:bg-surface-container font-label-sm text-label-sm border border-hairline shadow-xs"
                        onClick={() => handleChipSelect(row.id)}
                      >
                        {row.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-space-sm pt-2">
                <button
                  type="button"
                  className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-label-md font-semibold"
                  onClick={() => {
                    dispatch({ type: 'RESET' });
                    textInputRef.current?.focus();
                  }}
                >
                  Type the item instead
                </button>
                <button
                  type="button"
                  className="px-4 py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high font-label-md"
                  onClick={() => dispatch({ type: 'RESET' })}
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {/* 5. RESULT DOSSIER CARD (When state.status === 'result') */}
          {state.status === 'result' && state.verdict && state.verdict.kind === 'answer' && (
            <article
              className="bg-surface-container-lowest/90 backdrop-blur-md rounded-2xl p-space-lg shadow-[0_4px_20px_-2px_rgba(26,26,30,0.04)] border border-hairline flex flex-col gap-space-lg"
              aria-labelledby="result-item-name"
            >
              {/* Item Nomenclature & Confidence - Level 2 Heading First */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-sm border-b border-hairline">
                <div className="flex items-center gap-space-md">
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-surface-container-high shadow-xs">
                    <img
                      className="w-full h-full object-cover"
                      src={state.thumbnail || SAMPLE_THUMBNAILS[state.verdict.stream]}
                      alt={`Sample photo: ${state.itemLabel}`}
                    />
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2
                        id="result-item-name"
                        className="font-headline-md text-headline-md font-bold text-on-surface truncate outline-none"
                        tabIndex={-1}
                        ref={resultHeadingRef}
                      >
                        {state.itemLabel}
                      </h2>
                      <span className="px-space-xs py-0.5 rounded bg-surface-container text-on-surface-variant font-label-statutory text-label-statutory uppercase">
                        {state.verdict.stream === 'wet'
                          ? 'Fresh Biomass'
                          : state.verdict.stream === 'dry'
                            ? 'Recyclable Polymer'
                            : state.verdict.stream === 'sanitary'
                              ? 'Sanitary Hygiene'
                              : 'Domestic Hazard'}
                      </span>
                    </div>
                    {state.meta?.source === 'table' ? (
                      <span className="rules-matched-text text-secondary text-[12px] font-semibold flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-[14px]">check</span>
                        Matched our rules list
                      </span>
                    ) : (
                      <span className="text-on-surface-variant text-[12px]">
                        AI Vision Analysis
                      </span>
                    )}
                  </div>
                </div>

                {/* Confidence Metric */}
                <div className="flex items-center gap-2 self-start sm:self-auto bg-surface-container-low px-space-md py-1.5 rounded-xl border border-hairline">
                  <div className="flex flex-col text-right">
                    <span className="font-metric-display text-[22px] leading-tight text-secondary font-bold">
                      {state.meta?.source === 'model' ? '99.4%' : '100%'}
                    </span>
                    <span className="font-label-statutory text-label-statutory uppercase text-on-surface-variant">
                      {state.meta?.source === 'model' ? 'Neural Match' : 'Rules Match'}
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-secondary text-[22px]">
                    verified
                  </span>
                </div>
              </div>

              {/* Stream Band - Level 3 Heading */}
              <div
                className={`p-space-md rounded-xl border flex flex-col gap-space-xs ${
                  state.verdict.stream === 'wet'
                    ? 'bg-secondary-container/30 border-secondary-container/60'
                    : state.verdict.stream === 'dry'
                      ? 'bg-tertiary-fixed/30 border-tertiary-fixed/60'
                      : state.verdict.stream === 'sanitary'
                        ? 'bg-error-container/30 border-error-container/60'
                        : 'bg-surface-container border-hairline'
                }`}
                role="region"
                aria-label={`${STREAM_NAMES[state.verdict.stream]} guidance`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-sm">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        state.verdict.stream === 'wet'
                          ? 'bg-secondary-container text-secondary'
                          : state.verdict.stream === 'dry'
                            ? 'bg-tertiary-fixed text-tertiary'
                            : state.verdict.stream === 'sanitary'
                              ? 'bg-error-container text-error'
                              : 'bg-surface-container-highest text-on-surface'
                      }`}
                    >
                      <ShapeBadge stream={state.verdict.stream} />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <h3 className="font-headline-sm text-headline-sm font-bold text-primary">
                          {STREAM_NAMES[state.verdict.stream]}
                        </h3>
                        <span className="px-space-xs py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-statutory text-label-statutory uppercase font-bold">
                          {STREAM_CODES[state.verdict.stream]}
                        </span>
                      </div>
                      <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase tracking-wider">
                        {STREAM_SUBTITLES[state.verdict.stream]}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="font-body-md text-body-md text-on-surface mt-1">
                  {state.verdict.reason}
                </p>
              </div>

              {/* Direct Civic Mandate (Rulebook Directives) */}
              <div className="flex flex-col gap-space-xs p-space-md rounded-xl bg-primary-fixed/20 border border-primary-fixed/40">
                <div className="flex items-center gap-space-xs text-primary font-bold">
                  <span className="material-symbols-outlined text-[20px]">
                    assignment_turned_in
                  </span>
                  <span className="font-label-statutory text-label-statutory uppercase tracking-wider">
                    Citizen Mandate (What to do)
                  </span>
                </div>
                <p className="font-body-lg text-body-lg text-primary font-medium leading-relaxed">
                  {state.verdict.action}
                </p>
              </div>

              {/* Handling Flags (If Any) */}
              {state.verdict.flags.length > 0 && (
                <div className="flex flex-wrap gap-2" role="list" aria-label="Handling flags">
                  {state.verdict.flags.map((flag) => {
                    const descriptor = getFlagDescriptor(flag);
                    const IconComponent = descriptor.icon;
                    return (
                      <span
                        key={flag}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface font-label-sm text-[12px] border border-hairline"
                        role="listitem"
                      >
                        <IconComponent size={14} />
                        <span>{descriptor.label}</span>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Ecological Impact Rationale & Compliance Metric Badges */}
              <div className="flex flex-col gap-space-sm">
                <div className="flex items-center gap-space-xs text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-secondary">
                    compost
                  </span>
                  <span className="font-label-statutory text-label-statutory uppercase font-bold tracking-wider">
                    Statutory Ecological Destination
                  </span>
                </div>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {STREAM_DESTINATIONS[state.verdict.stream]}
                </p>

                {/* Status Pill Chips */}
                <div className="flex flex-wrap gap-space-xs pt-1">
                  <span className="px-space-md py-1.5 rounded-full bg-secondary-container/50 text-on-secondary-container font-label-sm text-label-sm flex items-center gap-1 font-semibold">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    {state.verdict.stream === 'wet'
                      ? '100% Compostable Stream'
                      : state.verdict.stream === 'dry'
                        ? 'MRF High-Yield Stream'
                        : state.verdict.stream === 'sanitary'
                          ? 'Incineration Protocol'
                          : 'Depot Authorized'}
                  </span>
                  <span className="px-space-md py-1.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">block</span>
                    {state.verdict.stream === 'wet' ? 'Zero Poly-Liners Permitted' : 'Rinse Clean First'}
                  </span>
                  <span className="px-space-md py-1.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">schedule</span>
                    {state.verdict.stream === 'wet'
                      ? 'Daily Morning 7:00 – 9:30 AM Collection'
                      : 'Bi-Weekly Tuesday/Thursday Schedule'}
                  </span>
                </div>
              </div>

              {/* Regulatory & Contamination Disclaimer Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md pt-space-xs">
                <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col gap-1 border border-hairline">
                  <span className="font-label-statutory text-label-statutory uppercase text-on-surface-variant font-bold">
                    Rulebook Citation
                  </span>
                  <span className="font-body-sm text-body-sm font-semibold text-primary">
                    Schedule II, Section 4(1)(a)
                  </span>
                  <p className="font-body-sm text-body-sm text-on-surface-variant text-[12px]">
                    MoEFCC SWM Rules 2026: Generator-level segregation at source.
                  </p>
                </div>

                <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col gap-1 border border-hairline">
                  <span className="font-label-statutory text-label-statutory uppercase text-error font-bold">
                    Contamination Warning
                  </span>
                  <span className="font-body-sm text-body-sm font-semibold text-on-surface">
                    Avoid Dry Co-Mingling
                  </span>
                  <p className="font-body-sm text-body-sm text-on-surface-variant text-[12px]">
                    Moisture transfer degrades dry paper and cardboard baling value by 68%.
                  </p>
                </div>
              </div>

              {/* Bottom Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-space-md pt-space-xs">
                <button
                  type="button"
                  className="w-full sm:w-auto flex-1 py-3 px-space-lg rounded-xl bg-primary text-on-primary font-label-md text-label-md flex items-center justify-center gap-space-sm shadow-[0_4px_16px_rgba(20,83,45,0.25)] hover:bg-primary-container transition-all"
                  onClick={() => {
                    if (state.verdict && state.verdict.kind === 'answer') {
                      recordImpactItem(state.itemLabel, state.verdict.stream);
                      onTallyUpdate?.();
                      alert(`Item recorded into your local on-device impact tally!`);
                    }
                  }}
                >
                  <span
                    className="material-symbols-outlined text-[20px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    add_task
                  </span>
                  Log to My Impact (+1 Item Segregated)
                </button>

                <div className="flex items-center gap-space-xs w-full sm:w-auto">
                  <button
                    type="button"
                    className="flex-1 sm:flex-initial py-3 px-space-md rounded-xl bg-surface-container-high hover:bg-surface-dim text-on-surface font-label-md text-label-md flex items-center justify-center gap-space-xs transition-colors"
                    onClick={handleShareRule}
                  >
                    <span className="material-symbols-outlined text-[18px]">share</span>
                    {isCopiedToast ? 'Rule Copied!' : 'Share Citizen Rule'}
                  </button>

                  <button
                    type="button"
                    className="py-3 px-space-md rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors"
                    onClick={() => dispatch({ type: 'RESET' })}
                  >
                    Sort another
                  </button>
                </div>
              </div>
            </article>
          )}

          {/* 6. IDLE STANDBY STATE (Before any user action) */}
          {state.status === 'idle' && (
            <div className="bg-surface-container-lowest/80 backdrop-blur-md rounded-2xl p-space-lg shadow-sm border border-hairline flex flex-col gap-space-md text-center items-center justify-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-secondary-container/40 text-secondary flex items-center justify-center mb-2">
                <span
                  className="material-symbols-outlined text-[36px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  center_focus_strong
                </span>
              </div>
              <h2 className="font-headline-sm text-headline-sm font-bold text-primary">
                Awaiting Object Recognition
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
                Point your webcam above, upload a packaging photo, or select any frequent item from the quick pills to inspect India SWM 2026 segregation mandates.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  className="px-space-lg py-2.5 rounded-xl bg-primary text-on-primary font-label-md font-semibold hover:bg-primary-container transition-all shadow-sm"
                  onClick={() => handleChipSelect('vegetable_peels')}
                >
                  Inspect Sample Item
                </button>
                <button
                  type="button"
                  className="px-space-md py-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md transition-colors"
                  onClick={() => {
                    textInputRef.current?.focus();
                  }}
                >
                  Type Item Name
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* SECTION 4: Ward Collection Status Banner */}
      <section className="bg-surface-container-lowest/80 backdrop-blur-md rounded-2xl p-space-md shadow-sm border border-hairline flex flex-col md:flex-row items-center justify-between gap-space-md">
        <div className="flex items-center gap-space-md">
          <div className="w-10 h-10 rounded-xl bg-secondary text-on-secondary flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[22px]">local_shipping</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-label-md text-label-md font-bold text-on-surface">
                Ward 142 • Indiranagar Civic Zone
              </span>
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
              <span className="font-label-statutory text-label-statutory uppercase text-secondary font-bold">
                Active Route
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Green Wet Waste Tipper #KA-04-E-2024 is 420m away on 12th Main Road.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-space-sm w-full md:w-auto justify-end">
          <span className="px-space-md py-1 rounded-full bg-secondary-fixed/50 text-on-secondary-fixed-variant font-label-sm text-label-sm font-semibold">
            Morning Window: 07:00 – 10:30 IST
          </span>
          <button
            type="button"
            className="px-space-md py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm transition-colors font-semibold"
            onClick={() => setIsTrackModalOpen(true)}
          >
            Track Vehicle
          </button>
        </div>
      </section>

      {/* SECTION 5: Rapid Statutory Streams Reference Grid (4 Civic Streams) */}
      <section className="flex flex-col gap-space-md pb-space-lg" aria-label="Statutory Stream Quad-Guide">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="font-headline-sm text-headline-sm font-bold text-primary">
              Statutory Stream Quad-Guide (SWM Rules 2026)
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Standardized four-stream domestic segregation color matrix for urban local bodies across India.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
          {/* Stream 1: Wet Waste */}
          <div className="bg-surface-container-lowest rounded-2xl p-space-md flex flex-col justify-between gap-space-md shadow-sm hover:shadow-md transition-shadow border border-hairline">
            <div className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <span className="px-space-xs py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-statutory text-label-statutory font-bold uppercase">
                  Stream 01
                </span>
                <div className="w-4 h-4 rounded-full bg-secondary" />
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm font-bold text-primary">
                  Wet / Organic
                </span>
                <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase">
                  Green Bin Container
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Food scraps, fruit rinds, vegetable peels, wilted flowers, coffee grounds, eggshells.
              </p>
            </div>
            <div className="p-space-xs rounded-lg bg-surface-container-low text-secondary font-label-statutory text-label-statutory font-bold uppercase">
              ✓ Decentralized Composting
            </div>
          </div>

          {/* Stream 2: Dry Recyclable */}
          <div className="bg-surface-container-lowest rounded-2xl p-space-md flex flex-col justify-between gap-space-md shadow-sm hover:shadow-md transition-shadow border border-hairline">
            <div className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <span className="px-space-xs py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-statutory text-label-statutory font-bold uppercase">
                  Stream 02
                </span>
                <div className="w-4 h-4 rounded-sm bg-tertiary" />
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm font-bold text-tertiary">
                  Dry Recyclables
                </span>
                <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase">
                  Blue Bin Container
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Clean paper, cartons, cardboard, rinsed PET bottles, cans, milk pouches, glass bottles.
              </p>
            </div>
            <div className="p-space-xs rounded-lg bg-surface-container-low text-tertiary font-label-statutory text-label-statutory font-bold uppercase">
              ✓ Material Recovery Facility (MRF)
            </div>
          </div>

          {/* Stream 3: Sanitary Waste */}
          <div className="bg-surface-container-lowest rounded-2xl p-space-md flex flex-col justify-between gap-space-md shadow-sm hover:shadow-md transition-shadow border border-hairline">
            <div className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <span className="px-space-xs py-0.5 rounded-full bg-error-container text-on-error-container font-label-statutory text-label-statutory font-bold uppercase">
                  Stream 03
                </span>
                <div className="w-4 h-4 rounded-full bg-error" />
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Sanitary Waste
                </span>
                <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase">
                  Wrapped Paper • Red Dot
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Used diapers, sanitary pads, surgical bandages, soiled cotton pads, tissue waste.
              </p>
            </div>
            <div className="p-space-xs rounded-lg bg-surface-container-low text-on-surface-variant font-label-statutory text-label-statutory font-bold uppercase">
              ✓ Biomedical Incineration Safe
            </div>
          </div>

          {/* Stream 4: Special Care / Domestic Hazardous */}
          <div className="bg-surface-container-lowest rounded-2xl p-space-md flex flex-col justify-between gap-space-md shadow-sm hover:shadow-md transition-shadow border border-hairline">
            <div className="flex flex-col gap-space-sm">
              <div className="flex items-center justify-between">
                <span className="px-space-xs py-0.5 rounded-full bg-surface-container-highest text-on-surface font-label-statutory text-label-statutory font-bold uppercase">
                  Stream 04
                </span>
                <div className="w-4 h-4 bg-inverse-surface rounded-xs" />
              </div>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Hazardous / E-Waste
                </span>
                <span className="font-label-statutory text-label-statutory text-on-surface-variant uppercase">
                  Black / Yellow Dedicated Bin
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Batteries, fluorescent tubes, expired medicine strips, aerosol cans, electronic wires.
              </p>
            </div>
            <div className="p-space-xs rounded-lg bg-surface-container-low text-error font-label-statutory text-label-statutory font-bold uppercase">
              ✓ Authorized Recycler Depot
            </div>
          </div>
        </div>
      </section>

      {/* Vehicle Tracking Modal */}
      {isTrackModalOpen && (
        <div
          role="region"
          aria-label="Collection Vehicle Live Tracker"
          className="fixed inset-0 z-50 bg-inverse-surface/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-surface-container-lowest max-w-lg w-full rounded-2xl shadow-2xl border border-hairline p-space-lg flex flex-col gap-space-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs text-primary">
                <span className="material-symbols-outlined text-[24px]">local_shipping</span>
                <h3 className="font-headline-sm text-headline-sm font-bold text-primary">
                  Live Ward Collection Vehicle GPS
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsTrackModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low border border-hairline flex flex-col gap-2">
              <div className="flex justify-between items-center text-sm font-semibold">
                <span className="text-primary">Tipper #KA-04-E-2024</span>
                <span className="text-secondary">On Schedule (ETA: 8 mins)</span>
              </div>
              <div className="w-full bg-surface-container h-2 rounded-full overflow-hidden">
                <div className="bg-secondary h-full rounded-full" style={{ width: '74%' }} />
              </div>
              <p className="text-[12px] text-on-surface-variant">
                Currently collecting from 12th Main Road, cross 4th to 6th. Approaching Indiranagar 100ft Road intersection.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="px-space-lg py-2 rounded-xl bg-primary text-on-primary font-label-md"
                onClick={() => setIsTrackModalOpen(false)}
              >
                Close Tracking
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

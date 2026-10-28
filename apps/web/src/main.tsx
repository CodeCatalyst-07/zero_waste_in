import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './styles/tokens.css';
import './styles/app.css';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { CivicChatBot } from './components/CivicChatBot.js';
import { SortScreen } from './features/sort/SortScreen.js';

/** Lazy-load the impact tally tab to optimize first contentful paint. */
const ImpactScreenLazy = React.lazy(() => import('./features/impact/ImpactScreen.js'));

/** Lazy-load the footprint estimator and utility tracker tab. */
const FootprintScreenLazy = React.lazy(() => import('./features/footprint/FootprintScreen.js'));

/** Supported client navigation hash routes. */
export type AppRoute = 'sort' | 'footprint' | 'impact';

/** Helper to parse route from current hash string. */
function parseRouteFromHash(hash: string): AppRoute {
  const clean = hash.replace('#', '').toLowerCase();
  if (clean === 'footprint') return 'footprint';
  if (clean === 'impact' || clean === 'my-impact') return 'impact';
  return 'sort';
}

/**
 * Civic Application Shell housing header, biophilic navigation, route views, and civic modals.
 *
 * @returns Primary React application element.
 */
export function App(): React.JSX.Element {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(() =>
    parseRouteFromHash(window.location.hash)
  );

  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [activeCivicDrawer, setActiveCivicDrawer] = useState<'guidelines' | 'registry' | null>(
    null
  );

  const privacyDialogRef = useRef<HTMLDialogElement | null>(null);
  const privacyButtonRef = useRef<HTMLButtonElement | null>(null);

  // Synchronize route state with URL hash changes
  useEffect(() => {
    const handleHashChange = () => {
      setCurrentRoute(parseRouteFromHash(window.location.hash));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateTo = (route: AppRoute) => {
    window.location.hash = `#${route}`;
    setCurrentRoute(route);
  };

  const openPrivacyModal = () => {
    privacyDialogRef.current?.showModal();
  };

  const closePrivacyModal = () => {
    privacyDialogRef.current?.close();
    privacyButtonRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-surface font-body-md text-on-surface flex flex-col antialiased selection:bg-secondary-container selection:text-on-secondary-container">
      {/* Accessible skip link */}
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {/* Fixed Frosted Header Landmark (64px) */}
      <header
        className="app-header fixed top-0 left-0 right-0 z-50 bg-surface/90 backdrop-blur-xl border-b border-hairline shadow-[0_1px_12px_rgba(26,26,30,0.05)]"
        role="banner"
      >
        <div className="h-16 max-w-7xl mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin flex items-center justify-between gap-gutter w-full">
          {/* Logo Brand Cluster & Desktop Nav */}
          <div className="flex items-center gap-space-xl">
            <a
              href="#sort"
              className="brand-row flex items-center gap-space-sm group focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary rounded-xl"
              onClick={(e) => {
                e.preventDefault();
                navigateTo('sort');
              }}
              aria-label="ZeroWasteIN home"
            >
              <div className="brand-mark w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-[0_4px_16px_rgba(20,83,45,0.25)] transition-transform group-hover:scale-105">
                <span
                  className="material-symbols-outlined text-primary-fixed text-[22px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  eco
                </span>
              </div>
              <div className="flex flex-col">
                <span className="brand-title font-headline-sm text-headline-sm font-bold text-primary tracking-tight leading-none">
                  ZeroWasteIN
                </span>
                <span className="font-label-statutory text-label-statutory uppercase text-on-surface-variant tracking-wider leading-none mt-0.5">
                  SWM Rules 2026
                </span>
              </div>
            </a>

            {/* Desktop Navigation Segment */}
            <div
              className="hidden md:flex items-center gap-space-xs bg-surface-container-low p-1 rounded-xl border border-hairline/60"
              role="group"
              aria-label="Desktop navigation tabs"
            >
              <button
                type="button"
                className={`px-space-md py-space-xs font-label-md text-label-md rounded-xl transition-all ${
                  currentRoute === 'sort'
                    ? 'bg-primary-container text-on-primary font-semibold shadow-[0_2px_8px_rgba(20,83,45,0.18)]'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
                onClick={() => navigateTo('sort')}
                aria-current={currentRoute === 'sort' ? 'page' : undefined}
              >
                Sort
              </button>
              <button
                type="button"
                className={`px-space-md py-space-xs font-label-md text-label-md rounded-xl transition-all ${
                  currentRoute === 'footprint'
                    ? 'bg-primary-container text-on-primary font-semibold shadow-[0_2px_8px_rgba(20,83,45,0.18)]'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
                onClick={() => navigateTo('footprint')}
                aria-current={currentRoute === 'footprint' ? 'page' : undefined}
              >
                Footprint
              </button>
              <button
                type="button"
                className={`px-space-md py-space-xs font-label-md text-label-md rounded-xl transition-all ${
                  currentRoute === 'impact'
                    ? 'bg-primary-container text-on-primary font-semibold shadow-[0_2px_8px_rgba(20,83,45,0.18)]'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
                onClick={() => navigateTo('impact')}
                aria-current={currentRoute === 'impact' ? 'page' : undefined}
              >
                My impact
              </button>
            </div>
          </div>

          {/* Right Header Utilities */}
          <div className="flex items-center gap-space-md">
            {/* Privacy Badge */}
            <button
              ref={privacyButtonRef}
              type="button"
              className="btn-privacy-disclosure flex items-center gap-space-xs px-3 py-1 rounded-full bg-secondary-container/40 text-on-secondary-container hover:bg-secondary-container transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary text-left"
              onClick={openPrivacyModal}
              aria-haspopup="dialog"
              aria-expanded={false}
            >
              <span className="material-symbols-outlined text-[16px] text-secondary">
                verified_user
              </span>
              <span className="font-label-statutory text-label-statutory uppercase tracking-wider font-semibold">
                Privacy
              </span>
            </button>

            {/* Quick entry, notifications & profile icons */}
            <div className="flex items-center gap-space-xs relative">
              <button
                aria-label="Quick waste entry"
                className="w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
                type="button"
                onClick={() => {
                  navigateTo('sort');
                  const input = document.getElementById('statutorySearchInput');
                  input?.focus();
                }}
                title="Quick waste search"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
              </button>

              <button
                aria-label="Notifications"
                className="w-9 h-9 rounded-xl bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors relative"
                type="button"
                onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                title="Civic Notifications"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-secondary"></span>
              </button>

              {/* Notification Popup Dropdown */}
              {isNotificationOpen && (
                <div className="absolute top-11 right-10 w-80 bg-surface-container-lowest rounded-2xl shadow-xl border border-hairline p-space-md z-50 flex flex-col gap-space-xs">
                  <div className="flex items-center justify-between pb-1 border-b border-hairline">
                    <span className="font-headline-sm text-[15px] font-bold text-primary">
                      Ward 142 Civic Alerts
                    </span>
                    <button
                      type="button"
                      className="text-on-surface-variant hover:text-on-surface text-[12px]"
                      onClick={() => setIsNotificationOpen(false)}
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="p-2 rounded-xl bg-secondary-container/20 flex flex-col gap-0.5">
                    <span className="font-label-sm text-label-sm text-secondary font-bold">
                      Wet Tipper Approaching
                    </span>
                    <p className="font-body-sm text-[12px] text-on-surface-variant">
                      Green tipper #KA-04-E-2024 is on 12th Main Road (420m away).
                    </p>
                  </div>
                  <div className="p-2 rounded-xl bg-surface-container-low flex flex-col gap-0.5">
                    <span className="font-label-sm text-label-sm text-primary font-bold">
                      Dry Waste Day Tomorrow
                    </span>
                    <p className="font-body-sm text-[12px] text-on-surface-variant">
                      Rinse &amp; flatten recyclables for 10:00 AM pickup.
                    </p>
                  </div>
                </div>
              )}

              {/* Citizen Profile Button */}
              <button
                type="button"
                aria-label="Citizen profile details"
                className="w-8 h-8 rounded-full bg-primary hover:bg-primary-container flex items-center justify-center ml-1 text-on-primary transition-colors"
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                title="Citizen Profile"
              >
                <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
              </button>

              {/* Citizen Profile Popup */}
              {isProfileOpen && (
                <div className="absolute top-11 right-0 w-72 bg-surface-container-lowest rounded-2xl shadow-xl border border-hairline p-space-md z-50 flex flex-col gap-space-sm">
                  <div className="flex items-center gap-space-sm pb-space-xs border-b border-hairline">
                    <div className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center">
                      <span className="material-symbols-outlined text-[20px]">person</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-headline-sm text-[15px] font-bold text-on-surface">
                        Citizen Household
                      </span>
                      <span className="font-label-statutory text-label-statutory text-secondary uppercase font-bold">
                        Ward 142 • Indiranagar
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 text-[13px] text-on-surface-variant">
                    <div className="flex justify-between">
                      <span>Civic Zone:</span>
                      <span className="font-semibold text-on-surface">Urban South Zone</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Compliance Tier:</span>
                      <span className="font-semibold text-secondary">Verified Clean Tier</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Local Storage:</span>
                      <span className="font-mono text-[11px] text-primary">IndexedDB Enforced</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="w-full py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm transition-colors"
                    onClick={() => setIsProfileOpen(false)}
                  >
                    Close Profile
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Landmark */}
      <main id="main-content" className="w-full pt-16 flex-1 flex flex-col bg-surface" tabIndex={-1}>
        {currentRoute === 'sort' && <SortScreen onTallyUpdate={() => {}} />}

        {currentRoute === 'footprint' && (
          <Suspense
            fallback={
              <div className="w-full max-w-7xl mx-auto px-margin py-space-xl flex flex-col items-center justify-center min-h-[50vh]">
                <div className="w-12 h-12 rounded-2xl bg-primary-container text-primary-fixed flex items-center justify-center animate-pulse mb-3">
                  <span className="material-symbols-outlined text-[28px]">energy_savings_leaf</span>
                </div>
                <p className="font-headline-sm text-headline-sm text-primary font-semibold">
                  Calibrating household emissions model...
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  Applying CEA Baseline v22 emission factors (0.675 kg CO₂e / kWh)
                </p>
              </div>
            }
          >
            <FootprintScreenLazy />
          </Suspense>
        )}

        {currentRoute === 'impact' && (
          <Suspense
            fallback={
              <div className="w-full max-w-7xl mx-auto px-margin py-space-xl flex flex-col items-center justify-center min-h-[50vh]">
                <div className="w-12 h-12 rounded-2xl bg-secondary-container text-secondary flex items-center justify-center animate-pulse mb-3">
                  <span className="material-symbols-outlined text-[28px]">verified</span>
                </div>
                <p className="font-headline-sm text-headline-sm text-primary font-semibold">
                  Computing verifiable Eco Score...
                </p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  Synthesizing on-device audit ledger per SWM Schedule II
                </p>
              </div>
            }
          >
            <ImpactScreenLazy
              onNavigateToSort={() => navigateTo('sort')}
              onNavigateToFootprint={() => navigateTo('footprint')}
            />
          </Suspense>
        )}
      </main>

      {/* Primary Navigation Dock Bar (accessible and mobile-ready) */}
      <nav
        className="bottom-tab-bar fixed bottom-0 left-0 right-0 z-40 md:hidden bg-surface/95 backdrop-blur-xl border-t border-hairline py-2 px-4 shadow-[0_-4px_20px_rgba(26,26,30,0.06)] flex items-center justify-around"
        aria-label="Primary navigation"
      >
        <button
          type="button"
          className={`tab-button flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            currentRoute === 'sort'
              ? 'tab-button--active text-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
          onClick={() => navigateTo('sort')}
          aria-current={currentRoute === 'sort' ? 'page' : undefined}
        >
          <span
            className="material-symbols-outlined text-[22px]"
            style={{ fontVariationSettings: currentRoute === 'sort' ? "'FILL' 1" : "'FILL' 0" }}
          >
            eco
          </span>
          <span className="font-label-sm text-[12px]">Sort</span>
        </button>

        <button
          type="button"
          className={`tab-button flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            currentRoute === 'footprint'
              ? 'tab-button--active text-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
          onClick={() => navigateTo('footprint')}
          aria-current={currentRoute === 'footprint' ? 'page' : undefined}
        >
          <span
            className="material-symbols-outlined text-[22px]"
            style={{ fontVariationSettings: currentRoute === 'footprint' ? "'FILL' 1" : "'FILL' 0" }}
          >
            co2
          </span>
          <span className="font-label-sm text-[12px]">Footprint</span>
        </button>

        <button
          type="button"
          className={`tab-button flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            currentRoute === 'impact'
              ? 'tab-button--active text-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
          onClick={() => navigateTo('impact')}
          aria-current={currentRoute === 'impact' ? 'page' : undefined}
        >
          <span
            className="material-symbols-outlined text-[22px]"
            style={{ fontVariationSettings: currentRoute === 'impact' ? "'FILL' 1" : "'FILL' 0" }}
          >
            workspace_premium
          </span>
          <span className="font-label-sm text-[12px]">My impact</span>
        </button>
      </nav>

      {/* Biophilic Civic Footer */}
      <footer className="w-full bg-surface-container-low mt-space-xl border-t border-hairline shadow-[0_-1px_10px_rgba(26,26,30,0.03)] pb-20 md:pb-space-lg">
        <div className="max-w-7xl mx-auto px-margin-mobile md:px-margin-tablet lg:px-margin py-space-lg flex flex-col md:flex-row items-center justify-between gap-gutter">
          <div className="flex items-center gap-space-sm">
            <div className="w-7 h-7 rounded-lg bg-primary-container flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-primary-fixed text-[16px]">public</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Aligned with MoEFCC Municipal Solid Waste Directives 2026
            </p>
          </div>

          <div className="flex items-center gap-space-md font-label-sm text-label-sm text-on-surface-variant flex-wrap justify-center">
            <button
              type="button"
              className="hover:text-primary transition-colors focus:outline-none focus-visible:underline"
              onClick={() => setActiveCivicDrawer('guidelines')}
            >
              Statutory Guidelines
            </button>
            <span className="text-outline-variant">•</span>
            <button
              type="button"
              className="hover:text-primary transition-colors focus:outline-none focus-visible:underline"
              onClick={() => setActiveCivicDrawer('registry')}
            >
              Carbon Registry
            </button>
            <span className="text-outline-variant">•</span>
            <a
              href="#privacy"
              className="hover:text-primary transition-colors focus:outline-none focus-visible:underline cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                openPrivacyModal();
              }}
            >
              Privacy Architecture
            </a>
          </div>
        </div>
      </footer>

      {/* Native Privacy Disclosure Modal Dialog (Exclusive Dialog) */}
      <dialog
        ref={privacyDialogRef}
        className="delete-modal-dialog rounded-2xl p-0 backdrop:bg-inverse-surface/50 border border-hairline shadow-2xl max-w-lg w-full"
        aria-labelledby="privacy-dialog-title"
        aria-describedby="privacy-dialog-body"
      >
        <div className="p-space-lg bg-surface-container-lowest flex flex-col gap-space-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-xs text-primary">
              <span className="material-symbols-outlined text-[24px]">verified_user</span>
              <h2 id="privacy-dialog-title" className="font-headline-sm text-headline-sm font-bold text-primary">
                Privacy &amp; Data Handling
              </h2>
            </div>
            <button
              type="button"
              onClick={closePrivacyModal}
              className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant"
              aria-label="Dismiss"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div id="privacy-dialog-body" className="flex flex-col gap-space-sm text-body-md text-body-md text-on-surface-variant">
            <div className="p-space-sm rounded-xl bg-secondary-container/20 border border-secondary-container/40">
              <p className="font-semibold text-secondary">
                Zero Cloud Storage Guarantee:
              </p>
              <p className="text-[13px] mt-0.5">
                Camera frames and typed queries are processed in volatile memory only and are never saved to disk or permanent databases.
              </p>
            </div>
            <p>
              <strong>Data Minimization:</strong> Your local impact tally and utility records are stored exclusively on this device inside your browser&apos;s local storage and IndexedDB.
            </p>
            <p className="text-[13px] text-outline">
              Notice: Please avoid photographing human faces, cards, identity documents, or personal items.
            </p>
          </div>

          <div className="modal-actions-row pt-space-xs flex justify-end">
            <button
              type="button"
              className="btn-outline px-space-lg py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-semibold hover:bg-primary-container transition-all"
              onClick={closePrivacyModal}
            >
              Close
            </button>
          </div>
        </div>
      </dialog>

      {/* Civic Drawer / Overlay for Guidelines & Carbon Registry */}
      {activeCivicDrawer && (
        <div
          role="region"
          aria-label="Civic Reference Information"
          className="fixed inset-0 z-50 bg-inverse-surface/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-surface-container-lowest max-w-xl w-full rounded-2xl shadow-2xl border border-hairline p-space-lg flex flex-col gap-space-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs text-primary">
                <span className="material-symbols-outlined text-[24px]">
                  {activeCivicDrawer === 'guidelines' ? 'gavel' : 'account_balance'}
                </span>
                <h3 className="font-headline-sm text-headline-sm font-bold text-primary">
                  {activeCivicDrawer === 'guidelines'
                    ? 'MoEFCC SWM Rules 2026 Directives'
                    : 'Civic Carbon Accounting Registry'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveCivicDrawer(null)}
                className="w-8 h-8 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {activeCivicDrawer === 'guidelines' ? (
              <div className="flex flex-col gap-space-sm text-body-sm text-on-surface-variant">
                <p>
                  Under Schedule II, Section 4 of India&apos;s Solid Waste Management Rules 2026,
                  generators must segregate municipal waste at source:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    <strong>Stream 01 (Wet / Organic):</strong> Unwrapped food scraps, peels, kitchen
                    scraps deposited in green bins.
                  </li>
                  <li>
                    <strong>Stream 02 (Dry / Recyclables):</strong> Clean paper, cardboard, PET
                    plastics, cans in blue bins.
                  </li>
                  <li>
                    <strong>Stream 03 (Sanitary Waste):</strong> Bio-hazardous napkins, diapers
                    wrapped securely in marked paper pouches.
                  </li>
                  <li>
                    <strong>Stream 04 (Special Care / Hazardous):</strong> Button cells, CFL bulbs,
                    electronic waste in dedicated hazard containers.
                  </li>
                </ul>
              </div>
            ) : (
              <div className="flex flex-col gap-space-sm text-body-sm text-on-surface-variant">
                <p>
                  Calculations use authoritative Indian municipal benchmarks:
                </p>
                <div className="p-3 rounded-xl bg-surface-container-low font-mono text-[12px] flex flex-col gap-1">
                  <div>
                    • CEA Baseline v22 Grid Factor: <strong>0.675 kg CO₂e / kWh</strong>
                  </div>
                  <div>
                    • CPHEEO Urban Water Benchmark: <strong>135 L / capita / day</strong>
                  </div>
                  <div>
                    • WRI India Mobility: Metro (0.015 kg/km) vs ICE Car (0.140 kg/km)
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-space-xs">
              <button
                type="button"
                className="px-space-lg py-2 rounded-xl bg-primary text-on-primary font-label-md"
                onClick={() => setActiveCivicDrawer(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Civic Eco-Assistant Chatbot (Google Gemma via Jarvis Labs) */}
      <CivicChatBot />
    </div>
  );
}

const container = document.getElementById('root');

if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

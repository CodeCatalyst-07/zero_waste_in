import React from 'react';
import type { Flag } from '@zerowastein/rules';
import {
  BatteryIcon,
  CheckIcon,
  FlameIcon,
  GlobeIcon,
  InfoIcon,
  PlugIcon,
  WarningIcon,
  WrapIcon,
} from '../icons/index.js';

/** Display descriptor for a regulatory or handling flag. */
export interface FlagDescriptor {
  /** User-friendly plain English description. */
  readonly label: string;
  /** Representative icon component. */
  readonly icon: React.ComponentType<{ size?: number; className?: string }>;
}

/**
 * Mapping of canonical regulatory and operational flags to citizen-friendly labels and icons.
 * Raw flag identifier strings are never exposed directly to users.
 */
export const FLAG_DESCRIPTORS: Record<Flag, FlagDescriptor> = {
  rules_vary_by_city: {
    label: 'Rules vary by city',
    icon: GlobeIcon,
  },
  separate_regime_ewaste: {
    label: 'Separate e-waste channel',
    icon: PlugIcon,
  },
  separate_regime_battery: {
    label: 'Separate battery channel',
    icon: BatteryIcon,
  },
  wrap_before_disposal: {
    label: 'Wrap before disposal',
    icon: WrapIcon,
  },
  rinse_first: {
    label: 'Rinse before binning',
    icon: CheckIcon,
  },
  fire_risk: {
    label: "Fire risk: don't crush or bin loose",
    icon: FlameIcon,
  },
  conflicting_sources: {
    label: 'Sources conflict: double-check',
    icon: WarningIcon,
  },
  review_before_launch: {
    label: 'Operational guidance',
    icon: InfoIcon,
  },
  no_dosing_advice: {
    label: 'Keep medicine in original packaging',
    icon: InfoIcon,
  },
};

/**
 * Retrieves the display descriptor for a given regulatory flag.
 *
 * @param flag Canonical regulatory flag identifier.
 * @returns Human-readable label and icon descriptor.
 */
export function getFlagDescriptor(flag: Flag): FlagDescriptor {
  return (
    FLAG_DESCRIPTORS[flag] ?? {
      label: 'Special handling required',
      icon: InfoIcon,
    }
  );
}

// Single spelling for identifiers and constants that are shared across
// modules (and with CSS/HTML via string coupling). Timing and level-scale
// constants join this file as their owning modules are migrated.

import type { DeviceModel } from './types';

export const MODEL_IDS: readonly DeviceModel[] = ['URX44V', 'URX44', 'URX22'];

export const INPUT_CHANNEL_IDS: readonly string[] =
    ['in-ch1', 'in-ch2', 'in-ch34', 'in-ch56', 'in-ch78', 'in-ch910'];

export const MIX_FX_BUSES: readonly string[] =
    ['bus-mix1', 'bus-mix2', 'bus-fx1', 'bus-fx2'];

export const SELECTABLE_SOURCES: readonly string[] =
    ['bus-stream', 'bus-mix1', 'bus-mix2', 'bus-stereo', 'bus-mon1', 'bus-mon2'];

// Endpoint dot ids follow a fixed pattern shared by ui-builder (DOM),
// topology (connection data) and view (SVG geometry).
export const ptOut = (nodeId: string): string => `pt-${nodeId}-out`;
export const ptIn = (nodeId: string): string => `pt-${nodeId}-in`;

// Fired by the model-switch flow after the full rebuild pipeline; demo
// mode re-baselines on it.
export const EVENT_MODEL_SWITCHED = 'urx:model-switched';

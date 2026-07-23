// Meter tap selection: every metered node exposes several signal-chain tap
// points (docs/device-mapping.md §5, verified on hardware by urx-router's
// stage probe). The chip above each meter shows the active tap; clicking it
// cycles to the next one. The choice is auto-saved (§2.6, key `meterTaps`)
// and applied by rewriting METER_MAPPINGS + the reverse map, so the normal
// subscribe/notify path drives whichever tap is selected.

import { setTooltip } from '../app/i18n';
import { sizeFixedColumns } from '../app/layout';
import { deviceSync } from '../broker/socket';
import { ConfigStore } from '../config/config-store';
import { METER_MAPPINGS, rebuildReverseMeterMap } from './device-map';
import { EVENT_MODEL_SWITCHED } from '../shared/constants';

export interface MeterTapDef {
    key: string;
    label: string;
    /** L meter address [meterId, x]. */
    l: readonly [number, number];
    /** R meter address; absent = a mono tap (both bars show the L value). */
    r?: readonly [number, number];
}

// Mono input channel (x = channel index): the full processing chain.
const monoTaps = (i: number): MeterTapDef[] => [
    { key: 'input', label: 'INPUT', l: [100, i] },
    { key: 'pregate', label: 'PRE GATE', l: [106, i] },
    { key: 'precomp', label: 'PRE COMP', l: [108, i] },
    { key: 'preeq', label: 'PRE EQ', l: [111, i] },
    { key: 'preinsfx', label: 'PRE INS FX', l: [112, i] },
    { key: 'prefader', label: 'PRE FADER', l: [113, i] },
    { key: 'post', label: 'POST', l: [115, i] },
];
// Stereo input channel (pair p: L = 2p / R = 2p+1): INPUT → EQ → LEVEL →
// DUCKER, metered at INPUT / PRE FADER / PRE DUCKER / POST.
const stereoTaps = (p: number): MeterTapDef[] => [
    { key: 'input', label: 'INPUT', l: [101, 2 * p], r: [101, 2 * p + 1] },
    { key: 'prefader', label: 'PRE FADER', l: [114, 2 * p], r: [114, 2 * p + 1] },
    { key: 'preducker', label: 'PRE DUCKER', l: [116, 2 * p], r: [116, 2 * p + 1] },
    { key: 'post', label: 'POST', l: [120, 2 * p], r: [120, 2 * p + 1] },
];
// Output bus (x = stereo pair): sum → EQ → LEVEL → BAL → INS FX → out.
const busTaps = (sum: number, postEq: number, postFader: number, postInsfx: number, x: number): MeterTapDef[] => [
    { key: 'preeq', label: 'PRE EQ', l: [sum, x], r: [sum, x + 1] },
    { key: 'prefader', label: 'PRE FADER', l: [postEq, x], r: [postEq, x + 1] },
    { key: 'preinsfx', label: 'PRE INS FX', l: [postFader, x], r: [postFader, x + 1] },
    { key: 'post', label: 'POST', l: [postInsfx, x], r: [postInsfx, x + 1] },
];
// FX channel: PRE FADER (mono effect out) and POST (stereo post-fader).
const fxTaps = (i: number): MeterTapDef[] => [
    { key: 'prefader', label: 'PRE FADER', l: [131, i] },
    { key: 'post', label: 'POST', l: [118, 2 * i], r: [118, 2 * i + 1] },
];

// Tap points per viewer node. Single-tap nodes (STREAMING / MONITOR) keep
// a static chip — nothing to select.
export const NODE_METER_TAPS: Record<string, MeterTapDef[]> = {
    'in-ch1': monoTaps(0),
    'in-ch2': monoTaps(1),
    'in-ch34': stereoTaps(0),
    'in-ch56': stereoTaps(1),
    'in-ch78': stereoTaps(2),
    'in-ch910': stereoTaps(3),
    'bus-stereo': busTaps(104, 121, 123, 125, 0),
    'bus-mix1': busTaps(105, 122, 124, 126, 0),
    'bus-mix2': busTaps(105, 122, 124, 126, 2),
    'bus-fx1': fxTaps(0),
    'bus-fx2': fxTaps(1),
    'bus-stream': [{ key: 'out', label: 'OUT', l: [127, 0], r: [127, 1] }],
    'bus-mon1': [{ key: 'out', label: 'OUT', l: [129, 0], r: [129, 1] }],
    'bus-mon2': [{ key: 'out', label: 'OUT', l: [129, 2], r: [129, 3] }],
};

// The viewer's historical defaults: input channels meter the always-live
// INPUT tap, buses their POST output (§5.5).
export function defaultTapKey(nodeId: string): string {
    if (nodeId.startsWith('in-ch')) return 'input';
    const taps = NODE_METER_TAPS[nodeId];
    return taps && taps.some(t => t.key === 'post') ? 'post' : 'out';
}

const state: Record<string, string> = {};

function currentTap(nodeId: string): MeterTapDef | null {
    const taps = NODE_METER_TAPS[nodeId];
    if (!taps || taps.length === 0) return null;
    const key = state[nodeId] ?? defaultTapKey(nodeId);
    return taps.find(t => t.key === key) ?? taps[0]!;
}

// Rewrites the node's METER_MAPPINGS entries for the selected tap. A mono
// tap on a stereo meter maps both bars to the same address.
function applyTap(nodeId: string): void {
    const tap = currentTap(nodeId);
    if (!tap) return;
    if (METER_MAPPINGS[`${nodeId}-meter`]) {
        METER_MAPPINGS[`${nodeId}-meter`] = { meterId: tap.l[0], x: tap.l[1] };
    }
    if (METER_MAPPINGS[`${nodeId}-meter-r`]) {
        const r = tap.r ?? tap.l;
        METER_MAPPINGS[`${nodeId}-meter-r`] = { meterId: r[0], x: r[1] };
    }
}

// Chip label + tooltip. The chips are rebuilt with every buildAll(), so
// this re-syncs them after startup restore and after model switches.
function updateChip(nodeId: string): void {
    const chip = document.querySelector<HTMLElement>(`#${nodeId} .meter-tap-chip`);
    const tap = currentTap(nodeId);
    if (!chip || !tap) return;
    chip.textContent = tap.label;
    const taps = NODE_METER_TAPS[nodeId]!;
    if (taps.length > 1) {
        setTooltip(chip, 'Meter tap: {label} (click to cycle: {cycle})',
            { label: tap.label, cycle: taps.map(t => t.label).join(' → ') });
    } else {
        setTooltip(chip, 'Meter tap: {label}', { label: tap.label });
    }
    chip.classList.toggle('meter-tap-chip--fixed', taps.length <= 1);
}

function refreshChips(): void {
    Object.keys(NODE_METER_TAPS).forEach(updateChip);
}

/** Cycle a node's meter to its next tap point (no-op for single-tap
 *  nodes). Persists, remaps, resets the bars and — while connected —
 *  subscribes the new addresses (the old ones stay subscribed; duplicate
 *  registrations are harmless). */
export function cycleMeterTap(nodeId: string): void {
    const taps = NODE_METER_TAPS[nodeId];
    if (!taps || taps.length < 2) return;
    const cur = currentTap(nodeId)!;
    const next = taps[(taps.findIndex(t => t.key === cur.key) + 1) % taps.length]!;
    state[nodeId] = next.key;
    ConfigStore.set('meterTaps', state);

    applyTap(nodeId);
    rebuildReverseMeterMap();
    updateChip(nodeId);

    // Old readings belong to the previous tap — blank until the next notify
    [`${nodeId}-meter`, `${nodeId}-meter-r`].forEach(id => {
        document.getElementById(id)?.style.setProperty('--level', '0%');
    });

    // Live re-subscribe (returns false while disconnected — the initial
    // subscribeAll after connect walks the updated METER_MAPPINGS anyway)
    const addrs = [next.l, next.r].filter((a): a is readonly [number, number] => !!a)
        .map(([id, x]) => `${id}:${x}`);
    deviceSync.subscribe('meters', addrs, true);

    // A longer/shorter chip label can nudge the node's natural width —
    // re-derive the fixed columns so nothing overhangs the scrollbar
    sizeFixedColumns();
}

/** Restore the saved tap selection, rewrite the meter mappings before the
 *  broker subscribes, and keep the chips in sync across model switches. */
export function initMeterTaps(): void {
    const saved = ConfigStore.get('meterTaps');
    if (saved && typeof saved === 'object') {
        for (const [nodeId, key] of Object.entries(saved)) {
            if (typeof key === 'string' && NODE_METER_TAPS[nodeId]?.some(t => t.key === key)) {
                state[nodeId] = key;
            }
        }
    }
    Object.keys(NODE_METER_TAPS).forEach(applyTap);
    rebuildReverseMeterMap();
    refreshChips();

    // buildAll() recreates the chips with their template labels
    document.addEventListener(EVENT_MODEL_SWITCHED, refreshChips);
}

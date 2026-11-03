// Device-to-UI notification application: parameter updates, meter painting
// and the focus-view blink/scroll gating on parameter changes.

import { appState } from '../app/app-state';
import { scrollToNodes } from '../app/layout';
import {
    chColorToHex,
    getMeterAddressForNode,
    INPUT_PORT_TO_NODE,
    PARAM_MAPPINGS,
    PORT_TO_NODE,
    REVERSE_METER_MAP,
    REVERSE_PARAM_MAP,
} from '../data/device-map';
import { currentPatches } from '../data/topology';
import type { ParamType, ReverseParamEntry } from '../shared/types';
import { setNodeColorOverride } from '../view/categories';
import {
    dbToKnobAngle,
    refreshNodeLineColors,
    triggerNodeBlink,
    updateKnobElement,
    updatePatchChips,
    updateToggleElement,
} from '../view/render';
import { viewState } from '../view/view-state';
import {
    decodeDelayTime,
    decodeFrameRate,
    decodeFreq,
    formatDb,
    formatSampleRate,
    decodeInsertFxActive,
    decodeLevelKnob,
    decodeMeter,
    decodePanText,
    decodePortRefPortId,
    decodeStringValue,
    vdToGainAngle,
    vdToLevel,
    vdToPanAngle,
    vdToPhones,
} from './decode';
import { debouncedDrawLines } from './redraw';

// Set false during the 1.5s window after connect: the initial state flood
// must not blink/scroll (REQUIREMENTS.md §5).
let initialSyncDone = false;

export function setInitialSyncDone(v: boolean): void {
    initialSyncDone = v;
}

// Last notification applied per element (address + raw value). A
// notification that repeats what the element already shows (device echo
// of our own set, a re-fetch) still updates the DOM but must not blink /
// Scroll to Change again — each blink forces a synchronous layout, and
// fader drags deliver many notifications a second. Keyed by element, not
// by address: alias addresses (e.g. an EQ ON and its inverted SSMCS twin)
// drive the same control, so the same value on another address IS a change.
const lastApplied = new Map<string, { addr: string; value: unknown }>();

export function resetParamValueCache(): void {
    lastApplied.clear();
}

function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
}

// PREAMP gain knobs share one applier; only the analog/digital scale differs
function applyGainKnob(el: HTMLElement, value: number, isAnalog: boolean): void {
    updateKnobElement(el, vdToGainAngle(value, isAnalog), formatDb(value / 100));
}

// Per-type DOM appliers for handleParamUpdate. 'portRef' is absent by
// design — it retargets currentPatches and runs even when the mapped
// element does not exist in the current model's DOM (see handleParamUpdate).
type ParamApplier = (el: HTMLElement, value: any, match: ReverseParamEntry) => void;

const PARAM_APPLIERS: Record<Exclude<ParamType, 'portRef'>, ParamApplier> = {
    level: (el, value) => {
        (el as HTMLInputElement).value = String(vdToLevel(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    level_knob: (el, value) => {
        const { db, text } = decodeLevelKnob(value);
        updateKnobElement(el, dbToKnobAngle(db), text);
        el.dataset.value = String(db); // Store for isFaderMuted
        // The level drives the connection state (muted at the -60 dB
        // floor) — redraw explicitly, the value-label text change alone
        // no longer triggers one (see layout.ts isValueLabelMutation)
        debouncedDrawLines();
    },
    phonesLevel: (el, value) => {
        const pct = Math.max(0, Math.min(1, value / 100));
        updateKnobElement(el, -135 + pct * 270, vdToPhones(value).toFixed(1));
    },
    gain: (el, value, match) =>
        applyGainKnob(el, value, match.elId.includes('in-ch1') || match.elId.includes('in-ch2')),
    dgain: (el, value) => applyGainKnob(el, value, false),
    pan: (el, value) => updateKnobElement(el, vdToPanAngle(value), decodePanText(value)),
    bool: (el, value) => updateToggleElement(el, value === 1),
    bool_ssmcs: (el, value) => updateToggleElement(el, value === 0),
    bool_stereo_pair: (el, value) => updateToggleElement(el, value === 1),
    insertFx: (el, value) => updateToggleElement(el, decodeInsertFxActive(value)),
    freq: (el, value) => {
        const { angle, text } = decodeFreq(value);
        updateKnobElement(el, angle, text);
    },
    oscMode: (el, value, match) =>
        updateToggleElement(el, value === PARAM_MAPPINGS[match.elId]!.value),
    string: (el, value) => {
        const valStr = decodeStringValue(value);
        el.textContent = valStr ? `"${valStr}"` : '';
    },
    delayTime: (el, value) => {
        const { angle, text } = decodeDelayTime(value);
        updateKnobElement(el, angle, text);
    },
    frameRate: (el, value) => { el.textContent = decodeFrameRate(value); },
    sampleRate: (el, value) => { el.textContent = formatSampleRate(value); },
    chColor: (el, value) => {
        // CH SETTING カラー: ノード上辺のアクセント色に反映。カテゴリ色の
        // CSS が !important なので、勝つにはインライン !important が必要
        // (Off / 未知 index は除去してカテゴリ色に戻す)。el はノード要素
        // そのもの (PARAM_MAPPINGS のキーがノード id)。dataset にも保持し、
        // updateHighlights のリセット (inline borderColor 書き戻し) 後の
        // 再適用に使う (src/view/highlight.ts)。
        const hex = chColorToHex(value);
        if (hex) {
            el.dataset.chColor = hex;
            el.style.setProperty('border-top-color', hex, 'important');
        } else {
            delete el.dataset.chColor;
            el.style.removeProperty('border-top-color');
        }
        // The channel's outgoing routing lines and its source chips
        // follow the CH color too (REQUIREMENTS §4.1)
        setNodeColorOverride(el.id, hex);
        refreshNodeLineColors(el.id);
    },
};

// portRef: the notified port id retargets the destination's patch entry
function applyPortRef(match: ReverseParamEntry, value: number): void {
    const portId = decodePortRefPortId(value);
    const targetNodeId = match.elId.split('-ind-')[0]!; // e.g. "out-main", "bus-stream", "in-ch1"
    const isInput = match.elId.startsWith('in-ch');
    const sourceNodeId = isInput ? INPUT_PORT_TO_NODE[portId] : PORT_TO_NODE[portId];

    currentPatches[targetNodeId] = sourceNodeId ?? null;

    updatePatchChips();
    debouncedDrawLines();
}

// Focus view: parameter updates on nodes outside the highlighted path can
// skip the blink and/or the Scroll to Change (REQUIREMENTS.md §2.2.6).
// When a scroll runs, the blink waits for it to finish.
function blinkAndScrollToNode(node: Element): void {
    const offPath = !!viewState.activeNodeId && !node.classList.contains('active-node');
    const skipBlink = offPath && viewState.focusEffectsPathOnly;
    const skipScroll = offPath && viewState.focusScrollPathOnly;
    const triggerBlink = () => { if (!skipBlink) triggerNodeBlink(node.id); };

    if (appState.scrollToChangeEnabled && !skipScroll) {
        const scroll = scrollToNodes([node.id]);
        if (scroll.scrolled > 0) {
            scroll.done.then(triggerBlink);
        } else {
            triggerBlink();
        }
    } else {
        triggerBlink();
    }
}

export function handleParamUpdate(addr: string, value: any): void {
    const matches = REVERSE_PARAM_MAP[addr];
    if (!matches) {
        return; // unmapped param (observable via the dev-mode GHOST tool)
    }

    for (const match of matches) {
        if (match.type === 'portRef') applyPortRef(match, value);

        const el = document.getElementById(match.elId);
        if (!el) continue;

        const prev = lastApplied.get(match.elId);
        const changed = !prev || prev.addr !== addr || !sameValue(prev.value, value);
        lastApplied.set(match.elId, { addr, value });

        const node = el.closest('.node');
        if (node && initialSyncDone && changed) blinkAndScrollToNode(node);

        if (match.type !== 'portRef') PARAM_APPLIERS[match.type](el, value, match);
    }
}

export function handleMeterUpdate(addr: string, rawValue: number): void {
    // 1. Direct update
    const elIds = REVERSE_METER_MAP[addr];
    if (elIds) {
        elIds.forEach(elId => updateMeterElement(elId, rawValue));
    }

    // 2. Dynamic USB patch updates (USB A, B, C, SUB follow their active sources)
    const usbNodes = ['out-usba', 'out-usbb', 'out-usbc', 'out-usbsub'];
    for (const usbNode of usbNodes) {
        const patchedSource = currentPatches[usbNode];
        if (patchedSource) {
            const sourceMeterAddr = getMeterAddressForNode(patchedSource);
            if (sourceMeterAddr === addr) {
                updateMeterElement(`${usbNode}-meter`, rawValue);
            }
        }
    }
}

function updateMeterElement(elId: string, rawValue: number): void {
    const el = document.getElementById(elId);
    if (!el) return;

    const { db, pct } = decodeMeter(rawValue);

    // --level drives both the normal (vertical, height) and collapse
    // (horizontal, width) meter rendering — see .meter in css/styles.css
    el.style.setProperty('--level', pct + '%');

    // Handle OVER indicator (db > 0)
    if (db > 0) {
        const container = el.parentElement!;
        let overEl = container.querySelector<HTMLElement>('.over-chip');
        if (!overEl) {
            overEl = document.createElement('div');
            overEl.className = 'over-chip';
            overEl.textContent = 'OVER';
            container.appendChild(overEl);
        }

        overEl.classList.add('active');

        if (overEl.dataset.timeoutId) {
            clearTimeout(parseInt(overEl.dataset.timeoutId));
        }

        const tid = setTimeout(() => {
            overEl.classList.remove('active');
        }, 3000);
        overEl.dataset.timeoutId = String(tid);
    }
}

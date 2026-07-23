// Demo mode: simulates a live device without any Device Center connection.
// Started/stopped with the header "Demo" button or the ?demo URL parameter.
// Applies a plausible baseline state, then fires random operations every few
// seconds through the same code paths as real device updates (click handlers,
// input events, currentPatches) so line states, blinks and meters behave
// exactly like they do when synced. Nothing is ever sent to Device Center.

import { decodePanText, vdToPanAngle } from '../broker/decode';
import { debouncedDrawLines } from '../broker/redraw';
import { deviceSync, setSyncStatus } from '../broker/socket';
import { ConfigStore } from '../config/config-store';
import { currentPatches } from '../data/topology';
import { EVENT_MODEL_SWITCHED, INPUT_CHANNEL_IDS } from '../shared/constants';
import {
    dbToKnobAngle,
    setLinesVisible,
    suppressChangeEffects,
    triggerNodeBlink,
    updateKnobElement,
    updatePatchChips,
    updateToggleElement,
} from '../view/render';

// Read by the broker's device-status guards.
export const demoState = { running: false };

const ACTION_INTERVAL_MS = 3000;
const METER_INTERVAL_MS = 150;

const SENDS = ['mix1', 'mix2', 'fx1', 'fx2'];
const FADERS = ['bus-mix1-fader-mst', 'bus-mix2-fader-mst', 'bus-fx1-fader-rtn', 'bus-fx2-fader-rtn', 'bus-stereo-fader-out'];

// Buttons switched ON when demo starts. in-ch56/910 keep TO ST off and the
// send selection varies per channel so all three line states stay visible.
const BASELINE_ON = [
    'in-ch1-btn-on', 'in-ch2-btn-on', 'in-ch34-btn-on', 'in-ch56-btn-on', 'in-ch78-btn-on', 'in-ch910-btn-on',
    'in-ch1-btn-tost', 'in-ch2-btn-tost', 'in-ch34-btn-tost', 'in-ch78-btn-tost',
    'in-ch1-send-mix1-on', 'in-ch1-send-fx1-on',
    'in-ch2-send-mix1-on', 'in-ch2-send-mix2-on',
    'in-ch34-send-mix2-on', 'in-ch56-send-fx2-on', 'in-ch910-send-mix1-on',
    'bus-mix1-btn-on', 'bus-mix2-btn-on', 'bus-mix1-btn-tost', 'bus-mix2-btn-tost',
    'bus-fx1-btn-on', 'bus-fx2-btn-on', 'bus-fx1-btn-tost', 'bus-fx2-btn-tost',
    'bus-mon1-btn-on', 'bus-mon2-btn-on', 'bus-stereo-btn-on',
];

// Valid demo sources per patchable destination (mirrors the routing topology)
const PATCH_TARGETS: Record<string, string[]> = {
    'out-main': ['bus-stream', 'bus-mix1', 'bus-mix2', 'bus-stereo', 'bus-mon1', 'bus-mon2'],
    'out-usba': ['bus-stream', 'bus-mix1', 'bus-mix2', 'bus-stereo', 'in-ch1', 'in-ch34'],
    'out-usbb': ['bus-stream', 'bus-mix1', 'bus-mix2', 'bus-stereo', 'in-ch2'],
    'out-usbc': ['bus-stream', 'bus-stereo', 'in-ch1'],
    'out-usbsub': ['bus-stream', 'bus-stereo', 'in-ch910'],
    'bus-stream': ['bus-stereo', 'bus-mix1', 'bus-mix2'],
    'bus-mon1': ['bus-mix1', 'bus-mix2', 'bus-stereo'],
    'bus-mon2': ['bus-mix1', 'bus-mix2', 'bus-stereo'],
    'in-ch1': ['in-port-mic1', 'in-port-aux', 'in-port-usba'],
    'in-ch34': ['in-port-aux', 'in-port-usba', 'in-port-daw34'],
};

let actionTimer: ReturnType<typeof setInterval> | null = null;
let meterTimer: ReturnType<typeof setInterval> | null = null;
// Meter elements queried once per demo run (refreshed on model switches)
// instead of once per 150ms meter tick
let demoMeters: HTMLElement[] = [];

function randomOf<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]!;
}

function setLevelKnob(el: HTMLElement, db: number): void {
    el.dataset.value = String(db); // read by getConnectionState's isFaderMuted
    // demo levels are always above the -inf floor, so the label reads green
    updateKnobElement(el, dbToKnobAngle(db), (db > 0 ? '+' : '') + db.toFixed(1) + ' dB');
}

function applyBaseline(): void {
    // The baseline flips many connections at once — apply it without
    // per-line wipe/blink effects
    suppressChangeEffects(1500);

    BASELINE_ON.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
    });

    // Without a dataset.value the send level knobs read as muted
    // (getConnectionState's isFaderMuted), so give every channel/send
    // knob a nominal level.
    INPUT_CHANNEL_IDS.forEach(ch => {
        ['ch', 'mix1', 'mix2', 'fx1', 'fx2'].forEach(kind => {
            const el = document.getElementById(`${ch}-knob-${kind}`);
            if (el) setLevelKnob(el, 0);
        });
    });

    debouncedDrawLines();
}

// ---- random activity -------------------------------------------------

// Toggles like a device-side update via the shared primitive (class flip,
// ch-muted dimming, redraw). Not simulated via click() because the
// node-selection delegation on #main-container would swallow the event
// and activate highlight mode.
function toggleButton(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    updateToggleElement(el, !el.classList.contains('active'));
}

function moveFader(): void {
    const el = document.getElementById(randomOf(FADERS)) as HTMLInputElement | null;
    if (!el) return;
    // Mostly usable levels; occasionally full mute so the line state flips
    const v = Math.random() < 0.15 ? -144 : (Math.random() * 24 - 18);
    el.value = v.toFixed(1);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function turnKnob(): void {
    const ch = randomOf(INPUT_CHANNEL_IDS);
    if (Math.random() < 0.5) {
        // Pan knob: visual only (same decode helpers as the live path)
        const el = document.getElementById(`${ch}-knob-pan`);
        if (!el) return;
        const pan = Math.round(Math.random() * 126 - 63);
        updateKnobElement(el, vdToPanAngle(pan), decodePanText(pan));
    } else {
        // Send level knob: dropping below -60 dB mutes the line
        const el = document.getElementById(`${ch}-knob-${randomOf(SENDS)}`);
        if (!el) return;
        const db = Math.random() < 0.2 ? -72 : (Math.random() * 22 - 12);
        setLevelKnob(el, db);
        debouncedDrawLines();
    }
    triggerNodeBlink(ch);
}

function switchPatch(): void {
    const target = randomOf(Object.keys(PATCH_TARGETS));
    currentPatches[target] = randomOf(PATCH_TARGETS[target]!);
    updatePatchChips();
    triggerNodeBlink(target);
    debouncedDrawLines();
}

function randomAction(): void {
    const r = Math.random();
    if (r < 0.35) {
        // Input-channel sends plus the FX return MIX sends
        const src = Math.random() < 0.8 ? randomOf(INPUT_CHANNEL_IDS) : randomOf(['bus-fx1', 'bus-fx2']);
        const sends = src.startsWith('bus-fx') ? ['mix1', 'mix2'] : SENDS;
        toggleButton(`${src}-send-${randomOf(sends)}-on`);
    }
    else if (r < 0.5) toggleButton(`${randomOf(INPUT_CHANNEL_IDS)}-btn-tost`);
    else if (r < 0.55) toggleButton('bus-osc-btn-on');
    else if (r < 0.7) moveFader();
    else if (r < 0.85) turnKnob();
    else switchPatch();
}

// Random meter animation (demo only). Sets the --level custom property
// like the live handler updateMeterElement in the broker.
function updateDemoMeters(): void {
    demoMeters.forEach(el => {
        if (el.dataset.midiDriven === 'true') return;
        const level = Math.random() > 0.1 ? Math.floor(Math.random() * 60) + 20 : Math.floor(Math.random() * 10);
        el.style.setProperty('--level', level + '%');
    });
}

// ---- lifecycle --------------------------------------------------------

function startDemo(): void {
    if (demoState.running) return;

    // Leave any live OR in-flight device connection first — demo and
    // device updates must not mix. Unconditional: a socket that is
    // still CONNECTING has isConnected() === false but would otherwise
    // complete later and clobber the demo status/state.
    deviceSync.disconnect();

    demoState.running = true;
    ConfigStore.set('demoMode', true);
    setSyncStatus('Demo Mode', 'var(--accent-yellow)');
    document.getElementById('demo-track')!.classList.add('on');
    setLinesVisible(true);
    applyBaseline();
    demoMeters = Array.from(document.querySelectorAll('.meter'));
    actionTimer = setInterval(randomAction, ACTION_INTERVAL_MS);
    meterTimer = setInterval(updateDemoMeters, METER_INTERVAL_MS);
}

function stopDemo(): void {
    if (!demoState.running) return;
    demoState.running = false;
    ConfigStore.set('demoMode', false);
    if (actionTimer !== null) clearInterval(actionTimer);
    if (meterTimer !== null) clearInterval(meterTimer);
    suppressChangeEffects(1000); // leaving demo is a bulk change
    setLinesVisible(false);
    document.querySelectorAll<HTMLElement>('.meter').forEach(el => {
        if (el.dataset.midiDriven !== 'true') el.style.setProperty('--level', '0%');
    });
    setSyncStatus('Disconnected', 'var(--text-muted)');
    document.getElementById('demo-track')!.classList.remove('on');
}

export function initDemo(): void {
    document.getElementById('demo-toggle')!.addEventListener('click', (e) => {
        e.stopPropagation();
        if (demoState.running) stopDemo(); else startDemo();
    });

    // Connecting to the real Device Center always leaves demo mode first
    document.getElementById('sync-connect-btn')!.addEventListener('click', () => stopDemo(), true);

    // Model switch rebuilds the DOM and loses all toggle states — reapply
    // (and re-query the meter elements, the cached ones are gone with it)
    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
        demoMeters = Array.from(document.querySelectorAll('.meter'));
        if (demoState.running) applyBaseline();
    });

    // Auto-start via ?demo or a saved demo-mode state — but only after
    // the broker's DOMContentLoaded init has injected the bus/monitor
    // buttons the baseline switches on. initBroker() registers its
    // listener first (main.ts calls it earlier), so it runs before this.
    // When auto-connect fires too, demo wins — startDemo leaves the
    // device sync, same as with ?demo.
    if (new URLSearchParams(location.search).has('demo') || ConfigStore.get('demoMode') === true) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startDemo);
        } else {
            startDemo();
        }
    }
}

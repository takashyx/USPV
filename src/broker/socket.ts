// Device Center WebSocket sync. Connects to ws://127.0.0.1:51780/casket
// (JSON-RPC 1.0 風) to sync with YAMAHA URX hardware: connection
// lifecycle, message dispatch, subscription management and UI->device
// sends. Decoding lives in decode.ts, DOM application in apply.ts, the
// address tables in src/data/device-map.ts.

import { sizeFixedColumns } from '../app/layout';
import { switchModel } from '../app/model-switch';
import { ConfigStore } from '../config/config-store';
import { EXTRA_METERS, METER_MAPPINGS, PARAM_MAPPINGS } from '../data/device-map';
import { demoState } from '../demo/demo';
import { MODEL_IDS } from '../shared/constants';
import { initializeSvgPaths, setLinesVisible, suppressChangeEffects } from '../view/render';
import { handleMeterUpdate, handleParamUpdate, resetParamValueCache, setInitialSyncDone } from './apply';
import { assignDynamicIds } from './dynamic-ids';
import { trafficHooks } from './hooks';
import { debouncedDrawLines, setSyncingInitial } from './redraw';

function resetModelOptions(select: HTMLSelectElement): void {
    select.innerHTML = MODEL_IDS.map(m => `<option value="${m}">${m}</option>`).join('');
}

// OSCILLATOR waveform buttons -> device value of param 712:0:0
const OSC_MODE_VALUES: Record<string, number> = { sine: 0, pink: 1, burst: 2 };

// -------------------------------------------------------------
// Connection state
// -------------------------------------------------------------

let ws: WebSocket | null = null;
let devUid: string | null = null;
let isConnected = false;
let deviceModel = 'URX';
// dev_uid whose subscriptions / initial fetch are in place — a repeated
// `online` for the same device must not re-send the whole batch
let syncedUid: string | null = null;
// Timers of the current connection: the initial-sync blink gate and the
// sync-flood redraw gate. Cleared on disconnect/reconnect so a dead
// connection's timers can't release the gates of the one that replaced it.
let initialSyncTimer: ReturnType<typeof setTimeout> | null = null;
let syncReleaseTimer: ReturnType<typeof setTimeout> | null = null;

function clearConnectionTimers(): void {
    if (initialSyncTimer) { clearTimeout(initialSyncTimer); initialSyncTimer = null; }
    if (syncReleaseTimer) { clearTimeout(syncReleaseTimer); syncReleaseTimer = null; }
}

let connectBtn: HTMLElement;
let statusDiv: HTMLElement;
let statusDot: HTMLElement | null;

export function setSyncStatus(text: string, color: string): void {
    statusDiv.textContent = text;
    statusDiv.style.color = color;
    if (statusDot) statusDot.style.background = color;
}

// Status updates on device-sync failure paths must not clobber the
// demo-mode display (a stale socket can still error/close after the
// user has switched to demo mode)
function setDeviceStatus(text: string, color: string): void {
    if (!demoState.running) setSyncStatus(text, color);
}

// Rebuild hook used by the model-switch pipeline after every buildAll()
export function reinitBroker(): void {
    initializeSvgPaths();
    assignDynamicIds();
    // assignDynamicIds injects controls (bus ON, fader value labels)
    // that widen the FX nodes — the fixed-column widths were measured
    // before the injection, so re-derive them now (REQUIREMENTS §2.1.1)
    sizeFixedColumns();
    debouncedDrawLines();
}

// -------------------------------------------------------------
// WebSocket Client Core Connection Logic
// -------------------------------------------------------------

function connect(): void {
    // Demo mode wins — never open a device connection under it (auto
    // -connect can fire while a restored demo session is running, §2.5)
    if (demoState.running) return;
    // A superseded socket is detached before it is closed: its late
    // close/error events must not reset the state of the connection that
    // replaced it, so every handler below checks that it still owns `ws`.
    if (ws) {
        const old = ws;
        ws = null;
        old.close();
    }
    clearConnectionTimers();
    const sock = new WebSocket('ws://127.0.0.1:51780/casket');
    ws = sock;

    sock.onopen = () => {
        if (sock !== ws) return;
        // Demo mode may have started while the socket was CONNECTING —
        // drop the connection instead of clobbering the demo display
        if (demoState.running) { disconnect(); return; }
        console.log('[Device Center] Connected');
        setSyncStatus('Device Connected', 'var(--accent-green)');

        // Set initial sync flag after 1.5s to prevent initial flood blinking
        setInitialSyncDone(false);
        initialSyncTimer = setTimeout(() => {
            initialSyncTimer = null;
            setInitialSyncDone(true);
        }, 1500);
        sendJson({ jsonrpc: '1.0', method: 'getDeviceList' });
    };

    sock.onmessage = (event) => {
        if (sock !== ws) return;
        try {
            const msg = JSON.parse(event.data);
            const hooks = trafficHooks();
            if (hooks) hooks.rx(msg); // dev console log/capture
            handleMessage(msg);
        } catch (err) {
            console.error('Error parsing WS frame:', err);
        }
    };

    sock.onerror = (err) => {
        if (sock !== ws) return;
        console.error('WebSocket connection error:', err);
        setDeviceStatus('Connection Error', 'var(--accent-red, #f85149)');
        disconnect();
    };

    sock.onclose = () => {
        if (sock !== ws) return; // closed by disconnect()/connect(): already cleaned up
        ws = null;
        disconnectCleanup();
    };
}

function disconnect(): void {
    if (ws) {
        if (devUid && isConnected) {
            unsubscribeAll();
        }
        const sock = ws;
        ws = null; // detach first — its onclose must not clean up twice
        sock.close();
    }
    disconnectCleanup();
}

function disconnectCleanup(): void {
    isConnected = false;
    devUid = null;
    syncedUid = null;
    clearConnectionTimers();
    setSyncingInitial(false); // a disconnect inside the 400ms sync window must not leave redraws gated
    resetParamValueCache();
    connectBtn.textContent = 'Connect';
    connectBtn.style.background = 'var(--accent-blue, #58a6ff)';
    // ws.onclose can arrive after demo mode has taken over the display —
    // leave the demo status and line visibility alone in that case
    if (!demoState.running) {
        setSyncStatus('Disconnected', 'var(--text-muted)');
        setLinesVisible(false);
    }

    const select = document.getElementById('model-select') as HTMLSelectElement | null;
    if (select) {
        const currentVal = select.value;
        resetModelOptions(select);
        select.value = currentVal;
    }

    document.querySelectorAll<HTMLElement>('.meter').forEach(m => {
        delete m.dataset.midiDriven;
    });

    // The sample-rate / firmware displays are device-driven only — blank
    // them on disconnect
    const rateEl = document.getElementById('sample-rate');
    if (rateEl) rateEl.textContent = '--';
    const fwEl = document.getElementById('firmware-version');
    if (fwEl) fwEl.textContent = '--';

    // Subscriptions die with the connection — reflect that in dev mode
    // (every kind, including the free-form ones added from the SUBSCRIBE panel)
    for (const set of Object.values(devSubs)) set.clear();
    notifySubsChanged();

    debouncedDrawLines();
}

export function connectToDevice(uid: string, model: string): void {
    devUid = uid;
    deviceModel = model;
    syncedUid = null; // the rebuilt DOM needs a fresh subscribe + initial fetch
    switchModel(model);
    requestVD('get', '/vd/synchronize');
}

function sendJson(obj: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        const hooks = trafficHooks();
        if (hooks) hooks.tx(obj); // dev console log
    }
}

// -------------------------------------------------------------
// Message Dispatcher
// -------------------------------------------------------------

// getDeviceList response: (re)populate the model select and connect to
// the first listed device
function handleDeviceList(list: any[]): void {
    const select = document.getElementById('model-select') as HTMLSelectElement | null;
    if (select) {
        if (list.length === 0) {
            resetModelOptions(select);
            select.value = deviceModel;
        } else {
            select.innerHTML = '';
            list.forEach((dev: any) => {
                const opt = document.createElement('option');
                opt.value = dev.model || 'URX44V';
                opt.dataset.uid = dev.dev_uid;
                // dev_uid looks like "{07310718-...}" — drop the braces
                // so the label reads "URX22 (07310718)"
                const shortUid = String(dev.dev_uid).replace(/[{}]/g, '').substring(0, 8);
                opt.textContent = `${dev.model || 'URX'} (${shortUid})`;
                select.appendChild(opt);
            });
        }
    }

    if (list.length === 0) {
        setDeviceStatus('No Device Connected', 'var(--accent-red, #f85149)');
        disconnect();
        return;
    }
    const device = list[0];
    devUid = device.dev_uid;
    deviceModel = device.model || 'URX';
    if (select) {
        select.value = deviceModel;
    }

    syncedUid = null; // the rebuilt DOM needs a fresh subscribe + initial fetch
    switchModel(deviceModel);

    requestVD('get', '/vd/synchronize');
}

// /vd/device response (docs/device-mapping.md §1.2): firm_list =
// [{ firm_name, firm_version }] — show the "System" entry in the header.
// Best-effort; no version = keep '--'.
function handleDeviceInfo(data: any): void {
    const list = Array.isArray(data.firm_list) ? data.firm_list : [];
    const system = list.find((f: any) =>
        String(f?.firm_name ?? '').toLowerCase() === 'system');
    const version = system ? String(system.firm_version ?? '') : '';
    const fwEl = document.getElementById('firmware-version');
    if (fwEl) fwEl.textContent = version ? `FW ${version}` : '--';
}

// /vd/synchronize response: online = the moment the session goes live
// (status/UI flip, meter tagging, subscriptions, initial state fetch)
function handleSyncStatus(data: any): void {
    if (data.sync_status !== 'online') {
        setDeviceStatus(`Device Offline (${data.sync_status || 'offline'})`, 'var(--accent-red, #f85149)');
        disconnect();
        return;
    }

    // /vd/synchronize can be answered/notified again for a device that is
    // already in sync — the subscribe + initial-fetch batch (~500 requests)
    // must run once per device connection, not per `online`
    if (isConnected && syncedUid === devUid) return;
    syncedUid = devUid;

    isConnected = true;
    setSyncingInitial(true); // Start the sync gating block
    // The initial state flood flips many connections at once —
    // snap to the synced state without per-line effects
    suppressChangeEffects(2000);
    ConfigStore.set('autoConnect', true); // Save state for page reloads
    connectBtn.textContent = 'Disconnect';
    connectBtn.style.background = 'var(--accent-red, #f85149)';
    // No model name here — the model dropdown sits right next
    // to the status and already shows it
    setSyncStatus('Connected', 'var(--accent-green, #3fb950)');
    setLinesVisible(true);

    // Tag all meters as midi-driven to suppress dummy simulation
    const allMeters = [
        'in-ch1-meter', 'in-ch2-meter', 'in-ch34-meter', 'in-ch56-meter', 'in-ch78-meter', 'in-ch910-meter',
        'bus-mix1-meter', 'bus-mix2-meter', 'bus-fx1-meter', 'bus-fx2-meter', 'out-main-meter', 'out-ph1-meter', 'out-ph2-meter',
        'out-usba-meter', 'out-usbb-meter', 'out-usbc-meter', 'out-usbsub-meter'
    ];
    for (const elId of allMeters) {
        const el = document.getElementById(elId);
        if (el) el.dataset.midiDriven = 'true';
    }

    subscribeAll();
    fetchInitialState();
    requestVD('get', '/vd/device'); // firmware version for the header

    // Release sync block and draw lines after all initial state frames are processed
    if (syncReleaseTimer) clearTimeout(syncReleaseTimer);
    syncReleaseTimer = setTimeout(() => {
        syncReleaseTimer = null;
        setSyncingInitial(false);
        debouncedDrawLines();
    }, 400);
}

function handleMessage(msg: any): void {
    if (msg.method === 'getDeviceList' || msg.result?.params?.list) {
        handleDeviceList(msg.params?.list || msg.result?.params?.list || []);
        return;
    }

    const vdp = msg.params?.vdp || msg.result?.vdp;
    if (!vdp) return;

    const uri: string = vdp.uri || '';
    const data = vdp.data || {};
    const path = uri.split('?')[0];

    if (path === '/vd/device') {
        handleDeviceInfo(data);
        return;
    }

    if (path === '/vd/synchronize') {
        handleSyncStatus(data);
        return;
    }

    if (vdp.method === 'notify' && uri === '/vd/synchronize' && data.sync_status !== 'online') {
        setDeviceStatus('Device Lost', 'var(--accent-red, #f85149)');
        disconnect();
        return;
    }

    const value = data.current_value;
    if (value === undefined) return;

    if (uri.startsWith('/vd/parameters/')) {
        const addr = uri.replace('/vd/parameters/', '').split('?')[0]!; // e.g. "140:0:0"
        handleParamUpdate(addr, value);
    } else if (uri.startsWith('/vd/meters/')) {
        const addr = uri.replace('/vd/meters/', '').split('?')[0]!;
        handleMeterUpdate(addr, value);
    }
}

function requestVD(method: string, uri: string, data: unknown = null): void {
    if (!devUid) return;
    const req: any = {
        jsonrpc: '1.0',
        method: 'requestVD',
        params: {
            dev_uid: devUid,
            vdp: { method, uri }
        }
    };
    if (data) {
        req.params.vdp.data = data;
    }
    sendJson(req);
}

function sendSetParameter(addr: string, value: number): void {
    sendJson({
        jsonrpc: '1.0',
        method: 'setParameter',
        params: {
            vdp: {
                uri: `/vd/parameters/${addr}`,
                data: { current_value: value }
            }
        }
    });
}

// -------------------------------------------------------------
// Initial Fetch & Subscription Operations
// -------------------------------------------------------------

function forEachParamKey(callback: (key: string) => void): void {
    const seen = new Set<string>();
    for (const spec of Object.values(PARAM_MAPPINGS)) {
        const key = `${spec.paramId}:${spec.x}:${spec.y}`;
        if (!seen.has(key)) {
            seen.add(key);
            callback(key);
        }
    }
}

function fetchInitialState(): void {
    forEachParamKey(key => requestVD('get', `/vd/parameters/${key}`));
}

function forEachSubscriptionKey(callback: (kind: string, key: string) => void): void {
    forEachParamKey(key => callback('parameters', key));

    for (const spec of Object.values(METER_MAPPINGS)) {
        callback('meters', `${spec.meterId}:${spec.x}`);
    }

    for (const key of EXTRA_METERS) {
        callback('meters', key);
    }
}

// Current subscription state, tracked for the dev-mode SUBSCRIBE view
// (the dev console receives changes via the traffic hooks)
const devSubs: Record<string, Set<string>> = { parameters: new Set(), meters: new Set() };

function notifySubsChanged(): void {
    const hooks = trafficHooks();
    if (hooks && hooks.subs) hooks.subs(devSubs);
}

function subscribeAll(): void {
    forEachSubscriptionKey((kind, key) => {
        requestVD('post', `/vd/${kind}/${key}?operation=regist`);
        devSubs[kind]!.add(key);
    });
    notifySubsChanged();
}

function unsubscribeAll(): void {
    forEachSubscriptionKey((kind, key) => {
        requestVD('post', `/vd/${kind}/${key}?operation=unregist`);
        devSubs[kind]!.delete(key);
    });
    notifySubsChanged();
}

// Unregister every subscription currently tracked (manual / range extras
// included) and empty the tracking sets. The dev panel is NOT notified —
// callers decide what follows (nothing, or a subscribeAll).
function unsubscribeAllTracked(): void {
    for (const [kind, set] of Object.entries(devSubs)) {
        for (const key of set) {
            requestVD('post', `/vd/${kind}/${key}?operation=unregist`);
        }
        set.clear();
    }
}

// Intentional surface for demo mode and the dev-mode SUBSCRIBE panel.
export const deviceSync = {
    isConnected: () => isConnected,
    disconnect: () => disconnect(),
    getSubscriptions: () => devSubs,

    // Dev-mode "Clear All": unregister everything currently tracked and
    // leave nothing subscribed
    clearAllSubscriptions: (): boolean => {
        if (!devUid) return false;
        unsubscribeAllTracked();
        notifySubsChanged();
        return true;
    },

    // Dev-mode "Restore Default": unregister everything currently tracked,
    // then re-register the mapped defaults — the state a fresh connection
    // starts with.
    restoreDefaultSubscriptions: (): boolean => {
        if (!devUid) return false;
        unsubscribeAllTracked();
        subscribeAll(); // notifies the dev panel
        return true;
    },

    // Manual (un)subscribe for the dev-mode SUBSCRIBE panel; accepts a
    // single key or an array (bulk range registration). The kind may be
    // ANY VD resource ('parameters' / 'meters' / 'version' / ...) — the
    // URI is /vd/{kind}/{key} either way. Returns false while no device
    // connection exists (nothing is sent then).
    subscribe: (kind: string, keys: string | string[], on: boolean): boolean => {
        const k = kind === 'param' ? 'parameters' : kind === 'meter' ? 'meters' : kind;
        if (!devUid) return false;
        if (!devSubs[k]) devSubs[k] = new Set(); // unseen kinds get their own bucket
        (Array.isArray(keys) ? keys : [keys]).forEach(key => {
            requestVD('post', `/vd/${k}/${key}?operation=${on ? 'regist' : 'unregist'}`);
            if (on) devSubs[k]!.add(key); else devSubs[k]!.delete(key);
        });
        notifySubsChanged();
        return true;
    },
};

// -------------------------------------------------------------
// DOM Load Setup
// -------------------------------------------------------------

function init(): void {
    // Initialize SVG paths inside svg-layer once
    initializeSvgPaths();

    // Dynamic ID Assignment for Visual Elements (and Inject Sends Meta Elements)
    assignDynamicIds();
    // Re-derive the fixed-column widths now that the injected controls
    // (bus ON, fader value labels) have widened the FX nodes — the
    // app-init measurement ran before this injection. The padding/spacer
    // relayout follows on the next adjustSectionPadding (startup runs one
    // at +200ms; see finalizeInitialLayout).
    sizeFixedColumns();
    debouncedDrawLines();

    connectBtn = document.getElementById('sync-connect-btn')!;
    statusDiv = document.getElementById('sync-status')!;
    statusDot = document.getElementById('sync-status-dot');

    connectBtn.addEventListener('click', () => {
        if (isConnected) {
            ConfigStore.set('autoConnect', false); // Disable auto-connect on manual disconnect
            disconnect();
        } else {
            connect();
        }
    });

    // Trigger auto-connect if page was reloaded while connected
    if (ConfigStore.get('autoConnect') === true) {
        connect();
    }

    // Add click listener on document.body to handle user interactions on ON/OFF and PRE/POST toggles and DSP blocks
    document.body.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('.send-on, .send-pre, .dsp-block');
        if (!el || !el.id) return;

        e.stopPropagation();

        if (el.id.startsWith('bus-osc-mode-')) {
            const mode = el.id.replace('bus-osc-mode-', '');
            const val = OSC_MODE_VALUES[mode] ?? 0;

            document.querySelectorAll('#bus-osc [id^="bus-osc-mode-"]').forEach(btn => {
                btn.classList.toggle('active', btn.id === el.id);
            });

            if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
                sendSetParameter('712:0:0', val);
            }
            debouncedDrawLines();
            return;
        }

        // Toggle active state locally
        el.classList.toggle('active');

        // Redraw lines and update highlights
        debouncedDrawLines();

        // Send parameter update to casket server if connected
        const spec = PARAM_MAPPINGS[el.id];
        if (spec && isConnected && ws && ws.readyState === WebSocket.OPEN) {
            const newValue = el.classList.contains('active');
            let vdVal = 0;
            if (spec.type === 'bool') {
                vdVal = newValue ? 1 : 0;
            } else if (spec.type === 'bool_ssmcs') {
                vdVal = newValue ? 0 : 1;
            } else if (spec.type === 'insertFx') {
                vdVal = newValue ? 0 : 0xffffffff;
            } else if (spec.type === 'bool_stereo_pair') {
                vdVal = newValue ? 1 : 0;
                sendSetParameter(`${spec.paramId}:${spec.x}:${spec.y}`, vdVal);
                sendSetParameter(`${spec.paramId}:${spec.x}:${spec.rightY}`, vdVal);
                return;
            }

            sendSetParameter(`${spec.paramId}:${spec.x}:${spec.y}`, vdVal);
        }
    });
}

export function initBroker(): void {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}

// Persistent app configuration: header toggles, DAW visibility, node
// collapse state, model selection, dev mode, auto-connect. Everything
// lives in ONE versioned JSON blob so it can migrate as a unit.
//
// Init order: FIRST, before every other module's init — their
// initialization reads stored values through ConfigStore.get().
//
// The storage backend is pluggable behind ConfigBackend. In the browser it
// is localStorage, which works over file:// in Chrome — but file:// pages
// all share one localStorage namespace, hence the app-specific key.
// When the app is wrapped as a native shell (Tauri/Electron), add a
// file-backed backend here (e.g. tauri-plugin-store writing config.json
// into the OS config dir) and detect it before falling back — no other
// file changes.
//
// createConfigStore() is a pure factory (unit-testable with an in-memory
// backend); initConfigStore() wires the browser backend and lifecycle
// listeners and must be called exactly once at startup.

export interface ConfigBackend {
    read(): unknown;
    write(obj: unknown): void;
}

export interface ConfigStoreApi {
    get(key: string, fallback?: unknown): any;
    set(key: string, value: unknown): void;
    flush(): void;
    exportText(): string;
    importText(text: string): void;
}

const KEY = 'uspv.config.v1';
const SAVE_DEBOUNCE_MS = 300;

// Every known setting is always present in the blob: defaults are
// materialized and persisted rather than implied, so the stored blob
// and an exported file list the COMPLETE configuration even for
// settings that were never touched. Values mirror the app-side
// initializers (all header toggles ON, REQUIREMENTS.md §5.2).
// The literal order here is also the export order: what you look at
// first (model, mode) comes first, wiring details last.
const DEFAULTS: Record<string, unknown> = {
    model: 'URX44V',
    demoMode: false,
    language: 'en',
    fontSize: 1,
    headerCollapsed: true,
    scrollToSelection: true,
    scrollToChange: true,
    hideMuted: true,
    focusNodesPathOnly: true,
    focusEffectsPathOnly: true,
    focusScrollPathOnly: true,
    dawVisible: { 'col-physical-inputs': true, 'col-physical': true },
    collapsedNodes: [],
    meterTaps: {},
    devMode: false,
    devLogRx: true,
    devLogTx: true,
    devLogMeters: false,
    devLogWrap: false,
    autoConnect: false,
};

interface ConfigData {
    version: number;
    settings: Record<string, any>;
}

export function createConfigStore(
    backend: ConfigBackend,
    legacyRead?: (key: string) => string | null,
): ConfigStoreApi {

    // One-time import of the pre-ConfigStore scattered keys (only reached
    // while the blob doesn't exist yet). The old keys are left in place so
    // running an older build of the app still sees them.
    function importLegacyKeys(): Record<string, unknown> {
        const settings: Record<string, unknown> = {};
        if (!legacyRead) return settings;
        try {
            if (legacyRead('dev_mode') !== null) {
                settings.devMode = legacyRead('dev_mode') === 'true';
            }
            if (legacyRead('sync_auto_connect') !== null) {
                settings.autoConnect = legacyRead('sync_auto_connect') === 'true';
            }
        } catch (e) { /* ignore */ }
        return settings;
    }

    let data = backend.read() as ConfigData | null;
    if (!data || typeof data !== 'object' || data.version !== 1) {
        // Unknown/corrupt/absent — start fresh (future schema bumps get
        // their migration step here, keyed on data.version)
        data = { version: 1, settings: importLegacyKeys() };
    }
    if (!data.settings || typeof data.settings !== 'object') data.settings = {};

    // Writes are debounced: collapse buttons and toggles can be clicked in
    // bursts, and a future file-backed backend shouldn't hit disk per click
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    function flush(): void {
        if (saveTimer === null) return;
        clearTimeout(saveTimer);
        saveTimer = null;
        backend.write(data);
    }
    function scheduleSave(): void {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }

    function fillDefaults(): boolean {
        let filled = false;
        Object.keys(DEFAULTS).forEach(k => {
            if (Object.prototype.hasOwnProperty.call(data!.settings, k)) return;
            const v = DEFAULTS[k];
            data!.settings[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
            filled = true;
        });
        return filled;
    }
    if (fillDefaults()) scheduleSave();

    // ---- config file export / import ----

    // Unknown / future keys survive a round-trip by being appended after
    // the known keys.
    const EXPORT_KEY_ORDER = Object.keys(DEFAULTS);

    function exportText(): string {
        const ordered: Record<string, unknown> = {};
        EXPORT_KEY_ORDER.forEach(k => {
            if (Object.prototype.hasOwnProperty.call(data!.settings, k)) ordered[k] = data!.settings[k];
        });
        Object.keys(data!.settings).forEach(k => {
            if (!(k in ordered)) ordered[k] = data!.settings[k];
        });
        return JSON.stringify({
            format: 'uspv-config',
            version: data!.version,
            exportedAt: new Date().toISOString(),
            settings: ordered,
        }, null, 2) + '\n';
    }

    // Replaces the whole settings blob from an exported file and persists
    // immediately. Throws with a user-facing message on any problem — the
    // caller shows it and keeps the current settings. (English only: this
    // module cannot depend on i18n, which reads its settings through here.)
    function importText(text: string): void {
        let parsed: any;
        try { parsed = JSON.parse(text); }
        catch (e) { throw new Error('Could not parse as JSON: ' + (e as Error).message); }
        if (!parsed || parsed.format !== 'uspv-config') {
            throw new Error('Not a uspv settings file (format mismatch)');
        }
        if (parsed.version !== 1) {
            throw new Error('Unsupported settings version: ' + parsed.version);
        }
        if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) {
            throw new Error('Missing settings object');
        }
        // Per-key value validation happens at every read site (§2.6.2), so
        // the blob is swapped wholesale here; keys a hand-edited file
        // dropped come back at their defaults
        data = { version: 1, settings: parsed.settings };
        fillDefaults();
        scheduleSave();
        flush();
    }

    return {
        get(key, fallback) {
            return Object.prototype.hasOwnProperty.call(data!.settings, key)
                ? data!.settings[key] : fallback;
        },
        set(key, value) {
            // Deep-copy objects/arrays so later caller-side mutation can't
            // silently change what a pending save writes
            data!.settings[key] = (value && typeof value === 'object')
                ? JSON.parse(JSON.stringify(value)) : value;
            scheduleSave();
        },
        flush,
        exportText,
        importText,
    };
}

// ---- browser singleton ----

let instance: ConfigStoreApi | null = null;

export function initConfigStore(): void {
    if (instance) return;
    const backend: ConfigBackend = {
        read() {
            try { return JSON.parse(localStorage.getItem(KEY) as string); }
            catch (e) { return null; }
        },
        write(obj) {
            // Storage can be full or blocked — settings just stop
            // persisting, the app itself must keep running
            try { localStorage.setItem(KEY, JSON.stringify(obj)); }
            catch (e) { /* ignore */ }
        },
    };
    const legacyRead = (key: string): string | null => {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    };
    instance = createConfigStore(backend, legacyRead);

    // A pending debounce must not be lost to a tab close/hide
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') instance!.flush();
    });
    window.addEventListener('pagehide', () => instance!.flush());
}

// Delegating facade so importers can use ConfigStore.get() directly; valid
// only after initConfigStore() has run (main.ts calls it first).
export const ConfigStore: ConfigStoreApi = {
    get: (key, fallback) => instance!.get(key, fallback),
    set: (key, value) => instance!.set(key, value),
    flush: () => instance!.flush(),
    exportText: () => instance!.exportText(),
    importText: (text) => instance!.importText(text),
};

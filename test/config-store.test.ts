import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigStore, type ConfigBackend } from '../src/config/config-store';

function memoryBackend(initial: unknown = null) {
    let stored: unknown = initial;
    const backend: ConfigBackend & { writes: number } = {
        writes: 0,
        read: () => stored,
        write(obj) {
            this.writes++;
            stored = JSON.parse(JSON.stringify(obj));
        },
    };
    return { backend, get: () => stored as any };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createConfigStore', () => {
    it('materializes and persists all defaults on first run', () => {
        const { backend, get } = memoryBackend();
        createConfigStore(backend);
        vi.runAllTimers();
        expect(get().version).toBe(1);
        expect(get().settings.model).toBe('URX44V');
        expect(get().settings.headerCollapsed).toBe(true);
        expect(get().settings.dawVisible).toEqual({ 'col-physical-inputs': true, 'col-physical': true });
        expect(get().settings.autoConnect).toBe(false);
    });

    it('imports legacy dev_mode / sync_auto_connect keys only when blob is absent', () => {
        const legacy = (key: string) =>
            key === 'dev_mode' ? 'true' : key === 'sync_auto_connect' ? 'false' : null;
        const fresh = createConfigStore(memoryBackend().backend, legacy);
        expect(fresh.get('devMode')).toBe(true);
        expect(fresh.get('autoConnect')).toBe(false);

        const existing = createConfigStore(
            memoryBackend({ version: 1, settings: { devMode: false } }).backend, legacy);
        expect(existing.get('devMode')).toBe(false);
    });

    it('starts fresh on corrupt or wrong-version blobs', () => {
        expect(createConfigStore(memoryBackend('garbage').backend).get('model')).toBe('URX44V');
        expect(createConfigStore(memoryBackend({ version: 2, settings: { model: 'URX22' } }).backend)
            .get('model')).toBe('URX44V');
    });

    it('get returns the stored value or the fallback for unknown keys', () => {
        const store = createConfigStore(memoryBackend().backend);
        expect(store.get('model', 'X')).toBe('URX44V');
        expect(store.get('nope', 'fallback')).toBe('fallback');
        expect(store.get('nope')).toBeUndefined();
    });

    it('set deep-copies objects so later mutation cannot affect the store', () => {
        const store = createConfigStore(memoryBackend().backend);
        const arr = ['a'];
        store.set('collapsedNodes', arr);
        arr.push('b');
        expect(store.get('collapsedNodes')).toEqual(['a']);
    });

    it('debounces writes and flush forces the pending one', () => {
        const { backend } = memoryBackend({ version: 1, settings: {} });
        const store = createConfigStore(backend);
        vi.runAllTimers();               // settle the defaults save
        const before = backend.writes;
        store.set('fontSize', 2);
        store.set('fontSize', 3);
        expect(backend.writes).toBe(before);   // still debounced
        store.flush();
        expect(backend.writes).toBe(before + 1);
        store.flush();                          // nothing pending -> no write
        expect(backend.writes).toBe(before + 1);
    });

    it('exportText lists known keys first and round-trips unknown keys', () => {
        const { backend } = memoryBackend({ version: 1, settings: { futureKey: 42 } });
        const store = createConfigStore(backend);
        const exported = JSON.parse(store.exportText());
        expect(exported.format).toBe('uspv-config');
        expect(exported.version).toBe(1);
        const keys = Object.keys(exported.settings);
        expect(keys[0]).toBe('model');
        expect(keys[keys.length - 1]).toBe('futureKey');
        expect(exported.settings.futureKey).toBe(42);
    });

    it('importText swaps the blob, refills dropped keys, persists immediately', () => {
        const { backend, get } = memoryBackend();
        const store = createConfigStore(backend);
        store.importText(JSON.stringify({
            format: 'uspv-config', version: 1, settings: { model: 'URX22' },
        }));
        expect(store.get('model')).toBe('URX22');
        expect(store.get('fontSize')).toBe(1);        // dropped key back at default
        expect(get().settings.model).toBe('URX22');   // no timer advance needed
    });

    it('importText rejects bad payloads with user-facing messages', () => {
        const store = createConfigStore(memoryBackend().backend);
        expect(() => store.importText('not json')).toThrow(/Could not parse as JSON/);
        expect(() => store.importText('{"format":"other"}')).toThrow(/Not a uspv settings file/);
        expect(() => store.importText('{"format":"uspv-config","version":9,"settings":{}}'))
            .toThrow(/Unsupported settings version/);
        expect(() => store.importText('{"format":"uspv-config","version":1,"settings":[]}'))
            .toThrow(/Missing settings object/);
        expect(store.get('model')).toBe('URX44V');    // store unchanged after failures
    });
});

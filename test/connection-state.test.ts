import { describe, expect, it } from 'vitest';
import type { Connection, PatchMap } from '../src/shared/types';
import { getConnectionState, type ControlReader } from '../src/view/connection-state';

// Fake reader driven by explicit maps: unlisted buttons are "not off"
// (missing element), unlisted faders are "not muted" — mirroring the DOM
// reader's missing-element behavior.
function reader(offButtons: string[] = [], mutedFaders: string[] = []): ControlReader {
    return {
        isBtnOff: id => offButtons.includes(id),
        isFaderMuted: id => mutedFaders.includes(id),
    };
}

function conn(fromNode: string, toNode: string): Connection {
    return { from: `pt-${fromNode}-out`, fromNode, to: `pt-${toNode}-in`, toNode };
}

const NO_PATCHES: PatchMap = {};

describe('getConnectionState', () => {
    // 0. global CH_ON gate
    it('CH_ON off mutes every send from that channel', () => {
        const r = reader(['in-ch1-btn-on']);
        expect(getConnectionState(conn('in-ch1', 'bus-stereo'), r, NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('in-ch1', 'bus-mix1'), r, NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('in-ch1', 'out-daw1'), r, NO_PATCHES)).toBe('muted');
    });

    // 1. patch destinations
    it('non-selected source into a patch destination is inactive', () => {
        const patches: PatchMap = { 'out-main': 'bus-mix1' };
        expect(getConnectionState(conn('bus-stereo', 'out-main'), reader(), patches)).toBe('inactive');
        expect(getConnectionState(conn('bus-mix1', 'out-main'), reader(), patches)).toBe('flow');
    });

    it('null / missing patch entry makes every source inactive', () => {
        expect(getConnectionState(conn('bus-mix1', 'out-usba'), reader(), { 'out-usba': null })).toBe('inactive');
        expect(getConnectionState(conn('bus-mix1', 'bus-mon1'), reader(), {})).toBe('inactive');
    });

    it('input-channel destinations follow the input patch too', () => {
        const patches: PatchMap = { 'in-ch1': 'in-port-mic1' };
        expect(getConnectionState(conn('in-port-mic1', 'in-ch1'), reader(), patches)).toBe('flow');
        expect(getConnectionState(conn('in-port-aux', 'in-ch1'), reader(), patches)).toBe('inactive');
    });

    // 2a. input -> stereo
    it('input to stereo respects TO ST button and CH fader', () => {
        const patches: PatchMap = {};
        expect(getConnectionState(conn('in-ch2', 'bus-stereo'), reader(['in-ch2-btn-tost']), patches)).toBe('muted');
        expect(getConnectionState(conn('in-ch2', 'bus-stereo'), reader([], ['in-ch2-knob-ch']), patches)).toBe('muted');
        expect(getConnectionState(conn('in-ch2', 'bus-stereo'), reader(), patches)).toBe('flow');
    });

    // 2b. input -> mix/fx sends
    it('input to mix/fx respects the per-send ON button and level knob', () => {
        expect(getConnectionState(conn('in-ch1', 'bus-mix2'), reader(['in-ch1-send-mix2-on']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('in-ch1', 'bus-fx1'), reader([], ['in-ch1-knob-fx1']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('in-ch1', 'bus-fx2'), reader(), NO_PATCHES)).toBe('flow');
    });

    // 2c. oscillator
    it('oscillator sends respect the master ON and the per-send ON', () => {
        expect(getConnectionState(conn('bus-osc', 'bus-mix1'), reader(['bus-osc-btn-on']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-osc', 'bus-stereo'), reader(['bus-osc-send-stereo-on']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-osc', 'bus-fx1'), reader(), NO_PATCHES)).toBe('flow');
    });

    // 2d. FX returns
    it('FX return chain: ON button, return fader, TO ST, per-mix send', () => {
        expect(getConnectionState(conn('bus-fx1', 'bus-stereo'), reader(['bus-fx1-btn-on']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-fx1', 'bus-stereo'), reader([], ['bus-fx1-fader-rtn']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-fx1', 'bus-stereo'), reader(['bus-fx1-btn-tost']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-fx1', 'bus-mix1'), reader(['bus-fx1-send-mix1-on']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-fx1', 'bus-mix2'), reader([], ['bus-fx1-knob-mix2']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-fx2', 'bus-mix1'), reader(), NO_PATCHES)).toBe('flow');
        // TO ST does not gate the mix sends
        expect(getConnectionState(conn('bus-fx1', 'bus-mix1'), reader(['bus-fx1-btn-tost']), NO_PATCHES)).toBe('flow');
    });

    // 2e. MIX master
    it('MIX master: ON button, master fader, TO ST only toward stereo', () => {
        const patches: PatchMap = { 'bus-stream': 'bus-mix1' };
        expect(getConnectionState(conn('bus-mix1', 'bus-stereo'), reader(['bus-mix1-btn-on']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-mix1', 'bus-stereo'), reader([], ['bus-mix1-fader-mst']), NO_PATCHES)).toBe('muted');
        expect(getConnectionState(conn('bus-mix1', 'bus-stereo'), reader(['bus-mix1-btn-tost']), NO_PATCHES)).toBe('muted');
        // TO ST off does not mute the mix -> stream patch route
        expect(getConnectionState(conn('bus-mix1', 'bus-stream'), reader(['bus-mix1-btn-tost']), patches)).toBe('flow');
    });

    // 2f. monitors
    it('monitor output mutes on its ON button', () => {
        const patches: PatchMap = { 'bus-mon1': 'bus-mix1' };
        expect(getConnectionState(conn('bus-mon1', 'out-ph1'), reader(['bus-mon1-btn-on']), patches)).toBe('muted');
        expect(getConnectionState(conn('bus-mon1', 'out-ph1'), reader(), patches)).toBe('flow');
    });

    // 2g. stereo out
    it('stereo bus output mutes on its ON button or OUT fader', () => {
        expect(getConnectionState(conn('bus-stereo', 'bus-mon1'), reader(['bus-stereo-btn-on']), { 'bus-mon1': 'bus-stereo' })).toBe('muted');
        expect(getConnectionState(conn('bus-stereo', 'bus-mon1'), reader([], ['bus-stereo-fader-out']), { 'bus-mon1': 'bus-stereo' })).toBe('muted');
    });

    // 2h. MAIN OUT
    it('MAIN OUT ON button mutes the line into out-main', () => {
        const patches: PatchMap = { 'out-main': 'bus-stereo' };
        expect(getConnectionState(conn('bus-stereo', 'out-main'), reader(['out-main-btn-on']), patches)).toBe('muted');
        expect(getConnectionState(conn('bus-stereo', 'out-main'), reader(), patches)).toBe('flow');
    });

    // rule precedence
    it('inactive wins over control mutes, CH_ON gate wins over inactive', () => {
        // patched elsewhere + fader muted -> inactive (rule 1 runs first)
        expect(getConnectionState(conn('bus-mix2', 'out-main'),
            reader([], ['bus-mix2-fader-mst']), { 'out-main': 'bus-mix1' })).toBe('inactive');
        // CH_ON off runs before the patch check -> muted even if not patched
        expect(getConnectionState(conn('in-ch1', 'out-usba'),
            reader(['in-ch1-btn-on']), { 'out-usba': 'bus-stream' })).toBe('muted');
    });

    it('no matching rules falls through to flow', () => {
        expect(getConnectionState(conn('in-port-mic1', 'out-daw1'), reader(), NO_PATCHES)).toBe('flow');
    });
});

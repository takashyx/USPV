// Pure connection-state evaluation (REQUIREMENTS.md §2.1.3): decides per
// routing line whether audio is flowing, muted by a control, or the line is
// not patched at all. DOM access is injected through ControlReader so this
// module stays browser-free and unit-testable.

import type { Connection, ConnectionState, PatchMap } from '../shared/types';

export interface ControlReader {
    // true when the element exists and is NOT active (missing elements are
    // treated as "not off" — the rule silently passes)
    isBtnOff(id: string): boolean;
    // true when the element exists and its level is NaN or <= -60 dB
    // (missing elements are treated as not muted)
    isFaderMuted(id: string): boolean;
}

// Destinations with a patch selector: a connection into one of these is
// 'inactive' unless its source is the currently patched one.
const PATCH_DESTINATIONS = [
    'out-main', 'out-usba', 'out-usbb', 'out-usbc', 'out-usbsub',
    'bus-stream', 'bus-mon1', 'bus-mon2',
];

export function getConnectionState(
    conn: Connection,
    reader: ControlReader,
    patches: PatchMap,
): ConnectionState {
    const { isBtnOff, isFaderMuted } = reader;

    // 0. Global Input Channel mute: CH_ON (btn-on) gates ALL sends from this channel
    if (conn.fromNode.startsWith('in-ch') && isBtnOff(`${conn.fromNode}-btn-on`)) return 'muted';

    // 1. Check Output, Sub-bus Patches, and Input Channel Sources (determines 'inactive' state)
    if (PATCH_DESTINATIONS.includes(conn.toNode) || conn.toNode.startsWith('in-ch')) {
        const activeSrc = patches[conn.toNode];
        if (!activeSrc || conn.fromNode !== activeSrc) return 'inactive';
    }

    // 2. Check if the connection is ON (audio is flowing) or OFF (muted)

    // a. Input Channel to Stereo Bus (TO ST gates only this send, independent of CH_ON above)
    if (conn.fromNode.startsWith('in-ch') && conn.toNode === 'bus-stereo') {
        if (isBtnOff(`${conn.fromNode}-btn-tost`)) return 'muted';
        if (isFaderMuted(`${conn.fromNode}-knob-ch`)) return 'muted';
    }

    // b. Input Channel to Mix/FX sends
    if (conn.fromNode.startsWith('in-ch') && (conn.toNode.startsWith('bus-mix') || conn.toNode.startsWith('bus-fx'))) {
        const faderSuffix = conn.toNode.replace('bus-', ''); // mix1, mix2, fx1, fx2
        if (isBtnOff(`${conn.fromNode}-send-${faderSuffix}-on`)) return 'muted';
        if (isFaderMuted(`${conn.fromNode}-knob-${faderSuffix}`)) return 'muted';
    }

    // c. Oscillator to Buses sends
    if (conn.fromNode === 'bus-osc') {
        if (isBtnOff('bus-osc-btn-on')) return 'muted';
        const faderSuffix = conn.toNode.replace('bus-', ''); // stereo, mix1, mix2, fx1, fx2
        if (isBtnOff(`bus-osc-send-${faderSuffix}-on`)) return 'muted';
    }

    // d. FX Returns to Mixes / Stereo (per-send controls: ST = TO ST assign,
    //    MIX = send ON + send LEVEL knob — REQUIREMENTS §2.1.3/§4.8)
    if (conn.fromNode.startsWith('bus-fx')) {
        if (isBtnOff(`${conn.fromNode}-btn-on`)) return 'muted';
        if (isFaderMuted(`${conn.fromNode}-fader-rtn`)) return 'muted';
        if (conn.toNode === 'bus-stereo' && isBtnOff(`${conn.fromNode}-btn-tost`)) return 'muted';
        if (conn.toNode.startsWith('bus-mix')) {
            const sendSuffix = conn.toNode.replace('bus-', ''); // mix1, mix2
            if (isBtnOff(`${conn.fromNode}-send-${sendSuffix}-on`)) return 'muted';
            if (isFaderMuted(`${conn.fromNode}-knob-${sendSuffix}`)) return 'muted';
        }
    }

    // e. MIX Master Output
    if (conn.fromNode.startsWith('bus-mix')) {
        if (isBtnOff(`${conn.fromNode}-btn-on`)) return 'muted';
        if (isFaderMuted(`${conn.fromNode}-fader-mst`)) return 'muted';
        if (conn.toNode === 'bus-stereo' && isBtnOff(`${conn.fromNode}-btn-tost`)) return 'muted';
    }

    // f. Monitor Output
    if (conn.fromNode.startsWith('bus-mon') && isBtnOff(`${conn.fromNode}-btn-on`)) return 'muted';

    // g. STEREO OUT fader
    if (conn.fromNode === 'bus-stereo') {
        if (isBtnOff('bus-stereo-btn-on')) return 'muted'; // if it exists
        if (isFaderMuted('bus-stereo-fader-out')) return 'muted';
    }

    // h. MAIN OUT Output fader
    if ((conn.fromNode === 'out-main' || conn.toNode === 'out-main') && isBtnOff('out-main-btn-on')) {
        return 'muted';
    }

    return 'flow';
}

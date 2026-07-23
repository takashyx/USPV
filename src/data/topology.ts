// Connection topology data for the URX signal-flow diagram.
// Defines every possible routing line between nodes; the view layer decides
// per frame whether each one renders as flow / muted / inactive, and
// initializeSvgPaths() assigns each line's color from its source node's
// category (= the node header accent color).

import type { Connection, PatchMap } from '../shared/types';
import { INPUT_CHANNEL_IDS, MIX_FX_BUSES, SELECTABLE_SOURCES, ptIn, ptOut } from '../shared/constants';

// Current patch routing state. Keys are destination node ids, values are
// the currently selected source node id (updated live by the broker on
// portRef parameter notifications). getConnectionState() in the view layer
// uses this to mark non-selected sources as 'inactive'.
// NOTE: mutated in place by broker/demo — the object identity must never
// change (compat exposes this same object as window.currentPatches).
export const currentPatches: PatchMap = {
    'out-main': 'bus-mix1',
    'out-usba': 'bus-stream',
    'out-usbb': 'bus-mix1',
    'out-usbc': 'in-ch1',
    'out-usbsub': 'in-ch1',
    'bus-stream': 'bus-mix1',
    'bus-mon1': 'bus-mix1',
    'bus-mon2': 'bus-mix2',
    'in-ch1': 'in-port-mic1',
    'in-ch2': 'in-port-mic2',
    'in-ch34': 'in-port-aux',
    'in-ch56': 'in-port-usba',
    'in-ch78': 'in-port-usbb',
    'in-ch910': 'in-port-usbsub',
};

// Rebuilt in place by initConnections() — same identity caveat as above.
export const connections: Connection[] = [];

export function initConnections(model: string): void {
    const conns = connections;
    conns.length = 0;

    const link = (fromNode: string, toNode: string): Connection => ({
        from: ptOut(fromNode),
        fromNode,
        to: ptIn(toNode),
        toNode,
    });

    // Oscillator -> Buses
    ['bus-stereo', ...MIX_FX_BUSES].forEach(bus => conns.push(link('bus-osc', bus)));

    // Inputs -> Stereo Bus, then MIX 1 / MIX 2 / FX 1 / FX 2 sends
    ['bus-stereo', ...MIX_FX_BUSES].forEach(bus => {
        INPUT_CHANNEL_IDS.forEach(ch => conns.push(link(ch, bus)));
    });

    // Direct Outs -> USB DAW (mono channels feed 1 DAW out, stereo pairs feed 2)
    const dawSources = ['in-ch1', 'in-ch2',
        'in-ch34', 'in-ch34', 'in-ch56', 'in-ch56', 'in-ch78', 'in-ch78', 'in-ch910', 'in-ch910'];
    dawSources.forEach((ch, i) => conns.push(link(ch, `out-daw${i + 1}`)));
    if (model !== 'URX22') {
        conns.push(link('in-ch910', 'out-daw11'));
        conns.push(link('in-ch910', 'out-daw12'));
    }

    // FX Return -> Mix 1 & 2, then Stereo Bus
    ['bus-fx1', 'bus-fx2'].forEach(fx => {
        conns.push(link(fx, 'bus-mix1'));
        conns.push(link(fx, 'bus-mix2'));
    });
    conns.push(link('bus-fx1', 'bus-stereo'));
    conns.push(link('bus-fx2', 'bus-stereo'));

    // MIX 1/2 -> STEREO BUS
    conns.push(link('bus-mix1', 'bus-stereo'));
    conns.push(link('bus-mix2', 'bus-stereo'));

    // Mix/Stereo -> Streaming & Monitor buses
    ['bus-stream', 'bus-mon1', 'bus-mon2'].forEach(dest => {
        ['bus-mix1', 'bus-mix2', 'bus-stereo'].forEach(src => conns.push(link(src, dest)));
    });

    // Buses & direct inputs -> USB MAIN A/B/C & SUB outputs (selectable)
    ['out-usba', 'out-usbb', 'out-usbc', 'out-usbsub'].forEach(usb => {
        [...SELECTABLE_SOURCES, ...INPUT_CHANNEL_IDS].forEach(src => conns.push(link(src, usb)));
    });

    // Output Patch -> MAIN OUT (selectable)
    SELECTABLE_SOURCES.forEach(src => conns.push(link(src, 'out-main')));

    // Monitors -> Phones
    conns.push(link('bus-mon1', 'out-ph1'));
    conns.push(link('bus-mon2', 'out-ph2'));

    // Physical Input ports -> Input Channels (selectable input patch)
    const physicalInputNodeIds = ['in-port-mic1', 'in-port-mic2'];
    if (model !== 'URX22') {
        physicalInputNodeIds.push('in-port-mic3', 'in-port-mic4');
    }
    physicalInputNodeIds.push(
        'in-port-aux', 'in-port-usba', 'in-port-usbb', 'in-port-usbc',
        'in-port-daw12', 'in-port-daw34', 'in-port-daw56', 'in-port-daw78', 'in-port-daw910'
    );
    if (model !== 'URX22') {
        physicalInputNodeIds.push('in-port-daw1112');
    }
    physicalInputNodeIds.push('in-port-usbsub');
    if (model !== 'URX22') {
        physicalInputNodeIds.push('in-port-sdplay');
    }
    if (model === 'URX44V') {
        physicalInputNodeIds.push('in-port-hdmi');
    }

    INPUT_CHANNEL_IDS.forEach(chId => {
        physicalInputNodeIds.forEach(portId => conns.push(link(portId, chId)));
    });
}

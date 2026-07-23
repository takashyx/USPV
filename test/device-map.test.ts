import { describe, expect, it } from 'vitest';
import {
    chColorToHex,
    EXTRA_METERS,
    getMeterAddressForNode,
    INPUT_PORT_TO_NODE,
    MAIN_PORTS,
    METER_MAPPINGS,
    PARAM_MAPPINGS,
    PORT_TO_NODE,
    REVERSE_METER_MAP,
    REVERSE_PARAM_MAP,
    USB_PORTS,
} from '../src/data/device-map';

describe('device-map invariants', () => {
    it('every PARAM_MAPPINGS entry has integer paramId/x/y', () => {
        for (const [elId, spec] of Object.entries(PARAM_MAPPINGS)) {
            expect(Number.isInteger(spec.paramId), elId).toBe(true);
            expect(Number.isInteger(spec.x), elId).toBe(true);
            expect(Number.isInteger(spec.y), elId).toBe(true);
        }
    });

    it('every bool_stereo_pair entry carries rightY', () => {
        for (const [elId, spec] of Object.entries(PARAM_MAPPINGS)) {
            if (spec.type === 'bool_stereo_pair') {
                expect(Number.isInteger(spec.rightY), elId).toBe(true);
            }
        }
    });

    it('every portRef entry lists its selectable ports', () => {
        for (const [elId, spec] of Object.entries(PARAM_MAPPINGS)) {
            if (spec.type === 'portRef') {
                expect(Array.isArray(spec.ports), elId).toBe(true);
                expect(spec.ports!.length, elId).toBeGreaterThan(0);
            }
        }
    });

    it('REVERSE_PARAM_MAP contains the forward address of every mapping', () => {
        for (const [elId, spec] of Object.entries(PARAM_MAPPINGS)) {
            const addr = `${spec.paramId}:${spec.x}:${spec.y}`;
            const entries = REVERSE_PARAM_MAP[addr];
            expect(entries, addr).toBeDefined();
            expect(entries!.some(e => e.elId === elId), `${addr} -> ${elId}`).toBe(true);
        }
    });

    it('FX channel -> MIX sends follow the 342/352 block layout (y = FX index)', () => {
        // docs/device-mapping.md §4.3: tap +0 / level +1 / BAL +2 / on +3
        for (const [fx, y] of [['bus-fx1', 0], ['bus-fx2', 1]] as const) {
            for (const [mix, base] of [['mix1', 342], ['mix2', 352]] as const) {
                expect(PARAM_MAPPINGS[`${fx}-send-${mix}-pre`]).toEqual({ paramId: base, x: 0, y, type: 'bool' });
                expect(PARAM_MAPPINGS[`${fx}-knob-${mix}`]).toEqual({ paramId: base + 1, x: 0, y, type: 'level_knob' });
                expect(PARAM_MAPPINGS[`${fx}-knob-${mix}-pan`]).toEqual({ paramId: base + 2, x: 0, y, type: 'pan' });
                expect(PARAM_MAPPINGS[`${fx}-send-${mix}-on`]).toEqual({ paramId: base + 3, x: 0, y, type: 'bool' });
            }
        }
    });

    it('STREAMING carries name / delay / frame-rate mappings (y = 0)', () => {
        expect(PARAM_MAPPINGS['bus-stream-subtitle']).toEqual({ paramId: 702, x: 0, y: 0, type: 'string' });
        expect(PARAM_MAPPINGS['bus-stream-dsp-delay']).toEqual({ paramId: 707, x: 0, y: 0, type: 'bool' });
        expect(PARAM_MAPPINGS['bus-stream-knob-delay']).toEqual({ paramId: 708, x: 0, y: 0, type: 'delayTime' });
        expect(PARAM_MAPPINGS['bus-stream-frame-rate']).toEqual({ paramId: 830, x: 0, y: 0, type: 'frameRate' });
    });

    it('bus CH SETTING colors map their identity slots (335/586/496/704)', () => {
        expect(PARAM_MAPPINGS['bus-fx1']).toEqual({ paramId: 335, x: 0, y: 0, type: 'chColor' });
        expect(PARAM_MAPPINGS['bus-fx2']).toEqual({ paramId: 335, x: 0, y: 1, type: 'chColor' });
        expect(PARAM_MAPPINGS['bus-mix1']).toEqual({ paramId: 586, x: 0, y: 0, type: 'chColor' });
        expect(PARAM_MAPPINGS['bus-mix2']).toEqual({ paramId: 586, x: 0, y: 2, type: 'chColor' });
        expect(PARAM_MAPPINGS['bus-stereo']).toEqual({ paramId: 496, x: 0, y: 0, type: 'chColor' });
        expect(PARAM_MAPPINGS['bus-stream']).toEqual({ paramId: 704, x: 0, y: 0, type: 'chColor' });
        // MIX colors are L/R linked — the R-side notify resolves too
        expect(REVERSE_PARAM_MAP['586:0:1']!.map(e => e.elId)).toContain('bus-mix1');
        expect(REVERSE_PARAM_MAP['586:0:3']!.map(e => e.elId)).toContain('bus-mix2');
    });

    it('CH SETTING colors map the node ids themselves (mono 20 / stereo 208)', () => {
        expect(PARAM_MAPPINGS['in-ch1']).toEqual({ paramId: 20, x: 0, y: 0, type: 'chColor' });
        expect(PARAM_MAPPINGS['in-ch2']).toEqual({ paramId: 20, x: 0, y: 1, type: 'chColor' });
        expect(PARAM_MAPPINGS['in-ch34']).toEqual({ paramId: 208, x: 0, y: 0, type: 'chColor' });
        expect(PARAM_MAPPINGS['in-ch910']).toEqual({ paramId: 208, x: 0, y: 3, type: 'chColor' });
        // palette: array position = broker index; Off (10) and unknowns fall back
        expect(chColorToHex(0)).toBe('#4a78c0');  // Blue
        expect(chColorToHex(6)).toBe('#d9534f');  // Red
        expect(chColorToHex(10)).toBeNull();      // Off -> category color
        expect(chColorToHex(99)).toBeNull();
    });

    it('patch selectors (730/732-735) also answer on their R slot (y+1)', () => {
        for (const [addr, elId] of [
            ['730:0:1', 'out-main-ind-patch'],
            ['732:0:1', 'out-usba-ind-patch'],
            ['733:0:1', 'out-usbb-ind-patch'],
            ['734:0:1', 'out-usbc-ind-patch'],
            ['735:0:1', 'out-usbsub-ind-patch'],
        ] as const) {
            expect(REVERSE_PARAM_MAP[addr]?.map(e => e.elId), addr).toContain(elId);
        }
    });

    it('bus port refs resolve both L and R ids to the same node', () => {
        // docs/device-mapping.md §3.1: buses occupy L/R pairs at 0x100+
        for (const [l, node] of [[256, 'bus-stereo'], [258, 'bus-stream'], [288, 'bus-mix1'],
                                 [290, 'bus-mix2'], [336, 'bus-mon1'], [338, 'bus-mon2']] as const) {
            expect(PORT_TO_NODE[l]).toBe(node);
            expect(PORT_TO_NODE[l + 1]).toBe(node);
        }
        // input channels sit on the flat slot axis; stereo pairs take two slots
        expect(PORT_TO_NODE[2]).toBe('in-ch34');
        expect(PORT_TO_NODE[3]).toBe('in-ch34');
        expect(PORT_TO_NODE[9]).toBe('in-ch910');
    });

    it('REVERSE_PARAM_MAP covers stereo-pair, dgain-R and SSMCS supplements', () => {
        // Oscillator stereo-pair sends answer on the R-side y too
        expect(REVERSE_PARAM_MAP['716:0:1']!.map(e => e.elId)).toContain('bus-osc-send-stereo-on');
        // Stereo input D.GAIN answers on y+1
        expect(REVERSE_PARAM_MAP['9:0:1']!.map(e => e.elId)).toContain('in-ch34-knob-gain');
        // SSMCS COMP/EQ aliases with inverted logic
        expect(REVERSE_PARAM_MAP['94:0:0']![0]).toEqual({ elId: 'in-ch1-dsp-comp', type: 'bool_ssmcs' });
        expect(REVERSE_PARAM_MAP['106:0:1']![0]).toEqual({ elId: 'in-ch2-dsp-eq', type: 'bool_ssmcs' });
    });

    it('REVERSE_METER_MAP is the exact inverse of METER_MAPPINGS', () => {
        for (const [elId, spec] of Object.entries(METER_MAPPINGS)) {
            const addr = `${spec.meterId}:${spec.x}`;
            expect(REVERSE_METER_MAP[addr], addr).toContain(elId);
        }
        const totalReverse = Object.values(REVERSE_METER_MAP).reduce((n, ids) => n + ids.length, 0);
        expect(totalReverse).toBe(Object.keys(METER_MAPPINGS).length);
    });

    it('port tables resolve to known node id shapes', () => {
        for (const node of Object.values(PORT_TO_NODE)) {
            expect(node).toMatch(/^(bus-|in-ch)/);
        }
        for (const node of Object.values(INPUT_PORT_TO_NODE)) {
            expect(node).toMatch(/^in-port-/);
        }
        // MAIN OUT candidates are a subset of the USB candidates
        expect(USB_PORTS).toEqual(expect.arrayContaining(MAIN_PORTS));
        // Every MAIN/USB candidate port resolves through PORT_TO_NODE
        for (const port of USB_PORTS) {
            expect(PORT_TO_NODE[port], `port ${port}`).toBeDefined();
        }
    });

    it('EXTRA_METERS addresses are well-formed and follow-targets resolve', () => {
        for (const addr of EXTRA_METERS) {
            expect(addr).toMatch(/^\d+:\d+$/);
        }
        // Every node the USB-follow logic can point at yields an address
        for (const node of Object.values(PORT_TO_NODE)) {
            expect(getMeterAddressForNode(node), node).toMatch(/^\d+:\d+$/);
        }
        expect(getMeterAddressForNode('out-daw1')).toBeNull();
    });
});

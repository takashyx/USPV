import { describe, expect, it } from 'vitest';
import { METER_MAPPINGS } from '../src/data/device-map';
import { defaultTapKey, NODE_METER_TAPS } from '../src/data/meter-taps';

describe('meter tap table', () => {
    it('every node has taps and a resolvable default', () => {
        for (const [nodeId, taps] of Object.entries(NODE_METER_TAPS)) {
            expect(taps.length, nodeId).toBeGreaterThan(0);
            expect(taps.some(t => t.key === defaultTapKey(nodeId)), nodeId).toBe(true);
        }
    });

    it('the default taps reproduce the static METER_MAPPINGS addresses', () => {
        // The tap system must start exactly where the fixed mapping was:
        // input channels on INPUT, buses on POST, stream/mon on OUT.
        for (const [nodeId, taps] of Object.entries(NODE_METER_TAPS)) {
            const def = taps.find(t => t.key === defaultTapKey(nodeId))!;
            const l = METER_MAPPINGS[`${nodeId}-meter`];
            expect(l, nodeId).toBeDefined();
            expect([l!.meterId, l!.x], `${nodeId} L`).toEqual([def.l[0], def.l[1]]);
            const r = METER_MAPPINGS[`${nodeId}-meter-r`];
            if (r) {
                expect(def.r, `${nodeId} R`).toBeDefined();
                expect([r.meterId, r.x], `${nodeId} R`).toEqual([def.r![0], def.r![1]]);
            }
        }
    });

    it('mono channel chains run INPUT..POST; FX PRE FADER is a mono tap', () => {
        expect(NODE_METER_TAPS['in-ch1']!.map(t => t.key)).toEqual(
            ['input', 'pregate', 'precomp', 'preeq', 'preinsfx', 'prefader', 'post']);
        const fxPre = NODE_METER_TAPS['bus-fx2']!.find(t => t.key === 'prefader')!;
        expect(fxPre.l).toEqual([131, 1]);
        expect(fxPre.r).toBeUndefined();
    });

    it('single-tap nodes (STREAMING / MONITOR) cannot cycle', () => {
        expect(NODE_METER_TAPS['bus-stream']).toHaveLength(1);
        expect(NODE_METER_TAPS['bus-mon1']).toHaveLength(1);
        expect(NODE_METER_TAPS['bus-mon2']).toHaveLength(1);
    });
});

import { describe, expect, it } from 'vitest';
import { connections, initConnections } from '../src/data/topology';

function nodes(kind: 'fromNode' | 'toNode'): Set<string> {
    return new Set(connections.map(c => c[kind]));
}

describe('initConnections', () => {
    it('URX44V includes hdmi/sdplay/mic3-4/daw11-12', () => {
        initConnections('URX44V');
        const from = nodes('fromNode');
        const to = nodes('toNode');
        expect(from).toContain('in-port-hdmi');
        expect(from).toContain('in-port-sdplay');
        expect(from).toContain('in-port-mic3');
        expect(to).toContain('out-daw11');
        expect(to).toContain('out-daw12');
    });

    it('URX44 has sdplay/mic3-4/daw11-12 but no hdmi', () => {
        initConnections('URX44');
        const from = nodes('fromNode');
        expect(from).not.toContain('in-port-hdmi');
        expect(from).toContain('in-port-sdplay');
        expect(from).toContain('in-port-mic3');
        expect(nodes('toNode')).toContain('out-daw11');
    });

    it('URX22 drops hdmi/sdplay/mic3-4/daw1112/daw11-12', () => {
        initConnections('URX22');
        const from = nodes('fromNode');
        const to = nodes('toNode');
        expect(from).not.toContain('in-port-hdmi');
        expect(from).not.toContain('in-port-sdplay');
        expect(from).not.toContain('in-port-mic3');
        expect(from).not.toContain('in-port-mic4');
        expect(from).not.toContain('in-port-daw1112');
        expect(to).not.toContain('out-daw11');
        expect(to).not.toContain('out-daw12');
    });

    it('every endpoint id follows the pt-<node>-in/out pattern', () => {
        initConnections('URX44V');
        for (const c of connections) {
            expect(c.from).toBe(`pt-${c.fromNode}-out`);
            expect(c.to).toBe(`pt-${c.toNode}-in`);
        }
    });

    it('rebuilding keeps the array identity and expected counts per model', () => {
        const ref = connections;
        initConnections('URX44V');
        const count44v = connections.length;
        initConnections('URX22');
        expect(connections).toBe(ref);
        expect(connections.length).toBeLessThan(count44v);
        // URX44V: 16 physical-input ports vs URX22: 11, DAW outs 12 vs 10.
        // 6 input channels x 5 fewer ports = 30, plus 2 DAW lines = 32.
        expect(count44v - connections.length).toBe(32);
    });
});

import { describe, expect, it } from 'vitest';
import { expandAddrRange } from '../src/devmode/subs-panel';

describe('expandAddrRange', () => {
    it('expands n-m ranges per part', () => {
        expect(expandAddrRange('meters', '125:0-1')).toEqual(['125:0', '125:1']);
        expect(expandAddrRange('parameters', '900-901:0:0-1')).toEqual(
            ['900:0:0', '900:0:1', '901:0:0', '901:0:1']);
    });

    it('rejects bad syntax, reversed ranges and the wrong part count', () => {
        expect(expandAddrRange('parameters', '1:2')).toBeNull();
        expect(expandAddrRange('meters', '125:3-1')).toBeNull();
        expect(expandAddrRange('meters', '12x:0')).toBeNull();
    });

    it('caps the expansion at 512 addresses', () => {
        expect(expandAddrRange('parameters', '0-7:0-7:0-7')).toHaveLength(512);
        expect(expandAddrRange('parameters', '0-7:0-7:0-8')).toBeNull();
    });

    it('rejects endpoints beyond the safe-integer range instead of looping forever', () => {
        // 2^53: `v++` would no longer advance (regression: infinite loop)
        expect(expandAddrRange('parameters', '9007199254740992:0:0')).toBeNull();
        expect(expandAddrRange('meters', '1-9007199254740993:0')).toBeNull();
        expect(expandAddrRange('meters', '99999999999999999999:0')).toBeNull();
    });
});

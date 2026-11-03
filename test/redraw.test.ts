import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const drawLines = vi.fn();
vi.mock('../src/view/render', () => ({ drawLines: () => drawLines() }));

import { debouncedDrawLines, setSyncingInitial } from '../src/broker/redraw';

describe('debouncedDrawLines', () => {
    beforeEach(() => { vi.useFakeTimers(); drawLines.mockClear(); setSyncingInitial(false); });
    afterEach(() => { vi.useRealTimers(); });

    it('coalesces a burst into one redraw after the quiet window', () => {
        debouncedDrawLines();
        debouncedDrawLines();
        vi.advanceTimersByTime(49);
        expect(drawLines).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(drawLines).toHaveBeenCalledTimes(1);
    });

    it('still redraws periodically while requests keep arriving faster than the window', () => {
        // regression: a 20ms stream used to postpone the redraw indefinitely
        for (let t = 0; t < 2000; t += 20) {
            debouncedDrawLines();
            vi.advanceTimersByTime(20);
        }
        expect(drawLines.mock.calls.length).toBeGreaterThanOrEqual(8);
    });

    it('is suppressed during the initial sync gate', () => {
        setSyncingInitial(true);
        debouncedDrawLines();
        vi.advanceTimersByTime(500);
        expect(drawLines).not.toHaveBeenCalled();
    });
});

// Debounced line redraw shared by every device/demo/UI update path, with
// the initial-sync gate that suppresses flickering during the WebSocket
// data flood right after a connection.

import { drawLines } from '../view/render';

const DEBOUNCE_MS = 50;   // quiet window: lets simultaneous parameter updates land in the DOM first
const MAX_WAIT_MS = 200;  // a continuous stream (fader drag notifications) still redraws at this rate

let isSyncingInitial = false;
let drawLinesTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSince = 0; // when the current pending redraw was first requested

export function setSyncingInitial(v: boolean): void {
    isSyncingInitial = v;
}

function flushDrawLines(): void {
    drawLinesTimeout = null;
    drawLines();
}

export function debouncedDrawLines(): void {
    if (isSyncingInitial) return; // Suppress redrawing during batch updates

    const now = Date.now();
    if (drawLinesTimeout) {
        clearTimeout(drawLinesTimeout);
    } else {
        pendingSince = now;
    }
    // Trailing-edge debounce, capped: requests arriving faster than the
    // quiet window must not postpone the redraw indefinitely
    const remaining = Math.max(0, pendingSince + MAX_WAIT_MS - now);
    drawLinesTimeout = setTimeout(flushDrawLines, Math.min(DEBOUNCE_MS, remaining));
}

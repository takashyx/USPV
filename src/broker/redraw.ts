// Debounced line redraw shared by every device/demo/UI update path, with
// the initial-sync gate that suppresses flickering during the WebSocket
// data flood right after a connection.

import { drawLines } from '../view/render';

let isSyncingInitial = false;
let drawLinesTimeout: ReturnType<typeof setTimeout> | null = null;

export function setSyncingInitial(v: boolean): void {
    isSyncingInitial = v;
}

export function debouncedDrawLines(): void {
    if (isSyncingInitial) return; // Suppress redrawing during batch updates

    if (drawLinesTimeout) {
        clearTimeout(drawLinesTimeout);
    }

    drawLinesTimeout = setTimeout(() => {
        drawLines();
        drawLinesTimeout = null;
    }, 50); // 50ms debounce window to ensure all simultaneous parameter updates are fully processed in the DOM
}

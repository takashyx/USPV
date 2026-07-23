// DOM-backed ControlReader implementation. Control-element lookups
// (id -> element, misses stored as null) are cached across evaluation
// passes; initializeSvgPaths() clears the cache after every DOM rebuild
// (broker init / model switch).

import type { ControlReader } from './connection-state';

const controlCache = new Map<string, HTMLElement | null>();

export function clearControlCache(): void {
    controlCache.clear();
}

function getControlEl(id: string): HTMLElement | null {
    let el = controlCache.get(id);
    if (el === undefined) {
        el = document.getElementById(id);
        controlCache.set(id, el);
    }
    return el;
}

export const domControlReader: ControlReader = {
    isBtnOff(id) {
        const btn = getControlEl(id);
        return !!btn && !btn.classList.contains('active');
    },
    isFaderMuted(id) {
        const fader = getControlEl(id) as (HTMLElement & { value?: string }) | null;
        if (!fader) return false;
        // Range faders carry .value; knobs keep their dB in dataset.value.
        // NaN (missing/garbled) deliberately counts as muted.
        const val = fader.value !== undefined
            ? parseFloat(fader.value)
            : parseFloat(fader.dataset.value as string);
        return isNaN(val) || val <= -60;
    },
};

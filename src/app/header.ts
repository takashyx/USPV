// Header controls: ON/OFF toggles, font size stepper, hamburger collapse
// and the Config Export / Load buttons.
//
// All header toggles default ON (REQUIREMENTS.md §5.2); the last state
// is auto-saved and restored across reloads.

import { ConfigStore } from '../config/config-store';
import { updateHighlights } from '../view/highlight';
import { t } from './i18n';
import { drawLines } from '../view/render';
import { viewState } from '../view/view-state';
import { appState } from './app-state';
import { adjustSectionPadding, sizeFixedColumns } from './layout';

// Shared wiring for the header ON/OFF toggles: restore the saved state,
// sync the track with it, then flip the state, save and re-sync on click.
// The state lives in a state module or a local variable depending on the
// toggle, so it is accessed through getter/setter closures. The restore
// applies set() only — no onChange — because the initial layout/draw
// passes have not run yet and will pick the restored state up on their own.
function wireHeaderToggle(
    toggleId: string,
    trackId: string,
    get: () => boolean,
    set: (v: boolean) => void,
    persistKey: string,
    onChange?: () => void,
): void {
    const saved = ConfigStore.get(persistKey);
    if (typeof saved === 'boolean' && saved !== get()) set(saved);
    const track = document.getElementById(trackId)!;
    track.classList.toggle('on', get());
    document.getElementById(toggleId)!.addEventListener('click', () => {
        set(!get());
        ConfigStore.set(persistKey, get());
        track.classList.toggle('on', get());
        if (onChange) onChange();
    });
}

export function initHeaderToggles(): void {
    // ---- Scroll to Selection Toggle (follow the highlighted flow) ----
    wireHeaderToggle('scroll-to-selection-toggle', 'scroll-to-selection-track',
        () => appState.scrollToSelectionEnabled, v => { appState.scrollToSelectionEnabled = v; },
        'scrollToSelection');

    // ---- Hide Muted Toggle (state lives in the view layer) ----
    wireHeaderToggle('hide-muted-toggle', 'hide-muted-track',
        () => viewState.hideMuted, v => { viewState.hideMuted = v; },
        'hideMuted',
        () => drawLines());

    // ---- Focus View suppression toggles (state lives in the view layer) ----
    // UI order: Nodes / Effects / Scroll (REQUIREMENTS.md §2.2.6)

    // Nodes: Path Only hides off-path nodes entirely — the column layout
    // (spacers, centering, line endpoints) must be recomputed when it flips
    // while a selection is active
    wireHeaderToggle('focus-nodes-toggle', 'focus-nodes-track',
        () => viewState.focusNodesPathOnly, v => { viewState.focusNodesPathOnly = v; },
        'focusNodesPathOnly',
        () => {
            updateHighlights();
            if (viewState.activeNodeId) adjustSectionPadding();
        });

    wireHeaderToggle('focus-effects-toggle', 'focus-effects-track',
        () => viewState.focusEffectsPathOnly, v => { viewState.focusEffectsPathOnly = v; },
        'focusEffectsPathOnly');

    wireHeaderToggle('focus-scroll-toggle', 'focus-scroll-track',
        () => viewState.focusScrollPathOnly, v => { viewState.focusScrollPathOnly = v; },
        'focusScrollPathOnly');
}

// ---- Scroll to Change Toggle (read by the view/broker on param updates) ----
export function initScrollToChangeToggle(): void {
    wireHeaderToggle('scroll-to-change-toggle', 'scroll-to-change-track',
        () => appState.scrollToChangeEnabled, v => { appState.scrollToChangeEnabled = v; },
        'scrollToChange');
}

// ---- Font size - / + buttons (header CONFIG group) ----
// 5 steps; level 1 (default) is the design's base size and each step adds
// 1px to every font via --font-boost (all font-size declarations are
// calc(basepx + var(--font-boost))). Text size drives node sizes, so the
// column layout and lines are re-derived on every change.
export function initFontSize(): void {
    const FONT_LEVEL_MIN = 1;
    const FONT_LEVEL_MAX = 5;
    let fontLevel = FONT_LEVEL_MIN;

    function applyFontLevel() {
        document.documentElement.style.setProperty('--font-boost', (fontLevel - 1) + 'px');
        document.getElementById('font-size-level')!.textContent = `${fontLevel}/${FONT_LEVEL_MAX}`;
        (document.getElementById('btn-font-minus') as HTMLButtonElement).disabled = fontLevel <= FONT_LEVEL_MIN;
        (document.getElementById('btn-font-plus') as HTMLButtonElement).disabled = fontLevel >= FONT_LEVEL_MAX;
        // node natural widths follow the text size — re-derive the fixed columns
        sizeFixedColumns();
    }

    function stepFontLevel(delta: number) {
        const next = Math.min(FONT_LEVEL_MAX, Math.max(FONT_LEVEL_MIN, fontLevel + delta));
        if (next === fontLevel) return;
        fontLevel = next;
        ConfigStore.set('fontSize', fontLevel);
        applyFontLevel();
        adjustSectionPadding();
    }

    const saved = ConfigStore.get('fontSize');
    if (Number.isInteger(saved) && saved >= FONT_LEVEL_MIN && saved <= FONT_LEVEL_MAX) fontLevel = saved;
    applyFontLevel();

    document.getElementById('btn-font-minus')!.addEventListener('click', () => stepFontLevel(-1));
    document.getElementById('btn-font-plus')!.addEventListener('click', () => stepFontLevel(1));
}

// ---- Header hamburger (collapse everything except the title) ----
// Collapsed is the default: the centered app title, the model select and
// the connection status (re-parented into #header-mini on the right) and
// the hamburger itself stay visible. Expanding puts the select/status
// back into the Device Center box. User toggles animate: the header
// height transitions via a pin (.header-h-anim), the appearing content
// fades/slides in (header-fade-in) and the hamburger bars morph into
// stacked ^ chevrons (all in css/styles.css).
export function initHeaderHamburger(): void {
    const headerEl = document.getElementById('app-header')!;
    const mini = document.getElementById('header-mini')!;
    let headerAnimTimer: ReturnType<typeof setTimeout> | null = null;

    // Fixed anchors for the way back: the select + FW version go to the
    // end of the DEVICE model row, the status pair + sample rate in front
    // of the Connect button (which never moves) in the middle row.
    function placeMiniElements(collapsed: boolean) {
        const select = document.getElementById('model-select')!;
        const dot = document.getElementById('sync-status-dot')!;
        const status = document.getElementById('sync-status')!;
        const rate = document.getElementById('sample-rate')!;
        const firmware = document.getElementById('firmware-version')!;
        if (collapsed) {
            mini.append(dot, status, rate, select, firmware);
        } else {
            const connectBtn = document.getElementById('sync-connect-btn')!;
            document.getElementById('device-model-row')!.append(select, firmware);
            connectBtn.parentElement!.insertBefore(rate, connectBtn);
            rate.parentElement!.insertBefore(status, rate);
            status.parentElement!.insertBefore(dot, status);
        }
    }

    function applyHeaderCollapsed(on: boolean, animate: boolean) {
        const h0 = headerEl.offsetHeight;
        headerEl.classList.toggle('header-collapsed', on);
        placeMiniElements(on);
        adjustSectionPadding();
        if (!animate) return;

        const h1 = headerEl.offsetHeight;
        if (h0 === h1) return;
        // Pin the old height transition-free, then transition to the new
        // one (same recipe as the node/column animations)
        if (headerAnimTimer !== null) clearTimeout(headerAnimTimer);
        headerEl.classList.remove('header-h-anim');
        headerEl.style.boxSizing = 'border-box';
        headerEl.style.overflow = 'hidden';
        headerEl.style.height = h0 + 'px';
        void headerEl.offsetHeight;
        headerEl.classList.add('header-h-anim');
        headerEl.style.height = h1 + 'px';
        headerAnimTimer = setTimeout(() => {
            headerEl.classList.remove('header-h-anim');
            headerEl.style.height = '';
            headerEl.style.overflow = '';
            headerEl.style.boxSizing = '';
            adjustSectionPadding();
        }, 1060);
    }

    const saved = ConfigStore.get('headerCollapsed');
    let headerCollapsed = typeof saved === 'boolean' ? saved : true;
    applyHeaderCollapsed(headerCollapsed, false);
    document.getElementById('header-menu-btn')!.addEventListener('click', () => {
        headerCollapsed = !headerCollapsed;
        ConfigStore.set('headerCollapsed', headerCollapsed);
        applyHeaderCollapsed(headerCollapsed, true);
    });
}

// ---- Config Export / Load (header CONFIG group) ----
// Export downloads the auto-saved settings as a readable JSON file; Load
// imports one and reloads the page, so every restore path (model,
// collapse, DAW, demo) runs through the normal startup flow.
export function initConfigButtons(): void {
    document.getElementById('btn-config-export')!.addEventListener('click', () => {
        const blob = new Blob([ConfigStore.exportText()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `uspv-config-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    });

    document.getElementById('btn-config-load')!.addEventListener('click', () => {
        document.getElementById('config-file-input')!.click();
    });

    document.getElementById('config-file-input')!.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files && input.files[0];
        input.value = ''; // allow re-picking the same file later
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                ConfigStore.importText(reader.result as string);
                location.reload();
            } catch (err) {
                alert(t('Could not load the settings file:') + '\n' + (err as Error).message);
            }
        };
        reader.readAsText(file);
    });
}

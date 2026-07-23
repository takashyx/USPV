// Developer mode ("Dev" toggle in the Device Center header group): tooling
// for building out the device mapping tables.
//
//  - Outlines every control that has UI but no PARAM_MAPPINGS /
//    METER_MAPPINGS entry for its id in red (.dev-unmapped).
//  - Streams the raw Device Center WebSocket traffic (RX/TX) into a console
//    docked under the diagram. Meter frames are dropped unless enabled —
//    they arrive continuously and would immediately flood the log.
//  - Click any outlined (or mapped) control to start a capture: operate the
//    matching control on the actual hardware, and every parameter
//    notification that arrives is recorded under that element. "Copy
//    Report" exports all captures as markdown — observed addresses, value
//    sequences, existing assignments and a suggested mapping entry — ready
//    to paste into an issue or a fix request.
//
// This file is the orchestrator: the dev toggle, the panel tabs, the
// shared pick machinery and the cross-mode event wiring. The modes
// themselves live in capture.ts / flags.ts / trymap.ts, the console in
// console-log.ts and the SUBSCRIBE panel in subs-panel.ts.

import { EVENT_LANG_CHANGED, refreshTooltips } from '../app/i18n';
import { registerTrafficHooks } from '../broker/hooks';
import { deviceSync } from '../broker/socket';
import { ConfigStore } from '../config/config-store';
import { METER_MAPPINGS, PARAM_MAPPINGS } from '../data/device-map';
import { EVENT_MODEL_SWITCHED } from '../shared/constants';
import { drawLines } from '../view/render';
import { initCaptureMode } from './capture';
import { initDevConsole, parseVdp, summarizeMsg } from './console-log';
import { initFlagsMode } from './flags';
import { DEV_PANEL_HTML } from './panel-html';
import { CANDIDATE_SELECTOR, DERIVED_IDS } from './pick-card';
import { setReportText, wireReportButtons } from './report';
import { initSubsPanel } from './subs-panel';
import { initTrymapMode } from './trymap';

type SubMode = 'capture' | 'ghost' | 'mislink' | 'trymap';

export function initDevmode(): void {
    let devMode = false;

    // ---------------------------------------------------------------
    // Panel DOM (created once, shown/hidden with the toggle)
    // ---------------------------------------------------------------

    document.body.insertAdjacentHTML('beforeend', DEV_PANEL_HTML);
    // The panel arrives after initI18n's startup pass — pull its static
    // tooltips into the active language now
    refreshTooltips();

    const panel = document.getElementById('dev-panel')!;

    // ---------------------------------------------------------------
    // Target picking, shared by every mode. Armed with a Pick button;
    // while armed every click/press outside the dev panel is swallowed —
    // nothing reaches the normal handlers (node selection / focus view /
    // toggle writes to the device) — and clicking a candidate control
    // hands it to the active mode.
    // ---------------------------------------------------------------

    let picking = false;

    function setPicking(on: boolean): void {
        picking = on;
        document.body.classList.toggle('dev-picking', on);
        // While armed, every Pick button blinks and tells the user to click
        // a control; the label reverts as soon as something is selected
        document.querySelectorAll<HTMLElement>('.dev-pick-btn').forEach(b => {
            b.classList.toggle('active', on);
            if (on) {
                if (!b.dataset.label) b.dataset.label = b.textContent!;
                b.textContent = 'Click a control…';
            } else if (b.dataset.label) {
                b.textContent = b.dataset.label;
            }
        });
        capture.render();
    }

    const pickDeps = {
        isPicking: () => picking,
        togglePicking: () => setPicking(!picking),
        refreshReports: () => refreshReports(),
    };

    // ---------------------------------------------------------------
    // Modes & panels
    // ---------------------------------------------------------------

    const capture = initCaptureMode(pickDeps);
    const flags = initFlagsMode(pickDeps);
    const devConsole = initDevConsole(() => trymap.render()); // TRYMAP mirrors UNMAPPED
    const trymap = initTrymapMode({
        ...pickDeps,
        unmappedAddrRows: () => devConsole.unmappedAddrRows(),
        refreshObserved: () => devConsole.renderObserved(),
    });
    const subsPanel = initSubsPanel();

    function refreshReports(): void {
        setReportText(document.getElementById('dev-report-text') as HTMLTextAreaElement, capture.buildReport());
        setReportText(document.getElementById('dev-ghost-text') as HTMLTextAreaElement, flags.buildReport('ghost'));
        setReportText(document.getElementById('dev-mislink-text') as HTMLTextAreaElement, flags.buildReport('mislink'));
    }

    // ---------------------------------------------------------------
    // Sub-mode (panel tabs): 'capture' | 'ghost' | 'mislink' | 'trymap'
    // ---------------------------------------------------------------

    let subMode: SubMode = 'capture';
    // Board highlight CSS (unmapped outlines, capture/target glow) is
    // scoped to these body classes — they exist only while the CAPTURE
    // (or TRYMAP, which picks targets the same way) tab is active
    document.body.classList.add('dev-submode-capture');

    function setSubMode(mode: SubMode): void {
        if (subMode === mode) return;
        // leaving a mode: stop any in-progress pick/capture
        setPicking(false);
        if (subMode === 'capture') capture.finish();
        subMode = mode;
        document.body.classList.toggle('dev-submode-capture', mode === 'capture');
        document.body.classList.toggle('dev-submode-trymap', mode === 'trymap');
        // The whole panel takes the mode's accent color (border, heads)
        panel.classList.remove('mode-capture', 'mode-ghost', 'mode-mislink', 'mode-trymap');
        panel.classList.add(`mode-${mode}`);
        document.querySelectorAll<HTMLElement>('.dev-mode-tab').forEach(tab =>
            tab.classList.toggle('active', tab.dataset.mode === mode));
        (['capture', 'ghost', 'mislink', 'trymap'] as const).forEach(m => {
            document.getElementById(`dev-mode-${m}`)!.style.display = m === mode ? '' : 'none';
        });
        scanUnmapped(); // red outlines only make sense in capture mode
    }

    // ---------------------------------------------------------------
    // Unmapped-control scan
    // ---------------------------------------------------------------

    function isMapped(el: Element): boolean {
        if (!el.id) return false;
        return !!(PARAM_MAPPINGS[el.id] || METER_MAPPINGS[el.id] || DERIVED_IDS.has(el.id));
    }

    function scanUnmapped(): void {
        const container = document.getElementById('main-container')!;
        container.querySelectorAll('.dev-unmapped').forEach(el => el.classList.remove('dev-unmapped'));
        // red pick outlines belong to the modes that pick targets
        if (!devMode || (subMode !== 'capture' && subMode !== 'trymap')) return;
        container.querySelectorAll(CANDIDATE_SELECTOR).forEach(el => {
            if (!isMapped(el)) el.classList.add('dev-unmapped');
        });
    }

    // ---------------------------------------------------------------
    // Traffic hooks (RX feeds the log, the OBSERVED lists and any
    // running capture; TX feeds the log only)
    // ---------------------------------------------------------------

    registerTrafficHooks({
        rx: (msg) => {
            if (!devMode) return;
            const p = parseVdp(msg);
            if (p) devConsole.recordObserved(p); // counts even when the log drops meters
            if (p && p.kind === 'meter' && !devConsole.showMeters()) return; // flood guard
            devConsole.appendLog('rx', summarizeMsg(msg, p));
            if (p) capture.recordIfCapturing(p);
        },
        tx: (msg) => {
            if (!devMode) return;
            devConsole.appendLog('tx', summarizeMsg(msg, parseVdp(msg)));
        },
        subs: (subs) => subsPanel.renderSubs(subs),
    });

    // ---------------------------------------------------------------
    // Board pick handling: the target is picked on the press itself
    // ---------------------------------------------------------------

    function swallowWhilePicking(e: Event): boolean {
        if (!devMode || !picking) return false;
        if ((e.target as HTMLElement).closest('#dev-panel')) return false; // the console stays usable
        e.preventDefault();
        e.stopPropagation();
        return true;
    }

    function pickAt(e: Event): void {
        const el = (e.target as HTMLElement).closest<HTMLElement>(CANDIDATE_SELECTOR);
        if (!(el && document.getElementById('main-container')!.contains(el))) return; // miss: stay armed
        if (subMode === 'capture') {
            capture.start(el);
            setPicking(false); // capture is one-at-a-time — back to normal clicks
        } else if (subMode === 'trymap') {
            if (!el.id) return; // temp links resolve by element id — stay armed
            trymap.setTarget(el);
            setPicking(false); // one target at a time
        } else {
            // ghost / mislink: mark and stay armed for the next one (Esc ends)
            flags.add(subMode, el);
        }
    }

    // The target is picked on the press itself: a cancelled pointerdown
    // suppresses the browser's follow-up click, so selection must not wait
    // for a click event. The press's click (if the browser still fires one)
    // arrives after picking was already disarmed — swallow it via the
    // short-lived flag so it cannot reach the normal handlers.
    let swallowNextClick = false;

    document.addEventListener('pointerdown', (e) => {
        if (!swallowWhilePicking(e)) return;
        swallowNextClick = true;
        setTimeout(() => { swallowNextClick = false; }, 400);
        pickAt(e);
    }, true);

    // Native mousedown actions (slider drag, text selection) are blocked too
    document.addEventListener('mousedown', swallowWhilePicking, true);

    // ✕ beside every Pick button (visible only while a pick is armed —
    // body.dev-picking in css/styles.css): cancel the pick, same as Esc
    document.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.dev-pick-cancel')) setPicking(false);
    });

    document.addEventListener('click', (e) => {
        if (swallowNextClick) {
            swallowNextClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (swallowWhilePicking(e)) pickAt(e); // fallback: no pointer events
    }, true);

    document.addEventListener('keydown', (e) => {
        if (!devMode) return;
        // Text fields own their Enter (e.g. the ADD SUBSCRIPTION input)
        if (e.key === 'Enter' && (e.target as HTMLElement).closest && (e.target as HTMLElement).closest('input, textarea, select')) return;
        // Enter = Done: complete & record the running capture
        if (e.key === 'Enter' && capture.isRunning() && !picking) {
            e.stopPropagation();
            capture.finish();
            return;
        }
        // Esc = ✕: cancel picking, the running capture, or the picked
        // (not yet linked) TRYMAP target
        if (e.key !== 'Escape') return;
        if (picking) {
            e.stopPropagation();
            setPicking(false);
        } else if (capture.isRunning()) {
            e.stopPropagation();
            capture.cancel();
        } else if (subMode === 'trymap' && trymap.hasTarget()) {
            e.stopPropagation();
            trymap.clearTarget();
            trymap.render();
        }
    }, true);

    // ---------------------------------------------------------------
    // Toggle & wiring
    // ---------------------------------------------------------------

    function setDevMode(on: boolean): void {
        devMode = on;
        document.getElementById('dev-track')!.classList.toggle('on', on);
        (panel as HTMLElement).style.display = on ? 'flex' : 'none';
        if (!on) {
            setPicking(false);
            capture.finish();
            trymap.clearTarget();
            trymap.render();
        }
        scanUnmapped();
        flags.setHighlights(on);
        trymap.setHighlights(on);
        capture.render();
        subsPanel.renderSubs(deviceSync.getSubscriptions());
        ConfigStore.set('devMode', on);
        // The panel changes the diagram height — endpoints move
        drawLines();
    }

    document.getElementById('dev-toggle')!.addEventListener('click', () => setDevMode(!devMode));
    document.getElementById('dev-panel-min')!.addEventListener('click', () => {
        panel.classList.toggle('minimized');
        drawLines();
    });

    // Mode tabs
    document.querySelectorAll<HTMLElement>('.dev-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => setSubMode(tab.dataset.mode as SubMode));
    });

    // Right-side tabs: CONSOLE (default) / SUBSCRIPTIONS
    document.querySelectorAll<HTMLElement>('.dev-right-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const panelName = tab.dataset.panel;
            document.querySelectorAll<HTMLElement>('.dev-right-tab').forEach(other =>
                other.classList.toggle('active', other.dataset.panel === panelName));
            document.getElementById('dev-console')!.style.display = panelName === 'console' ? '' : 'none';
            document.getElementById('dev-subs')!.style.display = panelName === 'subs' ? '' : 'none';
        });
    });

    // REPORT columns: live-updated previews with Copy / Download only
    wireReportButtons('dev-report-copy', 'dev-report-dl', 'dev-report-text', 'capture');
    wireReportButtons('dev-ghost-copy', 'dev-ghost-dl', 'dev-ghost-text', 'ghost');
    wireReportButtons('dev-mislink-copy', 'dev-mislink-dl', 'dev-mislink-text', 'mislink');

    // Model switches rebuild the node DOM: the capture target element is
    // gone, and the outline / flag highlights must be recomputed
    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
        setPicking(false);
        capture.finish();
        scanUnmapped();
        flags.reattach();
        trymap.reattach(devMode);
    });

    // Language switches: the t()-built dynamic parts (lists, target card,
    // count chips) re-render; the guide/hints flip via CSS on html[lang]
    document.addEventListener(EVENT_LANG_CHANGED, () => {
        flags.renderAll();
        subsPanel.renderSubs(null);
        capture.render();
        trymap.render();
    });

    // Initial ① cards (empty state with the Pick button inside)
    flags.renderAll();
    trymap.render();

    if (ConfigStore.get('devMode') === true) setDevMode(true);
}

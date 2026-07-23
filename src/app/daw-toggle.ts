// DAW toggles (in the physical section headers). ON = USB DAW nodes shown
// (default); OFF hides them. The h2 (and its toggle) is rebuilt on every
// model switch, so clicks are handled by delegation and the visual state
// re-applied afterwards. User toggles animate: 0.6s node fade, anchored
// relayout (no visible jump), the column width transitions alongside, and
// the column settles with a smooth scroll (REQUIREMENTS.md §2.1.1/§5.2).

import { debouncedDrawLines } from '../broker/redraw';
import { ConfigStore } from '../config/config-store';
import { connections } from '../data/topology';
import { EVENT_MODEL_SWITCHED } from '../shared/constants';
import { drawLines, suppressChangeEffects } from '../view/render';
import {
    animateColumnWidths,
    captureBodyScrolls,
    clearGapAnim,
    lockNodeToZero,
    makeGenerationGuard,
    scheduleCollapseRedraw,
    WIDTH_ANIM_MS,
    zeroContributionMargin,
} from './animations';
import { adjustSectionPadding } from './layout';

const dawVisible: Record<string, boolean> = { 'col-physical-inputs': true, 'col-physical': true };

const DAW_FADE_MS = 600;
const dawToggleTimers = new Map<string, ReturnType<typeof setTimeout>>(); // sectionId -> pending phase timer
// Generation guard: a re-toggle mid-sequence invalidates every pending
// phase of the previous run, even if its timer already fired
const takeDawGeneration = makeGenerationGuard();

function applyDawToggles(): void {
    Object.entries(dawVisible).forEach(([sectionId, visible]) => {
        const section = document.getElementById(sectionId);
        if (!section) return;
        section.classList.toggle('hide-daw', !visible);
        const track = section.querySelector('.section-daw-toggle .toggle-track');
        if (track) track.classList.toggle('on', visible);
    });
}

function dawNodesOf(section: HTMLElement): HTMLElement[] {
    return Array.from(section.querySelectorAll<HTMLElement>('.node[id^="out-daw"], .node[id^="in-port-daw"]'));
}

// SVG groups of every connection touching the section's DAW nodes.
// Their fades run as WAAPI animations so the periodic drawLines passes
// (which rewrite inline opacity) can't stomp on them.
function dawLineGroups(section: HTMLElement): HTMLElement[] {
    const ids = new Set(dawNodesOf(section).map(n => n.id));
    const groups: HTMLElement[] = [];
    connections.forEach((conn, idx) => {
        if (ids.has(conn.fromNode) || ids.has(conn.toNode)) {
            const g = document.getElementById(`conn-group-${idx}`);
            if (g) groups.push(g);
        }
    });
    return groups;
}

// DAW toggle animation: nodes are added/removed, so unlike collapse this
// animates the GAPS —
//   OFF: fade the DAW nodes out (0.6s), then close the gaps (height ->
//        0 / margin-bottom -> zero-contribution, columns narrowing
//        alongside, 0.6s) and flip display:none jump-free
//   ON:  reveal at zero contribution (layout unchanged), open the gaps
//        to the natural heights (columns widening alongside, 0.6s),
//        then fade the nodes in (0.6s)
function animateDawToggle(section: HTMLElement, visible: boolean): void {
    const alive = takeDawGeneration(section.id);

    const track = section.querySelector('.section-daw-toggle .toggle-track');
    if (track) track.classList.toggle('on', visible);

    const body = section.querySelector('.section-body');
    const daws = dawNodesOf(section);
    const lineGroups = dawLineGroups(section);
    clearTimeout(dawToggleTimers.get(section.id));
    daws.forEach(n => {
        if (n.getAnimations) n.getAnimations().forEach(a => a.cancel());
        clearGapAnim(n);
        n.style.opacity = '';
    });
    // Cancel leftover fades AND clear the inline filter: when a filling
    // (fill:forwards) animation is replaced by a newer one, the browser
    // auto-commits its value into the inline style — without this the
    // committed filter:opacity(0) would keep the lines invisible forever
    const resetLineFades = () => lineGroups.forEach(g => {
        if (g.getAnimations) g.getAnimations().forEach(a => a.cancel());
        g.style.filter = '';
    });
    resetLineFades();

    if (!body || daws.length === 0 || typeof daws[0]!.animate !== 'function') {
        section.classList.toggle('hide-daw', !visible);
        adjustSectionPadding();
        return;
    }

    // No wipes/blinks/Scroll-to-Change during the toggle, and one redraw
    // window spanning every phase so the settle (spacers + smooth
    // centering) runs exactly once at the very end. Two 0.6s phases:
    // nodes AND their routing lines fade together, plus the gap motion.
    const TOTAL_MS = DAW_FADE_MS + WIDTH_ANIM_MS + 120;
    suppressChangeEffects(TOTAL_MS + 200);
    scheduleCollapseRedraw(TOTAL_MS);

    if (!visible) {
        // ---- Phase 1: fade the nodes and their lines out together ----
        daws.forEach(n => {
            n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DAW_FADE_MS, easing: 'ease', fill: 'forwards' });
        });
        // Fade via filter:opacity() — drawLines owns the groups' opacity
        // property (inline !important) but never touches their filter.
        // The end state is held by a PLAIN inline filter (set up front)
        // and the fill-less animation only smooths the way there — no
        // fill/replacement semantics that could strand a stale value.
        lineGroups.forEach(g => {
            g.style.filter = 'opacity(0)';
            g.animate([{ filter: 'opacity(1)' }, { filter: 'opacity(0)' }], { duration: DAW_FADE_MS, easing: 'ease' });
        });
        dawToggleTimers.set(section.id, setTimeout(() => {
            if (!alive()) return;
            // ---- Phase 2: close the gaps ----
            daws.forEach(n => { n.getAnimations().forEach(a => a.cancel()); n.style.opacity = '0'; });
            // The width measurement round-trips display:none (hide-daw),
            // which would silently kill any transition already running on
            // the DAW nodes — so pin the widths FIRST, then start the gap
            // transition (same task, one motion)
            animateColumnWidths(
                () => section.classList.add('hide-daw'),
                () => section.classList.remove('hide-daw'));
            // commit the start sizes transition-free, then animate to the
            // zero-contribution state (same recipe as the collapse anims)
            const startH = daws.map(n => n.offsetHeight);
            daws.forEach((n, i) => {
                n.style.overflow = 'hidden';
                n.style.height = startH[i] + 'px';
                n.style.marginBottom = '0px';
            });
            daws.forEach(n => void n.offsetHeight);
            daws.forEach(n => {
                n.classList.add('daw-gap-anim');
                n.style.height = '0px';
                n.style.marginBottom = zeroContributionMargin(n);
            });
            dawToggleTimers.set(section.id, setTimeout(() => {
                if (!alive()) return;
                // zero contribution == hidden: the flip moves nothing;
                // drawLines takes over hiding the dropped-endpoint lines
                section.classList.add('hide-daw');
                daws.forEach(n => { clearGapAnim(n); n.style.opacity = ''; });
                resetLineFades();
                drawLines(); // re-sync line visibility right away
            }, WIDTH_ANIM_MS + 60));
        }, DAW_FADE_MS));
    } else {
        // ---- Phase 1: open the gaps ----
        // Hold the lines invisible through the gap phase with a plain
        // inline filter (see the OFF note); the fade-in starts together
        // with the node fade in phase 2
        lineGroups.forEach(g => { g.style.filter = 'opacity(0)'; });
        // Reveal the nodes at zero layout contribution (identical layout
        // to hidden — no jump), measuring their natural heights on the
        // way; the momentary expanded layout must not clamp scrolls
        const restoreScrolls = captureBodyScrolls();
        section.classList.remove('hide-daw');
        const natH = daws.map(n => n.offsetHeight);
        daws.forEach(n => {
            n.style.opacity = '0';
            lockNodeToZero(n);
        });
        daws.forEach(n => void n.offsetHeight); // commit the zero state
        restoreScrolls();

        daws.forEach((n, i) => {
            n.classList.add('daw-gap-anim');
            n.style.height = natH[i] + 'px';
            n.style.marginBottom = '0px';
        });
        // widths grow toward the fully-revealed layout in the same motion
        animateColumnWidths(() => {}, null);

        dawToggleTimers.set(section.id, setTimeout(() => {
            if (!alive()) return;
            // ---- Phase 2: fade the nodes in (lines fade with them —
            // their delayed animations start at the same moment) ----
            daws.forEach(n => {
                clearGapAnim(n);
                const anim = n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DAW_FADE_MS, easing: 'ease' });
                anim.onfinish = () => { n.style.opacity = ''; };
            });
            lineGroups.forEach(g => {
                const anim = g.animate([{ filter: 'opacity(0)' }, { filter: 'opacity(1)' }], { duration: DAW_FADE_MS, easing: 'ease' });
                anim.onfinish = () => { g.style.filter = ''; anim.cancel(); };
            });
            dawToggleTimers.set(section.id, setTimeout(() => {
                if (!alive()) return;
                // sequence end: drop leftovers unconditionally and let the
                // normal redraw own the line visibility again
                resetLineFades();
                debouncedDrawLines();
            }, DAW_FADE_MS + 60));
        }, WIDTH_ANIM_MS + 60));
    }
}

export function initDawToggles(): void {
    // Restore saved visibility (only known sections, only booleans —
    // the blob may come from a newer/older build)
    const saved = ConfigStore.get('dawVisible');
    if (saved && typeof saved === 'object') {
        Object.keys(dawVisible).forEach(k => {
            if (typeof saved[k] === 'boolean') dawVisible[k] = saved[k];
        });
    }
    applyDawToggles();

    document.addEventListener('click', (e) => {
        const toggle = (e.target as HTMLElement).closest('.section-daw-toggle');
        if (!toggle) return;
        const section = toggle.closest('.section') as HTMLElement;
        dawVisible[section.id] = !dawVisible[section.id];
        ConfigStore.set('dawVisible', dawVisible);
        animateDawToggle(section, dawVisible[section.id]!);
    });

    document.addEventListener(EVENT_MODEL_SWITCHED, applyDawToggles);
}

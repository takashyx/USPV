// Shared animation machinery for the three coordinated layout animations
// (node collapse, DAW toggle, header collapse). They all follow the same
// fragile recipe:
//
//   1. measure the current sizes
//   2. flip classes / apply the final state invisibly and measure targets
//   3. pin the start sizes with inline styles, WITHOUT any transition
//      class active
//   4. flush layout once (commitPinsTransitionFree — no paint may happen
//      between 2 and 4)
//   5. apply the transition class and the target sizes together
//
// If the pin and the transition arrive in the same style commit, the
// browser starts a transition from the measuring-pass style toward the
// pin, and the real target then animates from there: a visible snap.

import { redrawLineGeometry } from '../view/render';
import { adjustSectionPadding, layoutSectionBody } from './layout';

const COLLAPSE_ANIM_MS = 600;
export const WIDTH_ANIM_MS = 600;
const NODE_GAP = 15; // .section-body flex gap

// Step 4 of the recipe: commit inline pins transition-free by forcing one
// reflow per element before the transition class is applied.
function commitPinsTransitionFree(els: Iterable<Element>): void {
    for (const el of els) void (el as HTMLElement).offsetWidth;
}

// Generation guard shared by re-triggerable multi-phase sequences: taking
// a new generation for a key invalidates every pending phase of the
// previous run, even if its timer already fired.
export function makeGenerationGuard(): (key: string) => () => boolean {
    const gens = new Map<string, number>();
    return (key: string) => {
        const gen = (gens.get(key) || 0) + 1;
        gens.set(key, gen);
        return () => gens.get(key) === gen;
    };
}

// The margin-bottom that gives a height-0 node ZERO layout contribution:
// it swallows the leftover border/padding box (height 0 is border-box)
// plus one flex gap — the layout is then identical to display:none, so
// flipping the display at the phase boundary never moves the other nodes.
export function zeroContributionMargin(node: HTMLElement): string {
    const cs = getComputedStyle(node);
    const minBox = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
        + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    return -(minBox + NODE_GAP) + 'px';
}

export function lockNodeToZero(node: HTMLElement): void {
    node.style.overflow = 'hidden';
    node.style.height = '0px';
    node.style.marginBottom = zeroContributionMargin(node);
}

export function clearGapAnim(node: HTMLElement): void {
    node.classList.remove('daw-gap-anim');
    node.style.height = '';
    node.style.marginBottom = '';
    node.style.overflow = '';
}

// Scroll save/restore around momentary layout flips (measuring passes,
// class swaps): shrinking the scrollable content makes the browser clamp
// scrollTop instantly and never restore it, so capture every section-body's
// position first and put it back once the flip is undone/locked.
export function captureBodyScrolls(): () => void {
    const bodies = Array.from(document.querySelectorAll<HTMLElement>('.section-body'));
    const saved = bodies.map(b => b.scrollTop);
    return () => bodies.forEach((b, i) => { if (b.scrollTop !== saved[i]) b.scrollTop = saved[i]!; });
}

// -------------------------------------------------------------
// Per-frame redraw loop while layout animations run
// -------------------------------------------------------------
// While node heights / column widths / DAW gaps are animating the lines
// only follow geometrically (redrawLineGeometry — a full drawLines pass
// per frame is what makes the animation stutter), and each affected
// column's spacers / paddings / centered scroll position are re-derived
// every frame too, so the layout settles continuously instead of
// jumping when the final adjustSectionPadding runs.
let collapseRedrawUntil = 0;
let collapseRedrawActive = false;
let collapseRedrawStart = 0;
const collapseScrollFrom = new Map<HTMLElement, number>(); // body -> scrollTop when the loop started

export function scheduleCollapseRedraw(ms: number): void {
    collapseRedrawUntil = Math.max(collapseRedrawUntil, performance.now() + ms);
    if (collapseRedrawActive) return;
    collapseRedrawActive = true;
    collapseRedrawStart = performance.now();
    collapseScrollFrom.clear();
    document.querySelectorAll<HTMLElement>('.section-body').forEach(body => {
        // cancel any still-running smooth scroll (e.g. a previous settle)
        // so it can't fight the per-frame blend — no duplicate autoscroll
        body.scrollTo({ top: body.scrollTop });
        collapseScrollFrom.set(body, body.scrollTop);
    });
    (function tick() {
        // Ease the centered scroll position from where the column was
        // toward its evolving target — a column crossing into "fits on
        // screen" mid-animation must not snap there in one frame. All
        // section bodies follow (the DAW gap animation moves the
        // physical columns too), so spacers grow/shrink continuously
        // instead of snapping in at the settle.
        const span = Math.max(1, collapseRedrawUntil - collapseRedrawStart);
        const p = Math.min(1, (performance.now() - collapseRedrawStart) / span);
        document.querySelectorAll<HTMLElement>('.section-body').forEach(body => {
            layoutSectionBody(body, true, { from: collapseScrollFrom.get(body) || 0, p });
        });
        redrawLineGeometry();
        if (performance.now() < collapseRedrawUntil) {
            requestAnimationFrame(tick);
        } else {
            collapseRedrawActive = false;
            // The bodies captured at start may have been replaced by a
            // model switch meanwhile — don't keep the old DOM alive
            collapseScrollFrom.clear();
            adjustSectionPadding();
        }
    })();
}

// -------------------------------------------------------------
// Height phase (node collapse view)
// -------------------------------------------------------------

export interface HeightChange {
    node: HTMLElement;
    on: boolean;
    startHeight?: number;
    endHeight?: number;
}

// Cleanup timers for in-flight height transitions (restart-safe)
const nodeHeightAnimTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

// Height phase: monotonic one-direction node height transitions.
//
//   1. measure every changing node's current height
//   2. flip the .collapse classes
//   3. measure every target height (the post-transition size)
//   4. lock each node to its start height via an inline style and a
//      height-only CSS transition class
//   5. flush layout once, then set the pre-measured target height
//
// No paint happens between steps 2 and 4 (same task), so the swap never
// renders an unlocked intermediate frame. Reads and writes are batched
// so a bulk toggle doesn't thrash layout once per node.
export function runHeightPhase(changes: HeightChange[]): void {
    // class flips clamp scrolls — restore once the start heights are locked
    const restoreScrolls = captureBodyScrolls();

    changes.forEach(c => {
        const timer = nodeHeightAnimTimers.get(c.node);
        if (timer) clearTimeout(timer);
        // mid-animation restarts continue from the current height
        c.startHeight = c.node.offsetHeight;
    });
    changes.forEach(c => {
        c.node.classList.remove('node-h-anim');
        c.node.style.height = '';
        c.node.classList.toggle('collapse', c.on);
    });
    changes.forEach(c => { c.endHeight = c.node.offsetHeight; });

    // Commit the start locks WITHOUT the transition class first (see the
    // recipe note at the top of this file), then apply the class and the
    // target height together
    changes.forEach(c => {
        if (c.startHeight === c.endHeight) return;
        c.node.style.height = c.startHeight + 'px';
    });
    commitPinsTransitionFree(changes.filter(c => c.startHeight !== c.endHeight).map(c => c.node));
    restoreScrolls();

    changes.forEach(c => {
        if (c.startHeight === c.endHeight) return;
        c.node.classList.add('node-h-anim');
        c.node.style.height = c.endHeight + 'px';
        // The remaining content pops in with the class switch — fade
        // it in over the height transition so the swap reads as one motion
        const body = c.node.querySelector('.node-body');
        if (body && typeof body.animate === 'function') {
            body.animate(
                [{ opacity: 0.1 }, { opacity: 1 }],
                { duration: COLLAPSE_ANIM_MS, easing: 'ease-out' }
            );
        }
        nodeHeightAnimTimers.set(c.node, setTimeout(() => {
            c.node.classList.remove('node-h-anim');
            c.node.style.height = '';
            nodeHeightAnimTimers.delete(c.node);
        }, COLLAPSE_ANIM_MS + 60));
    });

    scheduleCollapseRedraw(COLLAPSE_ANIM_MS + 50);
}

// -------------------------------------------------------------
// Width phase (columns)
// -------------------------------------------------------------

// Width phase: pins every column at its current width, applies the
// final state invisibly to pre-measure the target widths (prepareFinal
// may flip node classes for measuring; revertVisual restores what must
// stay on screen during the phase), then transitions all columns
// together — the totals stay constant, so freed space flows into the
// growing columns smoothly. Lines and spacers follow via the shared
// per-frame redraw loop.
let widthAnimCleanup: ((soft?: boolean) => void) | null = null;

export function cancelColumnWidthAnim(): void {
    if (widthAnimCleanup) widthAnimCleanup();
}

export function animateColumnWidths(prepareFinal: () => void, revertVisual: (() => void) | null): void {
    const sections = Array.from(document.querySelectorAll<HTMLElement>('#main-container > .section'));

    // The current (possibly mid-transition) widths become the new start.
    // A restart must NOT release the running pins first — that would
    // snap every column to its natural width for the new class state
    // before the next transition begins (visible as the whole frame
    // shrinking for an instant when Expand All interrupts a collapse).
    const startW = sections.map(s => s.getBoundingClientRect().width);
    if (widthAnimCleanup) widthAnimCleanup(true); // soft-cancel: timer only

    // Release the pins only for the natural-layout measurement below —
    // no paint happens before they are re-applied
    sections.forEach(s => {
        s.classList.remove('col-w-anim');
        s.style.width = '';
        s.style.boxSizing = '';
        s.style.flex = '';
        s.style.minWidth = '';
    });

    // the measuring flip must not clamp scrolls — restore around it
    const restoreScrolls = captureBodyScrolls();

    prepareFinal();
    const endW = sections.map(s => s.getBoundingClientRect().width);
    if (revertVisual) revertVisual();
    restoreScrolls();

    if (sections.every((_s, i) => Math.abs(startW[i]! - endW[i]!) < 1)) {
        return;
    }

    // Pin the start widths, flush transition-free, then apply the
    // transition class + target widths together (the shared recipe)
    sections.forEach((s, i) => {
        s.style.width = startW[i] + 'px';
        s.style.boxSizing = 'border-box';
        s.style.flex = '0 0 auto';
        s.style.minWidth = '0';
    });
    commitPinsTransitionFree(sections);
    sections.forEach((s, i) => {
        s.classList.add('col-w-anim');
        s.style.width = endW[i] + 'px';
    });
    scheduleCollapseRedraw(WIDTH_ANIM_MS + 50);

    const timer = setTimeout(() => finish(false), WIDTH_ANIM_MS + 60);
    widthAnimCleanup = finish;
    function finish(soft?: boolean) {
        clearTimeout(timer);
        widthAnimCleanup = null;
        if (soft) return; // superseded — the new run re-pins from here
        sections.forEach(s => {
            s.classList.remove('col-w-anim');
            s.style.width = '';
            s.style.boxSizing = '';
            s.style.flex = '';
            s.style.minWidth = '';
        });
    }
}

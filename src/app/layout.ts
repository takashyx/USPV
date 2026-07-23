// Scrolling & section layout: spacers, paddings, centered scroll
// positions, scroll fades, fixed-column measuring and heading
// equalization.

import { debouncedDrawLines } from '../broker/redraw';
import { container } from '../view/dom-refs';
import { drawLines } from '../view/render';
import { appState } from './app-state';

// Scroll target inside a section-body for a node, clamped so the node's top
// and bottom edges stay clear of the viewport AND of the 100px scroll-fade
// masks (which turn off at the scroll extremes, where range clamping takes
// over). align 'center' puts the node mid-viewport (Scroll to Change);
// 'top' keeps it near the top (Scroll to Selection, so nodes below the
// topmost highlight stay visible too). A node taller than the fade-free
// viewport shows its top edge in either mode.
function nodeScrollTarget(body: HTMLElement, node: HTMLElement, align: 'top' | 'center'): number {
    const EDGE_MARGIN = 112; // 100px fade zone + 12px breathing room
    const contentTop = node.offsetTop - body.offsetTop;
    const centered = contentTop - (body.clientHeight - node.offsetHeight) / 2;
    const keepTopVisible = contentTop - EDGE_MARGIN;                                            // upper bound
    const keepBottomVisible = contentTop + node.offsetHeight + EDGE_MARGIN - body.clientHeight; // lower bound
    const preferred = align === 'top' ? keepTopVisible : centered;
    const target = Math.min(keepTopVisible, Math.max(keepBottomVisible, preferred));
    return Math.min(body.scrollHeight - body.clientHeight, Math.max(0, target));
}

export function autoScrollToActiveNodes(): void {
    if (!appState.scrollToSelectionEnabled) return;

    // For each section, find all active-node elements within its section-body
    // and scroll so the topmost one is near the top
    document.querySelectorAll('.section').forEach(section => {
        const body = section.querySelector<HTMLElement>('.section-body');
        if (!body) return;

        // If content fits on screen (positive spacers = drag latitude),
        // settle back at the centered rest position (scrollTop = diff/2,
        // half the diff-sized top spacer)
        let diff = 0;
        const topSpacer = body.querySelector<HTMLElement>('.scroll-top-spacer');
        if (topSpacer) {
            diff = parseFloat(topSpacer.style.height) || 0;
        }
        if (diff > 0) {
            body.scrollTo({ top: diff / 2, behavior: 'smooth' });
            return;
        }

        const activeNodes = Array.from(body.querySelectorAll<HTMLElement>('.node.active-node'));
        if (activeNodes.length === 0) {
            // No active nodes in this section — scroll to top
            body.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        // Find the topmost active node (minimum offsetTop relative to section-body)
        let topmost = activeNodes[0]!;
        activeNodes.forEach(n => {
            if (n.offsetTop < topmost.offsetTop) {
                topmost = n;
            }
        });

        body.scrollTo({ top: nodeScrollTarget(body, topmost, 'top'), behavior: 'smooth' });
    });
}

// Scroll to Change: bring the given nodes into view — one scroll per section,
// the topmost affected node wins, and the node is centered vertically in its
// column as far as the scroll range allows (REQUIREMENTS.md §5.2). Columns
// that fit on screen keep their centered position. Called from the view on
// connection-state changes and from the broker on device parameter updates.
//
// Returns { scrolled, done }: how many sections actually started scrolling,
// and a promise that resolves once every smooth scroll has finished
// (scrollend per section, with a timeout fallback) — the change effects
// (node blink, line wipe) fire only after that.
export function scrollToNodes(nodeIds: Iterable<string>): { scrolled: number; done: Promise<unknown> } {
    const SCROLL_FALLBACK_MS = 800; // in case scrollend never fires

    const byBody = new Map<HTMLElement, HTMLElement>();
    for (const id of nodeIds) {
        const node = document.getElementById(id);
        if (!node) continue;
        const body = node.closest<HTMLElement>('.section-body');
        if (!body) continue;
        const current = byBody.get(body);
        if (!current || node.offsetTop < current.offsetTop) byBody.set(body, node);
    }

    const waits: Promise<void>[] = [];
    byBody.forEach((node, body) => {
        const topSpacer = body.querySelector<HTMLElement>('.scroll-top-spacer');
        const diff = topSpacer ? (parseFloat(topSpacer.style.height) || 0) : 0;
        if (diff > 0) return; // column fits on screen — nothing to scroll

        const clamped = nodeScrollTarget(body, node, 'center');
        if (Math.abs(body.scrollTop - clamped) < 1) return; // already there

        body.scrollTo({ top: clamped, behavior: 'smooth' });
        waits.push(new Promise(resolve => {
            const finish = () => {
                clearTimeout(fallback);
                body.removeEventListener('scrollend', finish);
                resolve();
            };
            const fallback = setTimeout(finish, SCROLL_FALLBACK_MS);
            body.addEventListener('scrollend', finish);
        }));
    });

    return { scrolled: waits.length, done: Promise.all(waits) };
}

// Recomputes one section-body's spacers, paddings and (for columns that
// fit on screen) the centered scroll position. syncScroll=true applies
// the scroll position in the same frame — used per animation frame while
// node heights are animating, so the settle never jumps; scrollBlend
// {from, p} eases from a captured position toward the target instead of
// snapping. The default defers the centering a tick and scrolls there
// smoothly (Auto Scroll-style) with a full line redraw.
export function layoutSectionBody(
    body: HTMLElement,
    syncScroll?: boolean,
    scrollBlend?: { from: number; p: number },
): void {
    // Ensure top and bottom spacer divs exist
    let topSpacer = body.querySelector<HTMLElement>('.scroll-top-spacer');
    if (!topSpacer) {
        topSpacer = document.createElement('div');
        topSpacer.className = 'scroll-top-spacer';
        topSpacer.style.flex = 'none';
        body.insertBefore(topSpacer, body.firstChild);
    }
    let bottomSpacer = body.querySelector<HTMLElement>('.scroll-bottom-spacer');
    if (!bottomSpacer) {
        bottomSpacer = document.createElement('div');
        bottomSpacer.className = 'scroll-bottom-spacer';
        bottomSpacer.style.flex = 'none';
        body.appendChild(bottomSpacer);
    }

    // Measure the base content height from the actual span between the
    // two spacers (excluding their own heights): this includes the real
    // flex gaps — also the ones around the spacers — and any negative
    // margins from in-flight gap animations, which a per-node formula
    // would miscount.
    const nodes = Array.from(body.querySelectorAll<HTMLElement>('.node')).filter(n => n.offsetParent !== null);
    let C = 0;
    if (nodes.length > 0) {
        const span = bottomSpacer.offsetTop - (topSpacer.offsetTop + topSpacer.offsetHeight);
        C = span + 8 + 24; // + default padding-top / padding-bottom
    }

    const H = body.clientHeight;
    const diff = H - C;

    // Writes are guarded so this per-frame layout loop doesn't rewrite
    // identical padding/spacer values
    const setStyle = (el: HTMLElement, prop: 'paddingTop' | 'paddingBottom' | 'height', value: string) => {
        if (el.style[prop] !== value) el.style[prop] = value;
    };

    if (diff > 0) {
        // Content fits on screen: rest position is centered, but two
        // diff-sized spacers leave ±diff/2 of drag latitude so the user
        // can freely scroll the content anywhere between the viewport's
        // top and bottom edges (REQUIREMENTS §5.2). scrollTop = diff/2
        // centers; 0 parks the content at the bottom edge, diff at the
        // top. The scroll fades stay off (noOverflow) — everything is
        // visible, the latitude must not read as overflow.
        body.dataset.noOverflow = 'true';
        setStyle(body, 'paddingTop', '8px');
        setStyle(body, 'paddingBottom', '24px');
        setStyle(topSpacer, 'height', diff + 'px');
        setStyle(bottomSpacer, 'height', diff + 'px');
        if (syncScroll) {
            const target = diff / 2; // centered rest position
            if (scrollBlend && scrollBlend.p < 1) {
                const eased = scrollBlend.p * scrollBlend.p * (3 - 2 * scrollBlend.p); // smoothstep
                body.scrollTop = scrollBlend.from + (target - scrollBlend.from) * eased;
            } else {
                body.scrollTop = target;
            }
            updateFade(body);
        } else {
            setTimeout(() => {
                body.scrollTo({ top: diff / 2, behavior: 'smooth' });
                updateFade(body);
                debouncedDrawLines();
            }, 0);
        }
    } else {
        // Content is taller than container. Normal scrolling spacing.
        body.dataset.noOverflow = 'false';
        setStyle(body, 'paddingTop', '8px');
        setStyle(body, 'paddingBottom', '24px');
        setStyle(topSpacer, 'height', '0px');
        setStyle(bottomSpacer, 'height', '0px');
        updateFade(body);
    }
}

// CH / FX columns are fixed-width (nodes stretch to 100%, REQUIREMENTS.md
// §2.1.1), but the underlying node natural width changes with the font
// level and the model — measure it at runtime instead of hardcoding.
// The CSS reads var(--col-inputs-w) / var(--col-fx-w); measuring flips
// the var to max-content and back in the same task (no paint between).
// Skipped while a column is all-collapsed (its width is flex-driven then;
// the value re-syncs on the next font/model change after expanding).
export function sizeFixedColumns(): void {
    const root = document.documentElement;
    ([['col-inputs', '--col-inputs-w'], ['col-fx', '--col-fx-w']] as const).forEach(([id, prop]) => {
        const col = document.getElementById(id);
        if (!col || col.classList.contains('all-collapsed')) return;
        root.style.setProperty(prop, 'max-content');
        const w = Math.ceil(col.getBoundingClientRect().width);
        root.style.setProperty(prop, w + 'px');
    });

    // MIX / STEREO share the leftover width but must never get narrower
    // than their nodes' clip floor, which also changes with the font level
    // and device-driven text. Intrinsic sizing (min-/max-content) reads
    // too wide here — the rotated vertical faders inflate it — so measure
    // directly: pin the column to zero width (no paint in between), let
    // the nodes bottom out at their real minimum, and derive the floor
    // from the widest node plus the symmetric column insets. Inline styles
    // are saved/restored so a width-animation pin survives.
    //
    // The zero pin shrinks the total content width for a moment, which
    // makes the browser clamp the board's horizontal scroll immediately —
    // and restoring the widths does NOT restore the scroll. Save/restore
    // it around the measurement (same task, never painted).
    const board = container();
    const prevScrollLeft = board.scrollLeft;
    ([['col-mix', '--col-mix-w'], ['col-stereo', '--col-stereo-w']] as const).forEach(([id, prop]) => {
        const col = document.getElementById(id);
        if (!col || col.classList.contains('all-collapsed')) return;
        const prevWidth = col.style.width;
        const prevFlex = col.style.flex;
        const prevMinWidth = col.style.minWidth;
        col.style.minWidth = '0';
        col.style.width = '0';
        col.style.flex = 'none';
        const colRect = col.getBoundingClientRect();
        let floor = 0;
        col.querySelectorAll('.node').forEach(node => {
            const r = node.getBoundingClientRect();
            floor = Math.max(floor, (r.right - colRect.left) + (r.left - colRect.left));
        });
        col.style.width = prevWidth;
        col.style.flex = prevFlex;
        col.style.minWidth = prevMinWidth;
        if (floor > 0) root.style.setProperty(prop, Math.ceil(floor) + 'px');
    });
    board.scrollLeft = prevScrollLeft;
}

// Section headings can change height dynamically (font level, one-line
// vs two-line titles, window width) — pin them all to the tallest one so
// the title rows and the body tops of every column stay aligned. Inline
// min-heights are reset first so shrinking (e.g. font level down) is
// picked up too; reads and writes are batched (one reflow).
function equalizeSectionHeadings(): void {
    const h2s = Array.from(document.querySelectorAll<HTMLElement>('.section > h2'));
    if (h2s.length === 0) return;
    h2s.forEach(h => { h.style.minHeight = ''; });
    const max = Math.ceil(Math.max(...h2s.map(h => h.getBoundingClientRect().height)));
    h2s.forEach(h => { h.style.minHeight = max + 'px'; });
}

export function adjustSectionPadding(): void {
    equalizeSectionHeadings();
    document.querySelectorAll<HTMLElement>('.section-body').forEach(body => layoutSectionBody(body, false));
    drawLines();
}

export function updateFade(body: HTMLElement): void {
    if (body.dataset.noOverflow === 'true') {
        body.dataset.fadeTop = 'false';
        body.dataset.fadeBottom = 'false';
        return;
    }
    const atTop = body.scrollTop <= 2;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
    body.dataset.fadeTop = (!atTop).toString();
    body.dataset.fadeBottom = (!atBottom).toString();
}

// Resize relayouts and scroll-driven line redraws are coalesced to one per
// rendered frame — the events can fire faster than paint and a full
// drawLines pass covers 222 connections.
export function initLayoutListeners(): void {
    let resizeLayoutQueued = false;
    window.addEventListener('resize', () => {
        if (!resizeLayoutQueued) {
            resizeLayoutQueued = true;
            requestAnimationFrame(() => {
                resizeLayoutQueued = false;
                adjustSectionPadding();
            });
        }
    });

    // The fixed columns are measured before the device data arrives —
    // text that lands later (channel/FX names into the subtitles, dB
    // value labels) widens a node's natural width and would get clipped
    // at the fixed column edge. Watch for text/structure changes and
    // re-derive the widths, coalesced to one re-measure per frame.
    // Attribute mutations (meter style updates every 150ms) are
    // deliberately not observed; sizeFixedColumns writes only to the
    // documentElement style, so re-measuring never re-triggers this.
    let remeasureQueued = false;
    const queueRemeasure = () => {
        if (remeasureQueued) return;
        remeasureQueued = true;
        requestAnimationFrame(() => {
            remeasureQueued = false;
            sizeFixedColumns();
            debouncedDrawLines();
        });
    };
    ['col-inputs', 'col-fx', 'col-mix', 'col-stereo'].forEach(id => {
        const col = document.getElementById(id);
        if (col) {
            new MutationObserver(queueRemeasure)
                .observe(col, { childList: true, characterData: true, subtree: true });
        }
    });

    // Scroll event listener (using Event Capture so it survives DOM rebuilding).
    let scrollDrawQueued = false;
    window.addEventListener('scroll', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList && target.classList.contains('section-body')) {
            updateFade(target);
            if (!scrollDrawQueued) {
                scrollDrawQueued = true;
                requestAnimationFrame(() => {
                    scrollDrawQueued = false;
                    drawLines();
                });
            }
        }
    }, true);
}

// Initial state for existing section-bodies, re-checked shortly after
// startup (content changes after the first build).
export function finalizeInitialLayout(): void {
    adjustSectionPadding();
    setTimeout(() => {
        adjustSectionPadding();
    }, 200);
}

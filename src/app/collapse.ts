// Collapse view (REQUIREMENTS.md §2.1.4): each node in the bus sections
// can collapse to title + horizontal meter (class .node.collapse), default
// expanded. Three switch levels all drive the same per-node state, kept in
// collapseNodes so it survives model-switch DOM rebuilds:
//   - the ▲/▼ button in every node's top-right corner (animated)
//   - the COLLAPSE mini toggle in the section header (whole section)
//   - the header NODE group's Collapse All / Expand All buttons
// Mirrored by the .node-header padding-right rule in css/styles.css
// (room for the corner collapse button) — keep the two lists in sync.

import { ConfigStore } from '../config/config-store';
import { EVENT_MODEL_SWITCHED } from '../shared/constants';
import { setTooltip } from './i18n';
import { sizeFixedColumns } from './layout';
import {
    animateColumnWidths,
    cancelColumnWidthAnim,
    runHeightPhase,
    scheduleCollapseRedraw,
    type HeightChange,
} from './animations';

const COLLAPSE_SECTION_IDS = ['col-inputs', 'col-fx', 'col-mix', 'col-stereo', 'col-logical'];
export const collapseNodes = new Set<string>();

function injectCollapseButtons(): void {
    COLLAPSE_SECTION_IDS.forEach(sectionId => {
        document.querySelectorAll(`#${sectionId} .node`).forEach(node => {
            if (node.querySelector('.node-collapse-btn')) return;
            const btn = document.createElement('div');
            btn.className = 'node-collapse-btn';
            setTooltip(btn, 'Toggle collapsed/full view');
            node.appendChild(btn);
        });
    });
}

// Sections whose nodes are ALL collapsed release their fixed/derived
// column width (.all-collapsed, see css) and share the leftover.
function updateAllCollapsedClasses(): void {
    COLLAPSE_SECTION_IDS.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (!section) return;
        const nodes = section.querySelectorAll('.node');
        let all = nodes.length > 0;
        nodes.forEach(n => { if (!collapseNodes.has(n.id)) all = false; });
        section.classList.toggle('all-collapsed', all);
    });
}

// Final-state hook of both applyCollapseState paths: runs with the final
// node classes applied and the width-animation pins released (the
// non-animated path / animateColumnWidths' measuring pass).
//
// Expanding a node re-measures the fixed columns synchronously: value
// labels inside a collapsed node (or an all-collapsed column) contribute
// no width while hidden, yet their text keeps changing with the device —
// and those changes no longer trigger a measure on their own (layout.ts
// isValueLabelMutation). A deferred measure would read the pinned
// mid-animation widths instead of the natural ones.
function applyFinalCollapseClasses(changes: HeightChange[]): void {
    updateAllCollapsedClasses();
    if (changes.some(c => !c.on)) sizeFixedColumns();
}

// Sync everything from collapseNodes. Animated toggles run the width
// and height adjustments TOGETHER (REQUIREMENTS.md §2.1.4): the column
// widths are pinned and start transitioning toward their pre-measured
// targets in the same moment the node heights start animating, so the
// whole layout moves as one 0.6s motion.
export function applyCollapseState(animate: boolean): void {
    // Every mutation path (per-node button, section toggle, Collapse All /
    // Expand All) syncs through here — the one save point. The startup /
    // model-switch calls re-save unchanged data, which the debounce absorbs.
    ConfigStore.set('collapsedNodes', [...collapseNodes]);

    const changes: HeightChange[] = [];
    COLLAPSE_SECTION_IDS.forEach(sectionId => {
        document.querySelectorAll<HTMLElement>(`#${sectionId} .node`).forEach(node => {
            const on = collapseNodes.has(node.id);
            if (node.classList.contains('collapse') !== on) changes.push({ node, on });
        });
    });

    if (!animate || changes.length === 0) {
        cancelColumnWidthAnim();
        changes.forEach(c => {
            c.node.classList.remove('node-h-anim');
            c.node.style.height = '';
            c.node.classList.toggle('collapse', c.on);
        });
        applyFinalCollapseClasses(changes);
        scheduleCollapseRedraw(0);
        return;
    }

    // Width targets are measured with the final node classes applied
    // invisibly (flip -> measure -> flip back, no paint in between),
    // then the pinned width transition and the height phase start in
    // the same task
    animateColumnWidths(
        () => {
            changes.forEach(c => c.node.classList.toggle('collapse', c.on));
            applyFinalCollapseClasses(changes);
        },
        () => {
            changes.forEach(c => c.node.classList.toggle('collapse', !c.on));
        }
    );
    runHeightPhase(changes);
}

function setSectionCollapse(sectionId: string, on: boolean): void {
    document.querySelectorAll(`#${sectionId} .node`).forEach(node => {
        if (on) collapseNodes.add(node.id); else collapseNodes.delete(node.id);
    });
}

export function initCollapse(): void {
    // Restore saved collapse state. Ids of nodes the current model doesn't
    // have are kept, matching the in-session behavior across model switches.
    const saved = ConfigStore.get('collapsedNodes');
    if (Array.isArray(saved)) saved.forEach(id => {
        if (typeof id === 'string') collapseNodes.add(id);
    });

    injectCollapseButtons();
    applyCollapseState(false);

    document.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.section-collapse-btn, .section-expand-btn');
        if (!btn) return;
        const section = btn.closest('.section')!;
        setSectionCollapse(section.id, btn.classList.contains('section-collapse-btn'));
        applyCollapseState(true);
    });

    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
        injectCollapseButtons();
        applyCollapseState(false);
    });

    document.getElementById('btn-collapse-all')!.addEventListener('click', (e) => {
        e.stopPropagation(); // don't clear the current node selection
        COLLAPSE_SECTION_IDS.forEach(id => setSectionCollapse(id, true));
        applyCollapseState(true);
    });
    document.getElementById('btn-expand-all')!.addEventListener('click', (e) => {
        e.stopPropagation();
        COLLAPSE_SECTION_IDS.forEach(id => setSectionCollapse(id, false));
        applyCollapseState(true);
    });
}

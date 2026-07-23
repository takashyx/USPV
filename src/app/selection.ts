// Node selection (event delegation): click-to-focus, ESC / background
// click to clear, and the per-node collapse button (which toggles collapse
// view instead of selecting).

import { cycleMeterTap } from '../data/meter-taps';
import { updateHighlights } from '../view/highlight';
import { viewState } from '../view/view-state';
import { applyCollapseState, collapseNodes } from './collapse';
import { adjustSectionPadding, autoScrollToActiveNodes } from './layout';

// Applies a selection change (set or cleared) to the view
function applySelectionChange(): void {
    updateHighlights();
    // Nodes: Path Only shows/hides nodes with the selection — recompute
    // the column layout before scrolling
    if (viewState.focusNodesPathOnly) adjustSectionPadding();
    autoScrollToActiveNodes();
}

function clearSelection(): void {
    // No selection to clear — don't touch highlights or scroll positions
    // (background / header-button clicks would otherwise scroll every
    // column back to its resting position)
    if (!viewState.activeNodeId) return;
    viewState.activeNodeId = null;
    applySelectionChange();
}

export function initSelection(): void {
    document.getElementById('main-container')!.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // The per-node collapse/expand button toggles collapse view instead
        // of selecting the node (see the collapse view module)
        const collapseBtn = target.closest('.node-collapse-btn');
        if (collapseBtn) {
            e.stopPropagation();
            const node = collapseBtn.closest('.node')!;
            if (collapseNodes.has(node.id)) collapseNodes.delete(node.id);
            else collapseNodes.add(node.id);
            applyCollapseState(true);
            return;
        }

        // The meter tap chip cycles the metered tap point instead of
        // selecting the node (src/data/meter-taps.ts)
        const tapChip = target.closest('.meter-tap-chip');
        if (tapChip) {
            e.stopPropagation();
            const node = tapChip.closest('.node');
            if (node) cycleMeterTap(node.id);
            return;
        }

        const node = target.closest('.node');
        if (node) {
            e.stopPropagation();
            viewState.activeNodeId = viewState.activeNodeId === node.id ? null : node.id;
            applySelectionChange();
        }
    });

    document.body.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // Clicks on the header controls (toggles, buttons, selects) and on
        // the section title bars (COLLAPSE/EXPAND, DAW toggles) must not
        // drop the focus view — only the FOCUS VIEW chip inside the header
        // still clears it (REQUIREMENTS.md §2.2.3)
        if (target.closest('header') && !target.closest('#focus-view-chip')) return;
        if (target.closest('.section > h2')) return;
        clearSelection();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            clearSelection();
        }
    });
}

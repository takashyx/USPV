// Click-to-isolate highlight traversal (REQUIREMENTS.md §2.2): BFS over the
// connection graph from the selected node, driving the CSS has-active-node
// class system, the focus-view indicators and the mode chip.

import { setTooltip } from '../app/i18n';
import { connections, currentPatches } from '../data/topology';
import { getConnectionState } from './connection-state';
import { domControlReader } from './control-reader';
import { container } from './dom-refs';
import { viewState } from './view-state';

// Directional BFS shared by the upstream and downstream searches: nearKey is
// the connection side that must equal the current node, farKey the side
// propagation continues to. Muted connections are collected but not
// propagated; inactive connections are skipped entirely.
function collectConnected(
    startId: string,
    nearKey: 'fromNode' | 'toNode',
    farKey: 'fromNode' | 'toNode',
    activeNodes: Set<string>,
    activeLines: Set<number>,
): void {
    const queue = [startId];
    const visited = new Set<string>();
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        activeNodes.add(current);
        connections.forEach((conn, index) => {
            if (conn[nearKey] !== current) return;
            const state = getConnectionState(conn, domControlReader, currentPatches);
            if (state === 'inactive') return;
            activeLines.add(index);
            // Only propagate and highlight the far node if audio is flowing
            if (state === 'flow') {
                activeNodes.add(conn[farKey]);
                if (!visited.has(conn[farKey])) {
                    queue.push(conn[farKey]);
                }
            }
        });
    }
}

// updateHighlights: highlights the subgraph connected to the selected node
// via the CSS has-active-node class system. Does NOT call drawLines
// (drawLines calls this) to prevent infinite recursion.
let lastChipNodeId: string | null = null;

export function updateHighlights(): void {
    const activeNodeId = viewState.activeNodeId;

    // Idle early-out: no selection and nothing left over from a previous
    // one — skip the full reset loops (this runs on every scroll frame)
    if (!activeNodeId && !container().classList.contains('has-active-node') && lastChipNodeId === null) {
        return;
    }

    // Toggle has-active-node class — drives the CSS highlight system.
    // path-only additionally hides (display:none) the off-path nodes
    // (REQUIREMENTS.md §2.2.6 Nodes: Path Only)
    container().classList.toggle('has-active-node', !!activeNodeId);
    container().classList.toggle('path-only', !!activeNodeId && viewState.focusNodesPathOnly);

    // Flow view indicators: viewport frame + mode chip (REQUIREMENTS.md §2.2.5).
    // The chip text only needs rewriting when the selection changes, not on
    // every redraw (updateHighlights runs per scroll/param update).
    document.body.classList.toggle('focus-view', !!activeNodeId);
    const chip = document.getElementById('focus-view-chip');
    if (chip) setTooltip(chip, activeNodeId ? 'Click or press ESC to clear' : '');
    if (activeNodeId !== lastChipNodeId) {
        lastChipNodeId = activeNodeId;
        if (activeNodeId) {
            const chipNode = document.getElementById('focus-view-chip-node')!;
            const nodeEl = document.getElementById(activeNodeId);
            const titleEl = nodeEl && nodeEl.querySelector('.node-title');
            chipNode.textContent = titleEl ? titleEl.textContent!.replace(/\s+/g, ' ').trim() : activeNodeId;
        }
    }

    // Reset: remove active class from all nodes and routing lines
    document.querySelectorAll<HTMLElement>('.node').forEach(node => {
        node.classList.remove('active-node');
        node.classList.remove('clicked-node');
        node.style.borderColor = 'var(--border-color)';
        // The shorthand write above drops the device CH SETTING color's
        // !important top border (src/broker/apply.ts chColor) — re-apply it
        if (node.dataset.chColor) {
            node.style.setProperty('border-top-color', node.dataset.chColor, 'important');
        }
    });
    document.querySelectorAll('.routing-line').forEach(path => {
        path.classList.remove('active');
    });

    if (!activeNodeId) return;

    const activeNodes = new Set<string>();
    const activeLines = new Set<number>();

    collectConnected(activeNodeId, 'toNode', 'fromNode', activeNodes, activeLines);   // upstream
    collectConnected(activeNodeId, 'fromNode', 'toNode', activeNodes, activeLines);   // downstream

    // Apply active-node class to highlight matching nodes
    activeNodes.forEach(nodeId => {
        const el = document.getElementById(nodeId);
        if (el) {
            el.classList.add('active-node');
            if (nodeId === activeNodeId) {
                el.classList.add('clicked-node');
            }
        }
    });

    // Apply active class to matching routing lines
    activeLines.forEach(index => {
        const basePath = document.getElementById(`path-${index}-base`);
        const flowPath = document.getElementById(`path-${index}-flow`);
        const mutedPath = document.getElementById(`path-${index}-muted`);
        [basePath, flowPath, mutedPath].forEach(path => {
            if (path) path.classList.add('active');
        });
    });
}

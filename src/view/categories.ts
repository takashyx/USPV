// Node category mapping (REQUIREMENTS.md §4.1 ノードカテゴリ色) — the ONE
// table behind both the category CSS class on each node (header accent
// border) and the resolved category color (routing lines, source chips).
// Row order matters: it replicates the prefix-check order of the two
// ladders it replaced (view.js getNodeCategoryColor / broker.js
// applyCategoryClass).
//
// Colors live in css/styles.css :root only; JS resolves them lazily via
// getComputedStyle (memoized — the palette never changes at runtime).

interface NodeCategory {
    className: string;
    cssVar: string;
    match: (nodeId: string) => boolean;
}

const NODE_CATEGORIES: NodeCategory[] = [
    { className: 'node-input',   cssVar: '--accent-green',  match: id => id.startsWith('in-ch') || id === 'bus-osc' },
    { className: 'node-mix',     cssVar: '--accent-blue',   match: id => id.startsWith('bus-mix') },
    { className: 'node-fx',      cssVar: '--accent-yellow', match: id => id.startsWith('bus-fx') },
    { className: 'node-stereo',  cssVar: '--accent-red',    match: id => id === 'bus-stereo' },
    // Logical outputs (MONITOR 1/2, STREAMING) share the purple accent
    { className: 'node-monitor', cssVar: '--accent-purple', match: id => id.startsWith('bus-mon') || id === 'bus-stream' },
    { className: 'node-port',    cssVar: '--text-muted',    match: id => id.startsWith('in-port-') },
    { className: 'node-output',  cssVar: '--text-muted',    match: id => id.startsWith('out-') || id.startsWith('daw-') },
];

const colorCache = new Map<string, string>();

// Resolves a :root custom property to its concrete value (needed for SVG
// presentation attributes, which don't support var()). Memoized after the
// first successful read — no theme switching exists.
export function cssColor(varName: string): string {
    let v = colorCache.get(varName);
    if (!v) {
        v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (v) colorCache.set(varName, v);
    }
    return v;
}

export function getNodeCategory(nodeId: string): NodeCategory | null {
    return NODE_CATEGORIES.find(c => c.match(nodeId)) || null;
}

// Category color with the historical gray fallback for unmatched ids
// (physical ports / outputs and anything unknown).
function getNodeCategoryColor(nodeId: string): string {
    const cat = getNodeCategory(nodeId);
    return cssColor(cat ? cat.cssVar : '--text-muted');
}

// Per-node color overrides from the device CH SETTING color (param 20/208,
// REQUIREMENTS §4.1): while set, the node's outgoing routing lines and its
// source chips use this color instead of the category color. Survives model
// switches (the SVG rebuild re-resolves through effectiveNodeColor).
const colorOverrides = new Map<string, string>();

export function setNodeColorOverride(nodeId: string, hex: string | null): void {
    if (hex) colorOverrides.set(nodeId, hex);
    else colorOverrides.delete(nodeId);
}

// The color a node currently "is": its device CH color when one is set,
// the category accent otherwise.
export function effectiveNodeColor(nodeId: string): string {
    return colorOverrides.get(nodeId) || getNodeCategoryColor(nodeId);
}

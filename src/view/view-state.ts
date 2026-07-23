// Cross-module view flags — the single owner of state that app/broker/demo
// used to poke via bare window globals (compat still bridges them onto
// window with get/set accessors while classic scripts remain).

export const viewState = {
    // Selected node for the FOCUS VIEW highlight (null = no selection).
    activeNodeId: null as string | null,

    // Inactive (unpatched) lines are always hidden; muted lines are hidden
    // while the Hide Muted toggle is on (default ON, REQUIREMENTS.md §5.2).
    hideMuted: true,

    // Focus view suppression toggles (REQUIREMENTS.md §2.2.6, both default
    // ON): while a node is selected, state changes on connections/nodes
    // OUTSIDE the highlighted path skip the wipe/blink effects and/or the
    // Scroll to Change. No effect while nothing is selected.
    focusEffectsPathOnly: true,
    focusScrollPathOnly: true,
    // Hide (not just dim) the nodes outside the highlighted path
    focusNodesPathOnly: true,
};

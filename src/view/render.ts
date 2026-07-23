// Routing-line rendering for the URX signal-flow diagram. Owns the SVG
// layer: Bézier geometry, the state-transition wipe machine, blink
// animation classes, and the shared UI update primitives.
//
// The broker calls initializeSvgPaths()/drawLines() after (re)building the
// DOM.

import type { Connection, ConnectionState } from '../shared/types';
import { appState } from '../app/app-state';
import { scrollToNodes } from '../app/layout';
import { debouncedDrawLines } from '../broker/redraw';
import { connections, currentPatches } from '../data/topology';
import { cssColor, effectiveNodeColor } from './categories';
import { getConnectionState } from './connection-state';
import { clearControlCache, domControlReader } from './control-reader';
import { container, svgLayer } from './dom-refs';
import { updateHighlights } from './highlight';
import { viewState } from './view-state';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Last evaluated state per connection key (view-internal; drives the
// change detection that arms the transition wipes)
const prevConnStates = new Map<string, ConnectionState>();

interface ConnTransition {
    dir: 'in' | 'out';
    showFlow: boolean;
    showMuted: boolean;
    wipeBase: boolean;
    nodes: string[];
    effectsReady: Promise<unknown> | null;
    startDelay: number;
    until: number;
    hideBase?: boolean;
}

// Per-connection state-transition records (connKey -> ConnTransition).
// While a record is active the line stays visible and its wipe animation
// plays; the settle redraw after `until` applies the final visibility.
const connTransitions = new Map<string, ConnTransition>();

// Bulk updates (initial device sync, demo start/stop, model switch) change
// many connections at once — running dozens of wipes/blinks there is too
// heavy, so effects are suppressed for a short window and states snap
// directly to their final look (REQUIREMENTS.md §2.1.2).
let effectsSuppressedUntil = 0;

export function suppressChangeEffects(ms: number): void {
    effectsSuppressedUntil = Math.max(effectsSuppressedUntil, Date.now() + ms);
    // Cancel anything already animating; the next drawLines pass clears the
    // leftover inline overrides and applies final states.
    activeWipes.forEach(cancel => cancel());
    activeWipes.clear();
    connTransitions.clear();
}

const WIPE_DURATION_MS = 1000;
const TRANSITION_WINDOW_MS = WIPE_DURATION_MS + 200; // wipe + settle margin
// Glow shown on a line while its wipe is playing; currentColor picks up the
// connection color from the group (gray for the muted layer)
const WIPE_GLOW = 'drop-shadow(0 0 4px currentColor) drop-shadow(0 0 10px currentColor)';
const STATE_RANK: Record<ConnectionState, number> = { inactive: 0, muted: 1, flow: 2 };

// Lines are visible only while synced with Device Center or in demo mode
// (REQUIREMENTS.md §2.1.2 表示条件). The svg-layer starts hidden in
// index.html; the broker and demo mode toggle it.
export function setLinesVisible(visible: boolean): void {
    svgLayer().classList.toggle('lines-hidden', !visible);
}

// -------------------------------------------------------------
// SVG Layer Initialization
// -------------------------------------------------------------

// Connection color = the source node's effective color: its device CH
// SETTING color when one is set, its header category color otherwise
function resolveConnColor(conn: Connection): string {
    return effectiveNodeColor(conn.fromNode);
}

// Re-resolves and re-applies the line color of every connection leaving
// nodeId — called when the device CH SETTING color changes. Strokes are
// otherwise static (set once at group creation), and the group color feeds
// the wipe glow via currentColor. Source chips re-tint alongside.
export function refreshNodeLineColors(nodeId: string): void {
    connections.forEach((conn, idx) => {
        if (conn.fromNode !== nodeId) return;
        conn.color = resolveConnColor(conn);
        const entry = connGroups[idx];
        if (!entry) return;
        entry.g.style.color = conn.color;
        entry.basePath.setAttribute('stroke', conn.color);
        entry.flowPath.setAttribute('stroke', conn.color);
    });
    updatePatchChips();
}

// Patched-source chips: input channels and patchable physical outputs show
// their currently connected source (currentPatches) as a chip in the node
// header, colored with the source node's category color. Chip elements
// carry the -ind-src / -ind-patch ids from PARAM_MAPPINGS, so live portRef
// notifications resolve to them for the change blink.
export function updatePatchChips(): void {
    const setChip = (chip: HTMLElement, srcId: string | null | undefined) => {
        const srcTitle = srcId && document.querySelector(`#${srcId} .node-title`);
        chip.textContent = srcTitle ? srcTitle.textContent : '';
        chip.style.color = srcId ? effectiveNodeColor(srcId) : '';
    };

    for (const [destId, srcId] of Object.entries(currentPatches)) {
        const chip = document.getElementById(`${destId}-ind-src`)
            || document.getElementById(`${destId}-ind-patch`);
        if (chip) setChip(chip, srcId);
    }

    // Exception: PHONES 1/2 are hardwired to MONITOR 1/2, so instead of the
    // directly connected node their chips mirror the monitor's source chip.
    ([['out-ph1', 'bus-mon1'], ['out-ph2', 'bus-mon2']] as const).forEach(([phId, monId]) => {
        const chip = document.getElementById(`${phId}-ind-src`);
        if (chip) setChip(chip, currentPatches[monId]);
    });
}

interface ConnGroupEntry {
    g: SVGGElement;
    basePath: SVGPathElement;
    flowPath: SVGPathElement;
    mutedPath: SVGPathElement;
}

// Creates the <g> skeleton with the three stacked paths (base / flow / muted)
// shared by initializeSvgPaths() and drawLines()'s lazy creation.
function createConnGroup(idx: number): ConnGroupEntry {
    const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.id = `conn-group-${idx}`;

    const makePath = (kind: string): SVGPathElement => {
        const path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
        path.id = `path-${idx}-${kind}`;
        path.setAttribute('class', `routing-line ${kind}-line`);
        g.appendChild(path);
        return path;
    };

    return {
        g,
        basePath: makePath('base'),
        flowPath: makePath('flow'),
        mutedPath: makePath('muted'),
    };
}

// Element cache per connection index ({g, basePath, flowPath, mutedPath}),
// populated by initializeSvgPaths() and ensureConnGroup()'s lazy creation —
// saves the per-frame querySelector lookups in the draw passes.
const connGroups: ConnGroupEntry[] = [];

// Rebuilds the whole SVG layer: one styled group per connection.
// Called by the broker on init and on every model switch.
export function initializeSvgPaths(): void {
    svgLayer().innerHTML = '';
    connGroups.length = 0;
    clearControlCache(); // the controls DOM was rebuilt alongside

    connections.forEach((conn, index) => {
        conn.color = resolveConnColor(conn);

        const entry = createConnGroup(index);
        const { g, basePath, flowPath, mutedPath } = entry;
        g.style.opacity = '0'; // Hidden by default, but kept in DOM rendering tree so animation initialized immediately
        g.style.color = conn.color; // Set group color to match connection for currentColor drop-shadow

        basePath.setAttribute('stroke', conn.color);
        flowPath.setAttribute('stroke', conn.color);
        mutedPath.setAttribute('stroke', cssColor('--line-muted-stroke'));
        mutedPath.style.color = cssColor('--text-muted'); // Faded glow color

        svgLayer().appendChild(g);
        connGroups[index] = entry;
    });

    updatePatchChips(); // the chips DOM was rebuilt alongside
}

// -------------------------------------------------------------
// Line Drawing
// -------------------------------------------------------------

interface EvaluatedConn {
    conn: Connection;
    idx: number;
    state: ConnectionState;
    inTransition: boolean;
    newlyChanged: boolean;
    transition: ConnTransition | undefined;
    connKey: string;
}

// Evaluates every connection's current state, arms the transition window on
// state changes (wipe animation + blinking both end nodes), and updates the
// state history.
let settleRedrawPending = false;

function evaluateConnections(): EvaluatedConn[] {
    const blinkNodes = new Set<string>();
    const newTransitions: ConnTransition[] = [];
    const now = Date.now(); // one timestamp per pass

    const evaluated: EvaluatedConn[] = connections.map((conn, idx) => {
        const state = getConnectionState(conn, domControlReader, currentPatches);
        const connKey = `${conn.fromNode}->${conn.toNode}`;
        const prevState = prevConnStates.get(connKey);

        let newlyChanged = false;
        if (prevState !== undefined && prevState !== state && now >= effectsSuppressedUntil) {
            // Focus view: changes on connections outside the highlighted
            // path can skip the effects and/or the Scroll to Change
            // (REQUIREMENTS.md §2.2.6). Path membership comes from the
            // .active classes applied by the previous highlight pass.
            // Cutting a path line (it carries .active) and connecting
            // something new INTO the path (a non-inactive state appearing
            // on a highlighted node) always count as in-path.
            let offPath = false;
            if (viewState.activeNodeId) {
                const flowEl = document.getElementById(`path-${idx}-flow`);
                const lineActive = flowEl && flowEl.classList.contains('active');
                if (!lineActive) {
                    const touchesPath = (id: string) => {
                        const el = document.getElementById(id);
                        return el && el.classList.contains('active-node');
                    };
                    const joinsPath = state !== 'inactive' &&
                        (touchesPath(conn.fromNode) || touchesPath(conn.toNode));
                    offPath = !joinsPath;
                }
            }

            if (!(offPath && viewState.focusScrollPathOnly)) {
                blinkNodes.add(conn.fromNode);
                blinkNodes.add(conn.toNode);
            }

            if (offPath && viewState.focusEffectsPathOnly) {
                // no wipe/blink — the state snaps in this redraw
                prevConnStates.set(connKey, state);
                const stale = connTransitions.get(connKey);
                return { conn, idx, state, inTransition: !!stale && now < stale.until, newlyChanged: false, transition: stale, connKey };
            }

            newlyChanged = true;

            // Wipe direction & which layers stay visible during the window
            // (REQUIREMENTS.md §2.1.2 状態遷移ワイプ)
            const dir: 'in' | 'out' = STATE_RANK[state] > STATE_RANK[prevState] ? 'in' : 'out';
            const transition: ConnTransition = {
                dir,
                showFlow: state === 'flow' || prevState === 'flow',
                // The dotted muted layer stays hidden while a flow line wipes
                // out toward it (it appears once the wipe settles); when
                // unmuting it stays visible under the growing flow line
                showMuted: prevState === 'muted' || (state === 'muted' && dir === 'in'),
                // Appearing wipes also grow the solid base line, but only
                // when coming from inactive (disappearing wipes hide the
                // base directly in startWipe and never consult this flag)
                wipeBase: prevState === 'inactive',
                // Both endpoints blink exactly when this wipe starts
                nodes: [conn.fromNode, conn.toNode],
                effectsReady: null, // set below when a Scroll to Change runs
                startDelay: 0,      // set below when paired with a disconnect
                until: now + TRANSITION_WINDOW_MS,
            };
            connTransitions.set(connKey, transition);
            newTransitions.push(transition);
        }
        prevConnStates.set(connKey, state);

        const transition = connTransitions.get(connKey);
        const inTransition = !!transition && now < transition.until;

        return { conn, idx, state, inTransition, newlyChanged, transition, connKey };
    });

    // Scroll to Change: follow connection-state changes to the affected nodes
    // (REQUIREMENTS.md §5.2). When a scroll actually runs, the change effects
    // (node blink, line wipe) wait for it to finish. Device parameter updates
    // without a state change are handled separately in the broker.
    if (appState.scrollToChangeEnabled && blinkNodes.size > 0) {
        const scroll = scrollToNodes(blinkNodes);
        if (scroll.scrolled > 0) {
            newTransitions.forEach(t => { t.effectsReady = scroll.done; });
        }
    }

    // When a repatch swaps connections (disconnect + connect in the same
    // pass), the disconnect wipes play first and the connect wipes follow
    // once they finish (REQUIREMENTS.md §2.1.2)
    const outPhasesMs = newTransitions.reduce(
        (max, t) => t.dir === 'out' ? Math.max(max, TRANSITION_WINDOW_MS - 200) : max, 0);
    if (outPhasesMs > 0) {
        newTransitions.forEach(t => {
            if (t.dir === 'in') {
                t.startDelay = outPhasesMs;
                t.until = now + outPhasesMs + TRANSITION_WINDOW_MS;
            }
        });
    }

    // Node blinks are NOT dispatched here: each transition blinks its two
    // endpoints at the moment its wipe animation starts (see drawLines), so
    // blink and line animation always begin together — after the Scroll to
    // Change and, on repatches, after the disconnect phase for connect wipes.

    // One settle redraw just after the transition window expires (re-scheduled
    // by that redraw itself if some lines are still mid-transition then)
    if (!settleRedrawPending && evaluated.some(item => item.inTransition)) {
        settleRedrawPending = true;
        setTimeout(() => {
            settleRedrawPending = false;
            drawLines();
        }, TRANSITION_WINDOW_MS + 5);
    }

    return evaluated;
}

// -------------------------------------------------------------
// State-Transition Wipe Animation
// -------------------------------------------------------------
// Appearing lines grow from the SOURCE endpoint toward the DESTINATION;
// disappearing lines retract from the destination back into the source (the
// exact reverse). Path `d` always starts at the source endpoint, so the
// visible span is simply [0..t] — an inline-!important stroke-dasharray of
// the form "t len" driven by rAF. Inline !important is required because the
// stylesheet dash patterns and dash animations are themselves !important.

const activeWipes = new Map<SVGPathElement, () => void>(); // path element -> cancel()

function cancelWipe(path: SVGPathElement): void {
    const cancel = activeWipes.get(path);
    if (cancel) {
        cancel();
        activeWipes.delete(path);
    }
}

// delayMs staggers the start; until then the path keeps its current look
// (used to retract the base line before the flowing line). onBegin fires
// when the wipe actually starts moving (after the delay) — and never if
// the wipe is cancelled first.
function wipePath(path: SVGPathElement, dir: 'in' | 'out', delayMs = 0, onBegin: (() => void) | null = null): void {
    cancelWipe(path);

    const len = path.getTotalLength();
    if (!len) return;

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | 0 = 0;
    activeWipes.set(path, () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
    });

    const applyT = (t: number) => {
        path.style.setProperty('stroke-dasharray', `${t} ${len}`, 'important');
    };

    const begin = () => {
        if (onBegin) onBegin();
        const start = performance.now();
        path.style.setProperty('stroke-dashoffset', '0', 'important'); // pin against flow-dash
        path.style.setProperty('filter', WIPE_GLOW, 'important'); // glow while animating

        // Triple the stroke width while animating (clear our own override
        // first so a restarted wipe doesn't stack onto the tripled width)
        path.style.removeProperty('stroke-width');
        const baseWidth = parseFloat(getComputedStyle(path).strokeWidth) || 1.5;
        path.style.setProperty('stroke-width', `${baseWidth * 3}px`, 'important');

        applyT(dir === 'in' ? 0 : len); // start frame, applied synchronously

        const frame = (now: number) => {
            const p = Math.min(1, (now - start) / WIPE_DURATION_MS);
            const eased = 1 - Math.pow(1 - p, 2); // ease-out
            applyT((dir === 'in' ? eased : 1 - eased) * len);
            if (p < 1) {
                raf = requestAnimationFrame(frame);
            } else {
                activeWipes.delete(path);
                path.style.removeProperty('filter');       // glow only while animating
                path.style.removeProperty('stroke-width'); // back to normal width
                if (dir === 'in') {
                    // fully drawn — hand back to the normal dash pattern/animation
                    clearWipeStyles(path);
                }
                // dir === 'out': keep the collapsed dash until the settle
                // redraw applies the final hidden state and clears it
            }
        };
        raf = requestAnimationFrame(frame);
    };

    if (delayMs > 0) {
        timer = setTimeout(begin, delayMs);
    } else {
        begin();
    }
}

function clearWipeStyles(path: SVGPathElement): void {
    if (activeWipes.has(path)) return; // mid-wipe — leave the inline dash alone
    path.style.removeProperty('stroke-dasharray');
    path.style.removeProperty('stroke-dashoffset');
    path.style.removeProperty('filter');
    path.style.removeProperty('stroke-width');
}

function startWipe(transition: ConnTransition, basePath: SVGPathElement, flowPath: SVGPathElement, mutedPath: SVGPathElement): void {
    const primary = transition.showFlow ? flowPath : mutedPath;

    if (transition.dir === 'out') {
        // Disappearing: the line itself (base layer and the normal dash
        // look) vanishes the instant the glow starts — only the glowing
        // stroke retracts back into the source (REQUIREMENTS.md §2.1.2).
        // The primary path becomes that glow stroke: the wipe's inline
        // dasharray replaces its normal pattern in the same frame. The
        // base is hidden here directly (the hideBase flag only takes
        // effect on the next redraw pass).
        transition.hideBase = true;
        setPathVisible(basePath, false);
        wipePath(primary, 'out');
        return;
    }

    wipePath(primary, transition.dir);
    if (transition.wipeBase) wipePath(basePath, transition.dir);
}

// While the effects wait for a Scroll to Change to finish, an appearing line
// must stay invisible (its wipe will grow it from the source endpoint); a
// disappearing line simply keeps its previous look until the wipe starts.
function prepareDeferredWipe(transition: ConnTransition, basePath: SVGPathElement, flowPath: SVGPathElement, mutedPath: SVGPathElement): void {
    if (transition.dir !== 'in') return;
    const paths = [transition.showFlow ? flowPath : mutedPath];
    if (transition.wipeBase) paths.push(basePath);
    paths.forEach(path => {
        const len = path.getTotalLength();
        if (!len) return;
        path.style.setProperty('stroke-dashoffset', '0', 'important');
        path.style.setProperty('stroke-dasharray', `0 ${len}`, 'important');
    });
}

// Pass-local endpoint rect lookup: shared endpoints (e.g. a bus input dot
// feeding many connections) are measured once per draw pass instead of once
// per connection.
function makeRectLookup(): (id: string, el: Element) => DOMRect {
    const rects = new Map<string, DOMRect>(); // endpointId -> rect
    return (id, el) => {
        let r = rects.get(id);
        if (!r) {
            r = el.getBoundingClientRect();
            rects.set(id, r);
        }
        return r;
    };
}

// The svg-layer is anchored at the container's CONTENT origin (absolute
// left:0/top:0), which moves with the container's own scroll — while
// getBoundingClientRect gives the viewport-fixed border box. Path
// coordinates must be in content space, or every line shifts by the
// scroll amount when the board scrolls horizontally (narrow windows).
function contentOrigin(): { left: number; top: number } {
    const el = container();
    const rect = el.getBoundingClientRect();
    return { left: rect.left - el.scrollLeft, top: rect.top - el.scrollTop };
}

// Cubic Bézier between the centers of the two endpoint dots, with control
// points at the horizontal midpoint. Coordinates are content-space
// (scroll-invariant): no redraw is needed while the board scrolls.
function computeBezierD(rectFrom: DOMRect, rectTo: DOMRect, origin: { left: number; top: number }): string {
    const startX = rectFrom.left + rectFrom.width / 2 - origin.left;
    const startY = rectFrom.top + rectFrom.height / 2 - origin.top;
    const endX = rectTo.left + rectTo.width / 2 - origin.left;
    const endY = rectTo.top + rectTo.height / 2 - origin.top;

    const cpX = startX + (endX - startX) * 0.5;

    return `M ${startX} ${startY} C ${cpX} ${startY}, ${cpX} ${endY}, ${endX} ${endY}`;
}

// Finds the cached group for a connection index, or lazily creates a bare
// skeleton (styling extras are applied by initializeSvgPaths on broker init).
function ensureConnGroup(idx: number): ConnGroupEntry {
    let entry = connGroups[idx];
    if (!entry) {
        entry = createConnGroup(idx);
        // stroke colors are applied once at creation, not per frame
        const color = connections[idx]!.color!;
        entry.basePath.setAttribute('stroke', color);
        entry.flowPath.setAttribute('stroke', color);
        svgLayer().appendChild(entry.g);
        connGroups[idx] = entry;
    }
    return entry;
}

// Geometry-only write: strokes are static (set at creation), and identical
// `d` strings are skipped — the last applied d is keyed on the group
// element and dies with the SVG-layer rebuilds, so it needs no invalidation.
const lastAppliedD = new WeakMap<SVGGElement, string>();

function applyPathGeometry({ g, basePath, flowPath, mutedPath }: ConnGroupEntry, d: string): void {
    if (lastAppliedD.get(g) === d) return;
    lastAppliedD.set(g, d);
    basePath.setAttribute('d', d);
    flowPath.setAttribute('d', d);
    mutedPath.setAttribute('d', d);
}

function setPathVisible(path: SVGPathElement, visible: boolean): void {
    if (visible) {
        path.style.removeProperty('opacity');
    } else {
        path.style.setProperty('opacity', '0', 'important');
    }
}

// Swaps layer visibility for the state and hides the whole group for hidden
// states (inactive always, muted while Hide Muted is on). During a
// transition window the involved layers stay visible (the wipe animation is
// what makes them appear/disappear) and hiding is deferred to the settle
// redraw after the window. On disappearing wipes the base layer is hidden
// the moment the glow starts (transition.hideBase, set by startWipe).
function applyStateStyles(
    g: SVGGElement,
    basePath: SVGPathElement,
    flowPath: SVGPathElement,
    mutedPath: SVGPathElement,
    state: ConnectionState,
    inTransition: boolean,
    transition: ConnTransition | undefined,
): void {
    if (inTransition && transition) {
        setPathVisible(basePath, !transition.hideBase);
        setPathVisible(flowPath, transition.showFlow);
        setPathVisible(mutedPath, transition.showMuted);
    } else {
        setPathVisible(basePath, true);
        setPathVisible(flowPath, state === 'flow');
        setPathVisible(mutedPath, state === 'muted');
    }

    const isHiddenState = (state === 'inactive') || (state === 'muted' && viewState.hideMuted);
    // line-hidden also stops the infinite flow-dash animation while the
    // group is invisible (see the rule at the end of css/styles.css)
    if (isHiddenState && !inTransition) {
        g.style.setProperty('opacity', '0', 'important');
        g.style.setProperty('pointer-events', 'none', 'important');
        g.classList.add('line-hidden');
    } else {
        g.style.removeProperty('opacity');
        g.style.removeProperty('pointer-events');
        g.classList.remove('line-hidden');
    }
}

// Removes connection groups whose endpoints no longer exist (e.g. after a model switch)
function removeOrphanGroups(activeGroupIds: Set<string>): void {
    Array.from(svgLayer().children).forEach(child => {
        if (child.id && child.id.startsWith('conn-group-') && !activeGroupIds.has(child.id)) {
            delete connGroups[parseInt(child.id.slice('conn-group-'.length), 10)];
            child.remove();
        }
    });
}

// Re-appends transitioning groups last so they render on top of other lines
function raiseTransitioningGroups(): void {
    if (connTransitions.size === 0) return;
    svgLayer().querySelectorAll('g.line-transition').forEach(g => svgLayer().appendChild(g));
}

// Fast geometry-only pass used while node heights are animating (collapse
// view toggles): recomputes every existing group's path shape without
// re-evaluating connection states, wipes or highlights — a full drawLines
// per frame is what makes those animations stutter.
export function redrawLineGeometry(): void {
    const origin = contentOrigin();
    const rectOf = makeRectLookup();
    connections.forEach((conn, idx) => {
        const entry = connGroups[idx];
        if (!entry) return;
        const elFrom = document.getElementById(conn.from);
        const elTo = document.getElementById(conn.to);
        if (!elFrom || !elTo) return;
        if (elFrom.offsetParent === null || elTo.offsetParent === null) return;
        const d = computeBezierD(rectOf(conn.from, elFrom), rectOf(conn.to, elTo), origin);
        applyPathGeometry(entry, d);
    });
}

export function drawLines(): void {
    const origin = contentOrigin();
    const rectOf = makeRectLookup();
    const evaluatedConns = evaluateConnections();

    // Keep track of active group IDs so we can clean up orphaned elements
    const activeGroupIds = new Set<string>();

    evaluatedConns.forEach(({ conn, idx, state, inTransition, newlyChanged, transition, connKey }) => {
        const elFrom = document.getElementById(conn.from);
        const elTo = document.getElementById(conn.to);
        if (!elFrom || !elTo) return;

        activeGroupIds.add(`conn-group-${idx}`);

        // An endpoint inside a display:none node (Hide DAW) has no layout
        // box — keep the group but hide it instead of drawing to a
        // collapsed rect
        if (elFrom.offsetParent === null || elTo.offsetParent === null) {
            const { g } = ensureConnGroup(idx);
            g.style.setProperty('opacity', '0', 'important');
            g.style.setProperty('pointer-events', 'none', 'important');
            g.classList.remove('line-transition');
            return;
        }

        const d = computeBezierD(rectOf(conn.from, elFrom), rectOf(conn.to, elTo), origin);
        const entry = ensureConnGroup(idx);
        const { g, basePath, flowPath, mutedPath } = entry;

        applyPathGeometry(entry, d);
        applyStateStyles(g, basePath, flowPath, mutedPath, state, inTransition, transition);

        if (newlyChanged && transition) {
            const begin = () => {
                // skip if a newer transition superseded this one meanwhile
                if (connTransitions.get(connKey) !== transition) return;
                transition.until = Date.now() + TRANSITION_WINDOW_MS;
                // Blink both endpoints in the same moment the line
                // animation starts (REQUIREMENTS.md §2.1.2)
                transition.nodes.forEach(triggerNodeBlink);
                startWipe(transition, basePath, flowPath, mutedPath);
                // The pass-level settle timer was armed when the change was
                // detected; a wipe deferred by a scroll or a paired
                // disconnect outlives it, so schedule this transition's own
                // settle redraw right after its window expires
                setTimeout(drawLines, TRANSITION_WINDOW_MS + 50);
            };

            if (transition.effectsReady || transition.startDelay > 0) {
                // Effects wait for the Scroll to Change and/or for the
                // paired disconnect wipe to finish
                prepareDeferredWipe(transition, basePath, flowPath, mutedPath);
                const afterScroll = () => {
                    if (transition.startDelay > 0) {
                        setTimeout(begin, transition.startDelay);
                    } else {
                        begin();
                    }
                };
                if (transition.effectsReady) {
                    transition.effectsReady.then(afterScroll);
                } else {
                    afterScroll();
                }
            } else {
                begin();
            }
        }
        if (!inTransition) {
            // drop expired records and any leftover wipe dash overrides
            if (transition) connTransitions.delete(connKey);
            [basePath, flowPath, mutedPath].forEach(clearWipeStyles);
        }
        g.classList.toggle('line-transition', inTransition);
    });

    removeOrphanGroups(activeGroupIds);
    raiseTransitioningGroups();

    updateHighlights();
}

// -------------------------------------------------------------
// Shared UI Update Primitives (used by the broker and demo mode)
// -------------------------------------------------------------

// Knob rotation for the -60 dB .. +10 dB level scale (-135° .. +135°)
export function dbToKnobAngle(db: number): number {
    const pct = Math.max(0, Math.min(1, (db * 100 + 6000) / 7000));
    return -135 + pct * 270;
}

// Value-label text + color: red for the -inf (muted) floor, green
// otherwise. Shared by the knob-val and fader-val displays (broker
// updates, slider wiring and demo mode all render values through this).
export function setValueLabel(valEl: HTMLElement, text: string): void {
    valEl.textContent = text;
    valEl.style.color = text.includes('-inf') ? 'var(--accent-red)' : 'var(--accent-green)';
}

// Rotates a knob and (when given) updates its sibling .knob-val label —
// the way every device notification and demo action drives a knob.
export function updateKnobElement(knobEl: HTMLElement, angle: number, text?: string): void {
    knobEl.style.transform = `rotate(${angle}deg)`;
    if (text === undefined) return;
    const valEl = knobEl.parentElement!.querySelector<HTMLElement>('.knob-val');
    if (valEl) setValueLabel(valEl, text);
}

// Applies an ON/OFF state to a toggle-style element the same way a device
// notification does: active class, ch-muted node dimming, and a redraw.
export function updateToggleElement(el: HTMLElement, isActive: boolean): void {
    if (el.classList.contains('dsp-block') || el.classList.contains('send-on') || el.classList.contains('send-pre')) {
        if (isActive) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }

        // If this is a CH_ON button (btn-on on an input channel) or an FX
        // return ON button, dim/undim the whole node
        if (el.id && el.id.match(/^(in-ch.*|bus-fx[12])-btn-on$/)) {
            const node = el.closest('.node');
            if (node) {
                node.classList.toggle('ch-muted', !isActive);
            }
        }

        // Trigger redraw on any state change to instantly update SVG lines flow/dashed rendering
        debouncedDrawLines();
    }
    else if (el.classList.contains('indicator')) {
        const activeClass = Array.from(el.classList).find(c => c.startsWith('active-')) || 'active-blue';
        if (isActive) {
            el.classList.add(activeClass);
        } else {
            el.classList.remove(activeClass);
        }
    }
}

export function triggerNodeBlink(nodeId: string): void {
    const nodeEl = document.getElementById(nodeId);
    if (nodeEl) {
        nodeEl.classList.remove('node-blink');
        void nodeEl.offsetWidth; // force reflow
        nodeEl.classList.add('node-blink');
        setTimeout(() => {
            nodeEl.classList.remove('node-blink');
        }, 1050); // just past the 1s nodeBlink animation
    }
}

// Target picking shared by the dev-panel modes. Every ①-column target
// card (CAPTURE / GHOST / MISLINK / TRYMAP) renders through renderPickCard:
// info rows left, stacked actions right, the Pick button inside the card.

import { METER_MAPPINGS, PARAM_MAPPINGS } from '../data/device-map';
import { t } from '../app/i18n';

// Controls that could be device-driven. Anything matching this inside
// the diagram whose id has no mapping gets the red outline.
export const CANDIDATE_SELECTOR = [
    '.knob', 'input[type="range"]', '.send-on', '.send-pre',
    '.dsp-block', '.meter', '.node-subtitle', '.src-chip', '.indicator',
].join(', ');

// Mapped indirectly — no own table entry by design (PHONES chips mirror
// the MONITOR source chips, paramId 719)
export const DERIVED_IDS = new Set(['out-ph1-ind-src', 'out-ph2-ind-src']);

// A picked board control, described for the target cards and reports
export interface TargetInfo {
    el: HTMLElement | null;
    elId: string;
    nodeId: string;
    desc: string;
    existing: string | null;
}

export function existingMappingLabel(elId: string): string | null {
    if (PARAM_MAPPINGS[elId]) return `PARAM_MAPPINGS ${JSON.stringify(PARAM_MAPPINGS[elId])}`;
    if (METER_MAPPINGS[elId]) return `METER_MAPPINGS ${JSON.stringify(METER_MAPPINGS[elId])}`;
    if (DERIVED_IDS.has(elId)) return '(derived display: mirrors the MONITOR source chip)';
    return null;
}

// Element identity for cards and reports: tag, classes (dev-* stripped),
// visible label, node, existing mapping
export function describeEl(el: HTMLElement): TargetInfo {
    const node = el.closest('.node');
    const label = (el.textContent || '').trim().slice(0, 24);
    const type = (el as HTMLInputElement).type;
    return {
        el,
        elId: el.id || '',
        nodeId: node ? node.id : '-',
        desc: `<${el.tagName.toLowerCase()}${type ? ` type="${type}"` : ''} class="${el.className.replace(/ dev-\S+/g, '')}">`
            + (label ? ` "${label}"` : ''),
        existing: existingMappingLabel(el.id),
    };
}

export interface PickCardOptions {
    pickId: string;
    pickTitle: string;
    info: Pick<TargetInfo, 'elId' | 'nodeId' | 'desc' | 'existing'> | null;
    picking: boolean;       // pick armed -> the button blinks "Click a control…"
    extraActions?: string;  // mode-specific action buttons after Pick
    actionsHtml?: string;   // replaces the Pick pair entirely (CAPTURE's ✕/Done)
    extraRows?: string;     // extra info rows (CAPTURE's rx count)
    live?: boolean;         // pulse the mark like a running capture
}

// The Pick button lives inside the card (armed state mutated in place by
// the caller's setPicking); `live` pulses the mark like a running capture.
export function renderPickCard(container: HTMLElement, opts: PickCardOptions): void {
    const pickBtnHtml =
        `<button class="dev-btn dev-pick-btn${opts.picking ? ' active' : ''}" id="${opts.pickId}"`
        + ` title="${opts.pickTitle}">${opts.picking ? 'Click a control…' : 'Pick'}</button>`
        + `<button class="dev-btn dev-pick-cancel" title="${t('Cancel picking (Esc)')}">&#10005;</button>`;
    const actions = opts.actionsHtml ?? pickBtnHtml + (opts.extraActions || '');
    if (opts.info) {
        const info = opts.info;
        const mapVal = info.existing
            ? `<span class="dev-chip dev-chip-mapped">MAPPED</span> <span class="dev-target-mapspec mono"></span>`
            : `<span class="dev-chip dev-chip-unmapped">UNMAPPED</span>`;
        container.innerHTML =
            `<div class="dev-target-info">`
            + `<div class="dev-target-id"><span class="dev-target-mark${opts.live ? ' live' : ''}">${opts.live ? '&#9679;' : '&#9632;'}</span> ${info.elId || '(no id)'}</div>`
            + `<div class="dev-target-row"><span class="lbl">node</span><span class="val mono">${info.nodeId}</span></div>`
            + `<div class="dev-target-row"><span class="lbl">dom</span><span class="val mono dev-target-dom"></span></div>`
            + `<div class="dev-target-row"><span class="lbl">map</span><span class="val">${mapVal}</span></div>`
            + (opts.extraRows || '')
            + `</div>`
            + `<div class="dev-target-actions">${actions}</div>`;
        container.querySelector('.dev-target-dom')!.textContent = info.desc;
        const spec = container.querySelector('.dev-target-mapspec');
        if (spec) spec.textContent = info.existing;
    } else {
        container.innerHTML =
            `<div class="dev-target-info">Target:</div>`
            + `<div class="dev-target-actions">${actions}</div>`;
    }
}

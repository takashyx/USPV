// Dynamic ID assignment & element injection. Runs after every
// UIBuilder.buildAll(); every helper is idempotent (guards on existing
// ids/elements) since model switches re-invoke it.

import { getNodeCategory } from '../view/categories';
import { setValueLabel } from '../view/render';
import { debouncedDrawLines } from './redraw';
import { formatFaderValue } from './decode';

// Category classes for the node header accent color (REQUIREMENTS.md §4.1) —
// class names come from the same table that resolves the category colors.
function applyCategoryClass(node: HTMLElement, nodeId: string): void {
    const cat = getNodeCategory(nodeId);
    if (cat) node.classList.add(cat.className);
}

function ensureMeterId(node: HTMLElement, nodeId: string): void {
    const meter = node.querySelector('.meter');
    if (meter && !meter.id) {
        meter.id = `${nodeId}-meter`;
    }
}

// Subtitle element (channel name / custom label from the device)
function ensureSubtitle(node: HTMLElement, nodeId: string): void {
    let subtitle = node.querySelector('.node-subtitle');
    if (!subtitle && (nodeId.startsWith('in-ch') || nodeId.startsWith('bus-mix') || nodeId.startsWith('bus-fx'))) {
        const header = node.querySelector('.node-header');
        if (header) {
            subtitle = document.createElement('div');
            subtitle.className = 'node-subtitle';
            header.appendChild(subtitle);
        }
    }
    if (subtitle && !subtitle.id) {
        subtitle.id = `${nodeId}-subtitle`;
    }
}

// Rename GAIN to BAL knob for MIX buses (FX knobs carry explicit ids in
// their send grid)
function renameMixFxKnobToBal(node: HTMLElement, nodeId: string): void {
    if (!nodeId.startsWith('bus-mix')) return;
    const knob = node.querySelector('.knob');
    const label = node.querySelector('.knob-label');
    if (knob && label) {
        knob.id = `${nodeId}-knob-bal`;
        knob.className = 'knob knob-pan'; // Style it as a pan/bal knob
        label.textContent = 'BAL';
    }
}

// Shared slug for the generated element ids: label text -> lowercase alphanumerics
function slugifyLabel(text: string): string {
    return text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assignDspBlockIds(node: HTMLElement, nodeId: string): void {
    node.querySelectorAll('.dsp-block').forEach(block => {
        if (!block.id) {
            block.id = `${nodeId}-dsp-${slugifyLabel(block.textContent!)}`;
        }
    });
}

function assignIndicatorIds(node: HTMLElement, nodeId: string): void {
    node.querySelectorAll('.indicator').forEach(ind => {
        if (!ind.id) {
            let name = ind.textContent!.trim().toLowerCase();
            if (name.startsWith('patch:')) name = 'patch';
            else if (name.startsWith('link:')) name = 'link';
            else if (name.startsWith('direct:')) name = 'direct';
            else name = slugifyLabel(name);
            ind.id = `${nodeId}-ind-${name}`;
        }
    });
}

// Sliders: id assignment, decimal precision, value label injection, and an
// 'input' listener to redraw lines on volume level changes
function setupSliders(node: HTMLElement, nodeId: string): void {
    node.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input => {
        if (!input.id) {
            const labelEl = input.parentElement!.querySelector('.fader-label');
            const label = labelEl ? slugifyLabel(labelEl.textContent!) : 'val';
            input.id = `${nodeId}-fader-${label}`;
        }

        // Allow decimal precision in the range sliders
        input.setAttribute('step', '0.1');

        // Inject fader-val display dynamically if missing
        let valEl = input.parentElement!.querySelector<HTMLElement>('.fader-val');
        if (!valEl) {
            valEl = document.createElement('div');
            valEl.className = 'fader-val';
            input.parentElement!.appendChild(valEl);
        }

        const renderValue = () => setValueLabel(valEl!, formatFaderValue(parseFloat(input.value)));
        renderValue();

        // Add event listener to redraw line paths instantly when levels cross the -60dB (OFF) threshold
        input.addEventListener('input', () => {
            renderValue();
            debouncedDrawLines();
        });
    });
}

// Knobs: id assignment and dynamic value label insertion
function setupKnobs(node: HTMLElement, nodeId: string): void {
    node.querySelectorAll('.knob').forEach(knob => {
        if (!knob.id) {
            const labelEl = knob.parentElement!.querySelector('.knob-label');
            const label = labelEl ? slugifyLabel(labelEl.textContent!) : 'val';
            knob.id = `${nodeId}-knob-${label}`;
        }

        // Add knob-val element dynamically if not present
        if (!knob.parentElement!.querySelector('.knob-val')) {
            const valDiv = document.createElement('div');
            valDiv.className = 'knob-val';
            valDiv.textContent = '--';
            knob.parentElement!.appendChild(valDiv);
        }
    });
}

// <div class="send-meta"> holding an ON (and optionally PRE) toggle —
// the shape shared by every injected send/master control
function makeSendMeta(children: HTMLElement[]): HTMLElement {
    const metaDiv = document.createElement('div');
    metaDiv.className = 'send-meta';
    metaDiv.append(...children);
    return metaDiv;
}

function makeToggleSpan(className: string, id: string, label: string): HTMLElement {
    const span = document.createElement('span');
    span.className = className;
    span.id = id;
    span.textContent = label;
    return span;
}

// Bus master ON buttons (REQUIREMENTS.md §4.8): MIX masters, FX returns
// and STEREO all get ON above their fader (MST / LEVEL / OUT). The TO ST
// assign buttons come from the node templates' send grids. (No CUE — the
// device exposes no bus/channel CUE parameter.)
function injectBusMasterControls(node: HTMLElement, nodeId: string): void {
    if (!['bus-mix1', 'bus-mix2', 'bus-stereo', 'bus-fx1', 'bus-fx2'].includes(nodeId)) return;
    if (document.getElementById(`${nodeId}-btn-on`)) return;

    const faderCol = node.querySelector('.fader-col');
    if (!faderCol) return;

    const metaDiv = makeSendMeta([makeToggleSpan('send-on', `${nodeId}-btn-on`, 'ON')]);
    faderCol.insertBefore(metaDiv, faderCol.firstChild);
}

// MONITOR ON button sits directly below the meter (REQUIREMENTS.md §4.8)
function injectMonitorOnButton(node: HTMLElement, nodeId: string): void {
    if (nodeId !== 'bus-mon1' && nodeId !== 'bus-mon2') return;
    if (document.getElementById(`${nodeId}-btn-on`)) return;

    const meter = node.querySelector('.meter-container');
    if (!meter) return;

    const metaDiv = makeSendMeta([makeToggleSpan('send-on', `${nodeId}-btn-on`, 'ON')]);
    meter.insertAdjacentElement('afterend', metaDiv);
}

// MAIN OUT ON / BAL controls
function injectMainOutControls(node: HTMLElement, nodeId: string): void {
    if (nodeId !== 'out-main') return;

    const faderRow = node.querySelector('.fader-row');
    if (!faderRow || document.getElementById('out-main-btn-on')) return;

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'mainout-ctrls';

    // BAL knob
    const knobCol = document.createElement('div');
    knobCol.className = 'knob-col knob-col--flush';
    const knob = document.createElement('div');
    knob.id = 'out-main-knob-bal';
    knob.className = 'knob knob-pan';
    knob.style.transform = 'rotate(0deg)';
    const label = document.createElement('div');
    label.className = 'knob-label';
    label.textContent = 'BAL';
    knobCol.appendChild(knob);
    knobCol.appendChild(label);
    controlsDiv.appendChild(knobCol);

    // ON button
    controlsDiv.appendChild(makeToggleSpan('send-on send-on--sm', 'out-main-btn-on', 'ON'));

    faderRow.parentNode!.insertBefore(controlsDiv, faderRow);
}

// Send ON/OFF & PRE/POST toggles above each mix/fx send fader (Inputs only)
function injectInputSendToggles(node: HTMLElement, nodeId: string): void {
    node.querySelectorAll('.faders-group .fader-col').forEach(faderCol => {
        const rangeInput = faderCol.querySelector('input[type="range"]');
        if (!rangeInput || !rangeInput.id) return;

        if (!nodeId.startsWith('in-ch')) return;

        const matches = rangeInput.id.match(/-fader-(mix1|mix2|fx1|fx2)$/);
        if (!matches) return;

        const type = matches[1]!; // mix1, mix2, fx1, fx2

        if (!faderCol.querySelector('.send-meta')) {
            const toggles = [makeToggleSpan('send-on', `${nodeId}-send-${type}-on`, 'ON')];
            if (type.startsWith('mix')) {
                toggles.push(makeToggleSpan('send-pre', `${nodeId}-send-${type}-pre`, 'PRE'));
            }
            // Insert at the top of fader-col
            faderCol.insertBefore(makeSendMeta(toggles), faderCol.firstChild);
        }
    });
}

export function assignDynamicIds(): void {
    document.querySelectorAll<HTMLElement>('.node').forEach(node => {
        const nodeId = node.id;
        if (!nodeId) return;

        applyCategoryClass(node, nodeId);
        ensureMeterId(node, nodeId);
        ensureSubtitle(node, nodeId);
        renameMixFxKnobToBal(node, nodeId);
        assignDspBlockIds(node, nodeId);
        assignIndicatorIds(node, nodeId);
        setupSliders(node, nodeId);
        setupKnobs(node, nodeId);
        injectBusMasterControls(node, nodeId);
        injectMonitorOnButton(node, nodeId);
        injectMainOutControls(node, nodeId);
        injectInputSendToggles(node, nodeId);
    });
}

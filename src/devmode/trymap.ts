// TRYMAP: temporary runtime links — drive a picked UI control from
// an address in CONSOLE's UNMAPPED list to verify a mapping candidate
// before writing it into device-map.ts. Entries are pushed into the
// runtime reverse maps (so the normal notify path updates the
// control) and removed again on unlink; nothing is persisted.
// Meter links live in REVERSE_METER_MAP, which the meter tap
// switcher rebuilds — cycling a tap drops temp meter links.

import { t } from '../app/i18n';
import { REVERSE_METER_MAP, REVERSE_PARAM_MAP } from '../data/device-map';
import type { ParamType } from '../shared/types';
import { describeEl, renderPickCard, type TargetInfo } from './pick-card';

interface TempLink {
    el: HTMLElement | null;
    elId: string;
    nodeId: string;
    kind: 'param' | 'meter';
    addr: string;
    type: ParamType; // params only; ignored for meters
}

export interface TrymapMode {
    setTarget(el: HTMLElement): void;
    clearTarget(): void;
    hasTarget(): boolean;
    render(): void;
    // Show/hide the linked controls' board outlines (dev toggle)
    setHighlights(on: boolean): void;
    // Temp links keep working across a model switch (the reverse maps
    // survive the rebuild) — re-resolve their elements and re-apply the
    // board outline. The picked-but-unlinked target's element is gone.
    reattach(devMode: boolean): void;
}

export interface TrymapModeDeps {
    isPicking(): boolean;
    togglePicking(): void;
    // Live view of CONSOLE's UNMAPPED, row-per-address
    unmappedAddrRows(): { kind: 'param' | 'meter'; addr: string }[];
    // Linking/unlinking moves the address out of / back into UNMAPPED
    refreshObserved(): void;
}

export function initTrymapMode(deps: TrymapModeDeps): TrymapMode {
    const tempLinks: TempLink[] = [];
    let target: TargetInfo | null = null;
    let selectedAddr: { kind: 'param' | 'meter'; addr: string } | null = null;

    const targetEl = document.getElementById('dev-trymap-target')!;
    const addrListEl = document.getElementById('dev-trymap-addr-list')!;
    const listEl = document.getElementById('dev-trymap-list')!;
    const typeEl = document.getElementById('dev-trymap-type') as HTMLSelectElement;
    const applyBtn = document.getElementById('dev-trymap-apply') as HTMLButtonElement;

    function setTarget(el: HTMLElement): void {
        target?.el?.classList.remove('dev-trymap-targeting');
        target = describeEl(el);
        // Same affordance as the CAPTURE target: red glow pulse (scoped
        // to the TRYMAP tab via body.dev-submode-trymap) + scroll to it
        el.classList.add('dev-trymap-targeting');
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        render();
    }

    function clearTarget(): void {
        target?.el?.classList.remove('dev-trymap-targeting');
        target = null;
    }

    function applyTempLink(): void {
        if (!target || !selectedAddr) return;
        const { kind, addr } = selectedAddr;
        const type = typeEl.value as ParamType;
        if (kind === 'param') {
            if (!REVERSE_PARAM_MAP[addr]) REVERSE_PARAM_MAP[addr] = [];
            REVERSE_PARAM_MAP[addr].push({ elId: target.elId, type });
        } else {
            if (!REVERSE_METER_MAP[addr]) REVERSE_METER_MAP[addr] = [];
            REVERSE_METER_MAP[addr].push(target.elId);
        }
        tempLinks.push({
            el: target.el, elId: target.elId, nodeId: target.nodeId,
            kind, addr, type,
        });
        target.el?.classList.add('dev-flag-trymap');
        clearTarget();
        selectedAddr = null;
        render();
        deps.refreshObserved(); // the address leaves UNMAPPED while linked
    }

    function removeTempLink(idx: number): void {
        const [link] = tempLinks.splice(idx, 1);
        if (!link) return;
        if (link.kind === 'param') {
            const entries = REVERSE_PARAM_MAP[link.addr];
            if (entries) {
                const i = entries.findIndex(e => e.elId === link.elId && e.type === link.type);
                if (i >= 0) entries.splice(i, 1);
                if (entries.length === 0) delete REVERSE_PARAM_MAP[link.addr];
            }
        } else {
            const elIds = REVERSE_METER_MAP[link.addr];
            if (elIds) {
                const i = elIds.indexOf(link.elId);
                if (i >= 0) elIds.splice(i, 1);
                if (elIds.length === 0) delete REVERSE_METER_MAP[link.addr];
            }
        }
        // keep the outline while another temp link still targets the element
        if (link.el && !tempLinks.some(l => l.el === link.el)) {
            link.el.classList.remove('dev-flag-trymap');
        }
        render();
        deps.refreshObserved(); // the address returns to UNMAPPED
    }

    function render(): void {
        // ① target card — CAPTURE-style; ✕ deselects (same as Esc), the
        // mark pulses until the target is linked
        renderPickCard(targetEl, {
            pickId: 'dev-trymap-pick',
            pickTitle: t('Pick the UI control to drive'),
            info: target,
            picking: deps.isPicking(),
            extraActions: target
                ? `<button class="dev-btn" id="dev-trymap-deselect" title="${t('Deselect the target (Esc)')}">&#10005;</button>`
                : '',
            live: true,
        });

        // ② address list (live view of UNMAPPED, row-per-address)
        const rows = deps.unmappedAddrRows();
        document.getElementById('dev-trymap-addr-count')!.textContent = rows.length ? ` ${rows.length}` : '';
        addrListEl.innerHTML = '';
        rows.forEach(r => {
            const row = document.createElement('div');
            const selected = !!selectedAddr && selectedAddr.addr === r.addr && selectedAddr.kind === r.kind;
            row.className = 'dev-trymap-addr' + (selected ? ' selected' : '');
            row.textContent = `${r.kind === 'param' ? 'parameters' : 'meters'} ${r.addr}`;
            row.addEventListener('click', () => { selectedAddr = r; render(); });
            addrListEl.appendChild(row);
        });
        typeEl.disabled = !!selectedAddr && selectedAddr.kind === 'meter';
        applyBtn.disabled = !target || !selectedAddr;

        // ③ linked list
        document.getElementById('dev-trymap-count')!.textContent =
            tempLinks.length ? ' ' + t('{n} items', { n: String(tempLinks.length) }) : '';
        listEl.innerHTML = '';
        tempLinks.forEach((l, i) => {
            const item = document.createElement('div');
            item.className = 'dev-flag-item';
            const head = document.createElement('div');
            head.className = 'dev-flag-head';
            head.innerHTML = `<b>${l.elId}</b>`
                + `<button class="dev-flag-del" data-i="${i}" title="${t('Unlink')}">&#10005;</button>`;
            const meta = document.createElement('div');
            meta.className = 'dev-flag-meta';
            meta.textContent = `${l.kind === 'param' ? 'parameters' : 'meters'} ${l.addr}`
                + (l.kind === 'param' ? ` (${l.type})` : '');
            item.append(head, meta);
            listEl.appendChild(item);
        });
    }

    function setHighlights(on: boolean): void {
        tempLinks.forEach(l => { if (l.el) l.el.classList.toggle('dev-flag-trymap', on); });
    }

    function reattach(devMode: boolean): void {
        clearTarget();
        tempLinks.forEach(l => {
            l.el = document.getElementById(l.elId);
            if (l.el && devMode) l.el.classList.add('dev-flag-trymap');
        });
        render();
    }

    // ---------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------

    listEl.addEventListener('click', (e) => {
        const del = (e.target as HTMLElement).closest<HTMLElement>('.dev-flag-del');
        if (del) removeTempLink(Number(del.dataset.i));
    });
    targetEl.addEventListener('click', (e) => {
        const clicked = e.target as HTMLElement;
        if (clicked.closest('#dev-trymap-pick')) {
            deps.togglePicking();
        } else if (clicked.closest('#dev-trymap-deselect')) {
            clearTarget();
            render();
        }
    });
    applyBtn.addEventListener('click', applyTempLink);
    document.getElementById('dev-trymap-clear')!.addEventListener('click', () => {
        while (tempLinks.length) removeTempLink(0);
    });

    return {
        setTarget,
        clearTarget,
        hasTarget: () => !!target,
        render,
        setHighlights,
        reattach,
    };
}

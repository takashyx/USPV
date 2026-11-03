// CAPTURE mode: click a control, operate the matching control on the real
// hardware, and record every parameter notification that arrives under
// that element — the evidence the mapping fix-request report is built from.

import { t } from '../app/i18n';
import { REVERSE_METER_MAP, REVERSE_PARAM_MAP } from '../data/device-map';
import type { VdpEvent } from './console-log';
import { describeEl, renderPickCard } from './pick-card';
import { buildMarkdownReport } from './report';

interface CaptureRecord {
    kind: 'param' | 'meter';
    count: number;
    values: unknown[];
}

interface Capture {
    elId: string;
    nodeId: string;
    el?: HTMLElement;
    desc: string;
    existing: string | null;
    startedAt: Date;
    endedAt?: Date;
    addrs: Map<string, CaptureRecord>;
}

const MAX_VALUES_PER_ADDR = 8;

export interface CaptureMode {
    start(el: HTMLElement): void;
    finish(): void;   // Done: complete & record (no-op when idle)
    cancel(): void;   // ✕ / Esc: abort without recording
    isRunning(): boolean;
    recordIfCapturing(p: VdpEvent): void;
    render(): void;
    buildReport(): string;
}

export interface CaptureModeDeps {
    isPicking(): boolean;
    togglePicking(): void;
    refreshReports(): void;
}

export function initCaptureMode(deps: CaptureModeDeps): CaptureMode {
    const capStatusEl = document.getElementById('dev-capture-status')!;
    const capTargetEl = document.getElementById('dev-capture-target')!;
    const capAddrsEl = document.getElementById('dev-capture-addrs')!;
    const capListEl = document.getElementById('dev-capture-list')!;
    const resultsCountEl = document.getElementById('dev-results-count')!;

    let current: Capture | null = null; // active capture
    let lastTarget: Capture | null = null; // picked control shown in the target card
                                           // (cleared on Done/cancel -> back to unselected)
    const captures: Capture[] = [];        // finished captures (newest last)

    function start(el: HTMLElement): void {
        finish();
        const d = describeEl(el);
        current = {
            elId: d.elId || '(no id)',
            nodeId: d.nodeId,
            el,
            desc: d.desc,
            existing: d.existing,
            startedAt: new Date(),
            addrs: new Map(), // addr -> {kind, count, values[]}
        };
        lastTarget = current;
        el.classList.add('dev-capturing');
        // Always bring the glowing target into view, however it was chosen
        // (worklist click or board pick)
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        render();
    }

    function recordIfCapturing(p: VdpEvent): void {
        if (!current) return;
        let rec = current.addrs.get(p.addr);
        if (!rec) {
            rec = { kind: p.kind, count: 0, values: [] };
            current.addrs.set(p.addr, rec);
        }
        rec.count++;
        if (rec.values.length < MAX_VALUES_PER_ADDR) rec.values.push(p.value);
        queueRender();
    }

    // Notifications arrive in bursts (fader drags, meter floods): the full
    // re-render (target card, address rows, finished-captures list and all
    // three reports) runs at most a few times a second while capturing
    let renderQueued = false;
    function queueRender(): void {
        if (renderQueued) return;
        renderQueued = true;
        setTimeout(() => {
            renderQueued = false;
            render();
        }, 150);
    }

    function finish(): void {
        if (!current) return;
        current.el!.classList.remove('dev-capturing');
        current.endedAt = new Date();
        delete current.el;
        captures.push(current);
        current = null;
        lastTarget = null; // Done returns the card to the unselected state
        render();
    }

    // ✕ / Esc: abort the running capture WITHOUT recording anything —
    // the target stays pending in the worklist
    function cancel(): void {
        if (!current) return;
        current.el!.classList.remove('dev-capturing');
        current = null;
        lastTarget = null;
        render();
    }

    // Most-notified address that has no existing assignment — the primary
    // mapping candidate (same heuristic the report uses)
    function bestUnassigned(c: Capture): { addr: string; rec: CaptureRecord } | null {
        let best: { addr: string; rec: CaptureRecord } | null = null;
        for (const [addr, rec] of c.addrs) {
            const assigned = rec.kind === 'param'
                ? (REVERSE_PARAM_MAP[addr] || []).length
                : (REVERSE_METER_MAP[addr] || []).length;
            if (!assigned && (!best || rec.count > best.rec.count)) best = { addr, rec };
        }
        return best;
    }

    // Live per-address view of the displayed capture: value sequences as
    // they arrive, existing assignments, and the ★ candidate highlighted.
    // Built via DOM/textContent — values come from the device.
    function renderAddrs(): void {
        capAddrsEl.innerHTML = '';
        const tgt = current || lastTarget;
        if (!tgt || tgt.addrs.size === 0) return;
        const best = bestUnassigned(tgt);
        for (const [addr, rec] of tgt.addrs) {
            const assigned = rec.kind === 'param'
                ? (REVERSE_PARAM_MAP[addr] || []).map(m => m.elId)
                : (REVERSE_METER_MAP[addr] || []);
            const isBest = !!best && best.addr === addr;
            const row = document.createElement('div');
            row.className = 'dev-addr' + (isBest ? ' cand' : '');
            const seq = rec.values.map(v => JSON.stringify(v)).join(', ')
                + (rec.count > rec.values.length ? `, …(${t('total {n}', { n: String(rec.count) })})` : ` (${rec.count})`);
            row.textContent = `${isBest ? '★ ' : ''}${rec.kind === 'param' ? 'parameters' : 'meters'}/${addr}  ${seq}`
                + (assigned.length ? ` — ${t('existing:')} ${assigned.join(', ')}` : '');
            row.title = isBest ? t('Most frequent unassigned = mapping candidate') : '';
            capAddrsEl.appendChild(row);
        }
    }

    function render(): void {
        const picking = deps.isPicking();
        if (picking) {
            capStatusEl.className = 'active';
            capStatusEl.innerHTML =
                '<span class="dev-i18n-en">Click the target control on the board (other clicks are disabled; Esc cancels).</span>'
                + '<span class="dev-i18n-ja">対象のコントロールをクリックしてください（他のクリックは無効 / Escで解除）。</span>';
        } else if (current) {
            capStatusEl.className = 'active';
            capStatusEl.innerHTML =
                `<span class="dev-i18n-en">&#9679; Capturing: ${current.elId} — operate it on the hardware (${current.addrs.size} addr).</span>`
                + `<span class="dev-i18n-ja">&#9679; キャプチャ中: ${current.elId} — 実機で該当コントロールを操作（${current.addrs.size} addr。Done/Enter＝完了、&#10005;/Esc＝キャンセル）。</span>`;
        } else {
            capStatusEl.className = '';
            capStatusEl.innerHTML =
                '<span class="dev-i18n-en">Press <b>Pick</b> — unmapped controls start blinking red; click one to capture.</span>'
                + '<span class="dev-i18n-ja">Pick を押すと未マッピングのコントロールが赤点滅します。対象をクリックして調査開始。</span>';
        }

        // Picked-control detail card: always visible. The Pick button lives
        // INSIDE the card; while capturing it is replaced by the stacked
        // ✕ / Done actions. Buttons are recreated per render — clicks are
        // delegated on capTargetEl.
        const n = lastTarget ? [...lastTarget.addrs.values()].reduce((s, r) => s + r.count, 0) : 0;
        renderPickCard(capTargetEl, {
            pickId: 'dev-capture-pick',
            pickTitle: t('Click a control on the board to choose the capture target (other clicks are disabled while picking)'),
            info: lastTarget,
            picking,
            live: !!lastTarget && lastTarget === current,
            extraRows: n
                ? `<div class="dev-target-row"><span class="lbl">rx</span><span class="val">${lastTarget!.addrs.size} addr / ${n} notifications</span></div>`
                : '',
            actionsHtml: lastTarget === current && current
                ? `<button class="dev-btn" id="dev-capture-cancel" title="${t('Cancel without recording (Esc)')}">&#10005;</button>`
                    + `<button class="dev-btn" id="dev-capture-done" title="${t('Finish and record this capture (Enter)')}">Done</button>`
                : undefined,
        });
        renderAddrs();

        resultsCountEl.textContent = captures.length ? ' ' + t('{n} items', { n: String(captures.length) }) : '';
        capListEl.innerHTML = '';
        captures.forEach((c, i) => {
            const total = [...c.addrs.values()].reduce((s, r) => s + r.count, 0);
            const best = bestUnassigned(c);
            const item = document.createElement('div');
            item.className = 'dev-cap-item';
            const head = document.createElement('div');
            head.className = 'dev-cap-head';
            head.innerHTML = `<span class="dev-cap-id">${i + 1}. ${c.elId}</span>`
                + `<button class="dev-cap-del" data-i="${i}" title="${t('Delete this record')}">&#10005;</button>`;
            const rows = document.createElement('div');
            rows.innerHTML =
                `<div class="dev-target-row"><span class="lbl">rx</span><span class="val">`
                + (c.addrs.size ? `${c.addrs.size} addr / ${total} notifications` : '<span class="dev-cap-none">none</span>')
                + `</span></div>`
                + (best ? `<div class="dev-target-row"><span class="lbl">cand</span><span class="val mono">${best.addr}</span></div>` : '');
            item.append(head, rows);
            capListEl.appendChild(item);
        });

        deps.refreshReports(); // ③ REPORT column follows every change live
    }

    // ---------------------------------------------------------------
    // Markdown report
    // ---------------------------------------------------------------

    function guessType(rec: CaptureRecord): string | null {
        if (rec.kind === 'meter') return null;
        return rec.values.every(v => v === 0 || v === 1) ? 'bool' : '?';
    }

    function captureSection(c: Capture, i: number): string {
        const lines: string[] = [];
        lines.push(`## ${i + 1}. Element \`${c.elId}\` (node: ${c.nodeId})`);
        lines.push(`- DOM: ${c.desc}`);
        lines.push(`- Existing mapping: ${c.existing || 'none (UI only)'}`);
        if (c.addrs.size === 0) {
            lines.push('- Observed notifications: none — operating the hardware produced nothing (possibly unsubscribed, or the parameter is not exposed)');
            return lines.join('\n');
        }
        lines.push('- Notifications received during the capture (by address):');
        let best: { addr: string; rec: CaptureRecord } | null = null; // most-notified unmapped addr -> primary candidate
        for (const [addr, rec] of c.addrs) {
            const assigned = rec.kind === 'param'
                ? (REVERSE_PARAM_MAP[addr] || []).map(m => m.elId)
                : (REVERSE_METER_MAP[addr] || []);
            const seq = rec.values.map(v => JSON.stringify(v)).join(', ')
                + (rec.count > rec.values.length ? `, … (${rec.count} total)` : ` (${rec.count}x)`);
            lines.push(`  - \`/vd/${rec.kind === 'param' ? 'parameters' : 'meters'}/${addr}\` values: ${seq}`
                + ` — existing assignment: ${assigned.length ? assigned.map(a => `\`${a}\``).join(', ') : 'none'}`);
            if (!assigned.length && (!best || rec.count > best.rec.count)) best = { addr, rec };
        }
        if (best) {
            const parts = best.addr.split(':').map(Number);
            const entry = best.rec.kind === 'param'
                ? `PARAM_MAPPINGS: \`'${c.elId}': { paramId: ${parts[0]}, x: ${parts[1]}, y: ${parts[2]}, type: '${guessType(best.rec)}' }\``
                : `METER_MAPPINGS: \`'${c.elId}': { meterId: ${parts[0]}, x: ${parts[1]} }\``;
            lines.push(`- Candidate from the unassigned addresses: ${entry} (judge the type from the value sequence)`);
        }
        return lines.join('\n');
    }

    // The CAPTURE report is a self-contained fix request: it states the
    // repo/file to fix, the address conventions, and the captured evidence.
    function buildReport(): string {
        const all = captures.concat(current ? [current] : []);
        return buildMarkdownReport({
            title: '# URX Signal Path Visualizer — mapping fix request (DEVELOPER TOOL / CAPTURE)',
            intro: [
                'Each element below was captured while operating the matching control on the',
                'real device. Judge the mapping from the observed addresses / values and',
                'update PARAM_MAPPINGS / METER_MAPPINGS in src/data/device-map.ts.',
                '',
                '- Address format: parameter `{paramId}:{x}:{y}` / meter `{meterId}:{x}`',
                '- "existing assignment: none" = new-mapping candidate',
            ],
            model: (document.getElementById('model-select') as HTMLSelectElement).value,
            emptyMessage: '(no captures)',
            sections: all.map(captureSection),
        });
    }

    // ---------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------

    // Pick / ✕ / Done in the target card (recreated per render — delegated)
    capTargetEl.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('#dev-capture-done')) finish();
        else if (target.closest('#dev-capture-cancel')) cancel();
        else if (target.closest('#dev-capture-pick')) deps.togglePicking();
    });

    // Deleting a result returns its target to the pending pool
    capListEl.addEventListener('click', (e) => {
        const del = (e.target as HTMLElement).closest<HTMLElement>('.dev-cap-del');
        if (!del) return;
        const [removed] = captures.splice(Number(del.dataset.i), 1);
        if (lastTarget === removed) lastTarget = null;
        render();
    });

    document.getElementById('dev-capture-clear')!.addEventListener('click', () => {
        finish();
        captures.length = 0;
        lastTarget = null;
        render();
    });

    return {
        start,
        finish,
        cancel,
        isRunning: () => !!current,
        recordIfCapturing,
        render,
        buildReport,
    };
}

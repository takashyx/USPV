// Dev-console left half: the Device Center traffic log (RX/TX) with its
// TIMELINE filter toggles, and the OBSERVED / UNMAPPED address lists fed
// from every received notification.

import { ConfigStore } from '../config/config-store';
import { REVERSE_METER_MAP, REVERSE_PARAM_MAP } from '../data/device-map';
import { addrCompare, subsListText } from './addr-utils';
import { copyToClipboard } from './report';

export interface VdpEvent {
    kind: 'param' | 'meter';
    addr: string;
    value: unknown;
}

// Parameter/meter notification fields, or null for any other message
export function parseVdp(msg: any): VdpEvent | null {
    const vdp = (msg.params && msg.params.vdp) || (msg.result && msg.result.vdp);
    if (!vdp || !vdp.uri) return null;
    const m = vdp.uri.split('?')[0].match(/^\/vd\/(parameters|meters)\/(.+)$/);
    if (!m) return null;
    return {
        kind: m[1] === 'parameters' ? 'param' : 'meter',
        addr: m[2],
        value: vdp.data ? vdp.data.current_value : undefined,
    };
}

// Full JSON, never truncated — long payloads are handled by the Wrap
// toggle (wrap on / horizontal scroll off)
export function summarizeMsg(msg: any, p: VdpEvent | null): string {
    if (p) return `${p.kind === 'param' ? 'parameters' : 'meters'}/${p.addr} = ${JSON.stringify(p.value)}`;
    if (msg.method) return msg.method + (msg.params ? ' ' + JSON.stringify(msg.params) : '');
    return JSON.stringify(msg);
}

export interface DevConsole {
    appendLog(dir: 'rx' | 'tx', text: string): void;
    showMeters(): boolean;
    recordObserved(p: VdpEvent): void;
    // Re-render OBSERVED/UNMAPPED (the reverse maps changed underneath)
    renderObserved(): void;
    // One row per unmapped observed address (TRYMAP pick targets)
    unmappedAddrRows(): { kind: 'param' | 'meter'; addr: string }[];
}

const MAX_LOG_LINES = 400;

// `onObservedChanged` fires after every OBSERVED/UNMAPPED re-render (the
// TRYMAP address list mirrors UNMAPPED and follows it live).
export function initDevConsole(onObservedChanged: () => void): DevConsole {
    const logEl = document.getElementById('dev-log')!;
    const logCountEl = document.getElementById('dev-log-count')!;

    // ---------------------------------------------------------------
    // Traffic log
    // ---------------------------------------------------------------

    let logLines = 0;

    function appendLog(dir: 'rx' | 'tx', text: string): void {
        const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
        const d = new Date();
        const stamp = d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
        const line = document.createElement('div');
        line.className = `dev-log-line ${dir}`;
        line.innerHTML = `<span class="t">${stamp}</span><span class="dir">${dir.toUpperCase()}</span>`;
        line.appendChild(document.createTextNode(text));
        logEl.appendChild(line);
        logLines++;
        while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild!.remove();
        logCountEl.textContent = `${logLines} msg`;
        if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
    }

    // ---------------------------------------------------------------
    // TIMELINE header toggles: RX / TX (line visibility filters — hiding
    // is retroactive via CSS classes on #dev-log), Meters (include meter
    // notifications) and Wrap (soft-wrap long lines; OFF = horizontal
    // scroll). All states are auto-saved (§2.6) and restored here.
    // ---------------------------------------------------------------

    const wireLogToggle = (
        trackId: string, toggleId: string, key: string, defaultOn: boolean,
        apply: (on: boolean) => void,
    ): (() => boolean) => {
        let on = defaultOn ? ConfigStore.get(key) !== false : ConfigStore.get(key) === true;
        const track = document.getElementById(trackId)!;
        const sync = () => { track.classList.toggle('on', on); apply(on); };
        sync();
        document.getElementById(toggleId)!.addEventListener('click', () => {
            on = !on;
            ConfigStore.set(key, on);
            sync();
        });
        return () => on;
    };

    wireLogToggle('dev-log-rx-track', 'dev-log-rx-toggle', 'devLogRx', true,
        on => logEl.classList.toggle('hide-rx', !on));
    wireLogToggle('dev-log-tx-track', 'dev-log-tx-toggle', 'devLogTx', true,
        on => logEl.classList.toggle('hide-tx', !on));
    const showMeters = wireLogToggle('dev-log-meters-track', 'dev-log-meters-toggle', 'devLogMeters', false,
        () => {});
    wireLogToggle('dev-log-wrap-track', 'dev-log-wrap-toggle', 'devLogWrap', false,
        on => logEl.classList.toggle('wrap', on));

    // ---------------------------------------------------------------
    // OBSERVED (console right half): every address actually received —
    // RX ONLY, TX is never counted (recordObserved is called from onRx
    // exclusively) — deduped; consecutive last parts collapse to n-m
    // ---------------------------------------------------------------

    const observed: Record<'param' | 'meter', Set<string>> = { param: new Set(), meter: new Set() };
    let observedDirty = false;

    function recordObserved(p: VdpEvent): void {
        if (observed[p.kind].has(p.addr)) return;
        observed[p.kind].add(p.addr);
        // meter floods arrive fast — batch the re-render
        if (!observedDirty) {
            observedDirty = true;
            setTimeout(() => { observedDirty = false; renderObserved(); }, 300);
        }
    }

    function observedText(): string {
        return subsListText([...observed.param], [...observed.meter]);
    }

    // Observed addresses that have no mapping-table entry yet
    function unmappedObservedText(): string {
        return subsListText(
            [...observed.param].filter(a => !REVERSE_PARAM_MAP[a]),
            [...observed.meter].filter(a => !REVERSE_METER_MAP[a]));
    }

    function renderObserved(): void {
        const np = observed.param.size;
        const nm = observed.meter.size;
        document.getElementById('dev-observed-count')!.textContent =
            np + nm ? ` parameters ${np} / meters ${nm}` : '';
        document.getElementById('dev-observed-list')!.textContent = observedText();

        const up = [...observed.param].filter(a => !REVERSE_PARAM_MAP[a]).length;
        const um = [...observed.meter].filter(a => !REVERSE_METER_MAP[a]).length;
        document.getElementById('dev-unmapped-obs-count')!.textContent =
            up + um ? ` parameters ${up} / meters ${um}` : '';
        document.getElementById('dev-unmapped-obs-list')!.textContent = unmappedObservedText();

        onObservedChanged();
    }

    // Same population as UNMAPPED, but one row per address
    // (no n-m collapsing — rows are pick targets)
    function unmappedAddrRows(): { kind: 'param' | 'meter'; addr: string }[] {
        return [
            ...[...observed.param].filter(a => !REVERSE_PARAM_MAP[a]).sort(addrCompare)
                .map(addr => ({ kind: 'param' as const, addr })),
            ...[...observed.meter].filter(a => !REVERSE_METER_MAP[a]).sort(addrCompare)
                .map(addr => ({ kind: 'meter' as const, addr })),
        ];
    }

    // ---------------------------------------------------------------
    // Wiring: clear + copy buttons
    // ---------------------------------------------------------------

    document.getElementById('dev-log-clear')!.addEventListener('click', () => {
        logEl.innerHTML = '';
        logLines = 0;
        logCountEl.textContent = '';
        observed.param.clear();
        observed.meter.clear();
        renderObserved();
    });
    document.getElementById('dev-observed-copy')!.addEventListener('click', (e) =>
        copyToClipboard(observedText(), e.currentTarget as HTMLElement));
    document.getElementById('dev-unmapped-obs-copy')!.addEventListener('click', (e) =>
        copyToClipboard(unmappedObservedText(), e.currentTarget as HTMLElement));

    return { appendLog, showMeters, recordObserved, renderObserved, unmappedAddrRows };
}

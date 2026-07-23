// SUBSCRIBE panel: live view of the Device Center subscriptions (fed by
// the broker via the traffic hooks) + manual add / remove, bulk-range
// expansion and the Restore Default / Clear All actions.

import { t } from '../app/i18n';
import { deviceSync } from '../broker/socket';
import { addrCompare } from './addr-utils';

export interface SubsPanel {
    // null re-renders the current state (language switch)
    renderSubs(subs: Record<string, Set<string>> | null): void;
}

// Expands "900-910:0:0-1" into every address combination. Each ":"
// part is a number or an n-m range; param addresses have 3 parts,
// meter addresses 2. Returns null on bad syntax or when the expansion
// exceeds the cap (a runaway range would flood Device Center).
const MAX_BULK_SUBS = 512;

export function expandAddrRange(kind: string, text: string): string[] | null {
    const parts = text.split(':');
    // parameters = 3 parts, meters = 2; other VD kinds are free-form
    const expected = kind === 'parameters' ? 3 : kind === 'meters' ? 2 : null;
    if (expected !== null && parts.length !== expected) return null;
    const ranges: [number, number][] = [];
    for (const p of parts) {
        const m = p.match(/^(\d+)(?:-(\d+))?$/);
        if (!m) return null;
        const from = Number(m[1]);
        const to = m[2] !== undefined ? Number(m[2]) : from;
        if (to < from) return null;
        ranges.push([from, to]);
    }
    const total = ranges.reduce((n, [f, t]) => n * (t - f + 1), 1);
    if (total > MAX_BULK_SUBS) return null;
    let keys = [''];
    ranges.forEach(([from, to], i) => {
        const next: string[] = [];
        for (const prefix of keys) {
            for (let v = from; v <= to; v++) {
                next.push(i === 0 ? String(v) : `${prefix}:${v}`);
            }
        }
        keys = next;
    });
    return keys;
}

export function initSubsPanel(): SubsPanel {
    const subsListEl = document.getElementById('dev-subs-list')!;
    const subsCountEl = document.getElementById('dev-subs-count')!;
    let subsState: Record<string, Set<string>> = { parameters: new Set(), meters: new Set() };

    // parameters / meters first, any other VD kinds after, alphabetically.
    // VD kinds are displayed with their accurate protocol names
    // ('parameters' / 'meters' / ...), matching the /vd/{kind}/ URIs.
    function sortedKinds(obj: Record<string, Set<string>>): string[] {
        return Object.keys(obj).sort((a, b) => {
            const rank = (k: string) => k === 'parameters' ? 0 : k === 'meters' ? 1 : 2;
            return rank(a) - rank(b) || a.localeCompare(b);
        });
    }

    function renderSubs(subs: Record<string, Set<string>> | null): void {
        if (subs) subsState = subs;
        const counts = sortedKinds(subsState)
            .filter(k => subsState[k]!.size)
            .map(k => `${k} ${subsState[k]!.size}`);
        subsCountEl.textContent = counts.length ? ` ${counts.join(' / ')}` : ' (not connected)';
        subsListEl.innerHTML = '';
        sortedKinds(subsState).forEach(kind => {
            [...subsState[kind]!].sort(addrCompare).forEach(key => {
                const row = document.createElement('div');
                row.className = 'dev-subs-item';
                row.innerHTML = `<span>${kind} ${key}</span>`
                    + `<button class="dev-flag-del" data-kind="${kind}" data-key="${key}" title="${t('Unsubscribe')}">&#10005;</button>`;
                subsListEl.appendChild(row);
            });
        });
    }

    subsListEl.addEventListener('click', (e) => {
        const del = (e.target as HTMLElement).closest<HTMLElement>('.dev-flag-del');
        if (del) deviceSync.subscribe(del.dataset.kind!, del.dataset.key!, false);
    });

    // Shared error flash on the ADD SUBSCRIPTION input (bad syntax, range
    // too large, or no device connection)
    function flashSubsError(): void {
        const input = document.getElementById('dev-subs-addr')!;
        input.classList.add('dev-input-error');
        setTimeout(() => input.classList.remove('dev-input-error'), 1200);
    }

    // Input forms:
    //   "902:0:0"        -> kind inferred from the part count (3 = param,
    //   "118:0"             2 = meter)
    //   "version 0"      -> explicit VD kind prefix; any /vd/{kind}/ works
    //   "param 0-10:0:0" -> param / meter shorthands are accepted too
    function addSubscriptionFromInput(): void {
        const input = document.getElementById('dev-subs-addr') as HTMLInputElement;
        const text = input.value.trim();
        let kind: string | null = null;
        let addr = text;
        const prefixed = text.match(/^([A-Za-z_][\w-]*)\s+(\S+)$/);
        if (prefixed) {
            kind = prefixed[1]!.toLowerCase();
            if (kind === 'param') kind = 'parameters';
            if (kind === 'meter') kind = 'meters';
            addr = prefixed[2]!;
        } else {
            const nParts = text.split(':').length;
            kind = nParts === 3 ? 'parameters' : nParts === 2 ? 'meters' : null;
        }
        const keys = kind && expandAddrRange(kind, addr);
        if (!keys) return flashSubsError();               // bad syntax / range too large
        if (!deviceSync.subscribe(kind!, keys, true)) return flashSubsError(); // not connected
        input.value = '';
    }

    document.getElementById('dev-subs-add-btn')!.addEventListener('click', addSubscriptionFromInput);
    document.getElementById('dev-subs-addr')!.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
            e.stopPropagation();
            addSubscriptionFromInput();
        }
    });

    // NOTE: the former "Add Everything(Nasty)" bulk-range button was removed:
    // a range-literal regist on /vd/meters has crashed Device Center
    // (docs/device-mapping.md §1.3). Manual per-address / expanded-range adds
    // above stay within the safe per-address protocol.
    // Restore Default: back to the mapped-addresses-only state.
    document.getElementById('dev-subs-default-btn')!.addEventListener('click', () => {
        if (!deviceSync.restoreDefaultSubscriptions()) flashSubsError();
    });
    document.getElementById('dev-subs-clear-btn')!.addEventListener('click', () => {
        if (!deviceSync.clearAllSubscriptions()) flashSubsError();
    });

    return { renderSubs };
}

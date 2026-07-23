// GHOST / MISLINK manual flagging: mark controls that do not exist on the
// device (ghost) or whose link is wrong (mislink), and build the matching
// fix-request reports.

import { t } from '../app/i18n';
import { describeEl, renderPickCard, type TargetInfo } from './pick-card';
import { buildMarkdownReport } from './report';

export type FlagKind = 'ghost' | 'mislink';

interface Flag extends TargetInfo {
    note: string;
}

const FLAG_CLASS: Record<FlagKind, string> = { ghost: 'dev-flag-ghost', mislink: 'dev-flag-mislink' };

export interface FlagsMode {
    add(kind: FlagKind, el: HTMLElement): void;
    renderAll(): void;
    // Show/hide every flag's board highlight (dev OFF hides them without
    // discarding the flag data, so re-enabling restores them)
    setHighlights(on: boolean): void;
    // A model switch rebuilds the node DOM — re-resolve each flag's element
    // by id and re-apply its highlight. Flags whose id no longer exists in
    // the new model keep their data but lose the board highlight.
    reattach(): void;
    buildReport(kind: FlagKind): string;
}

export interface FlagsModeDeps {
    isPicking(): boolean;
    togglePicking(): void;
    refreshReports(): void;
}

export function initFlagsMode(deps: FlagsModeDeps): FlagsMode {
    // Manual flag lists. Each flag keeps the element reference so its
    // board highlight can be cleared on remove.
    const flagLists: Record<FlagKind, Flag[]> = { ghost: [], mislink: [] };

    function add(kind: FlagKind, el: HTMLElement): void {
        const list = flagLists[kind];
        // de-dupe by element (id may be empty for some candidates)
        if (list.some(f => f.el === el)) return;
        list.push({ ...describeEl(el), note: '' });
        el.classList.add(FLAG_CLASS[kind]);
        render(kind);
    }

    function remove(kind: FlagKind, idx: number): void {
        const [f] = flagLists[kind].splice(idx, 1);
        if (f && f.el) f.el.classList.remove(FLAG_CLASS[kind]);
        render(kind);
    }

    function clear(kind: FlagKind): void {
        flagLists[kind].forEach(f => { if (f.el) f.el.classList.remove(FLAG_CLASS[kind]); });
        flagLists[kind].length = 0;
        render(kind);
    }

    function render(kind: FlagKind): void {
        const list = flagLists[kind];

        // ① card: shows the most recently marked control
        renderPickCard(document.getElementById(`dev-${kind}-target`)!, {
            pickId: `dev-${kind}-pick`,
            pickTitle: kind === 'ghost'
                ? t('Pick controls that do not exist on the device (repeat OK / Esc to finish)')
                : t('Pick controls whose link is wrong (repeat OK / Esc to finish)'),
            info: list.length ? list[list.length - 1]! : null,
            picking: deps.isPicking(),
        });
        document.getElementById(`dev-${kind}-count`)!.textContent = list.length ? ' ' + t('{n} items', { n: String(list.length) }) : '';
        const listEl = document.getElementById(`dev-${kind}-list`)!;
        listEl.innerHTML = '';
        list.forEach((f, i) => {
            const item = document.createElement('div');
            item.className = 'dev-flag-item';
            const head = document.createElement('div');
            head.className = 'dev-flag-head';
            head.innerHTML = `<b>${i + 1}. ${f.elId || '(no id)'}</b>`
                + `<button class="dev-flag-del" data-kind="${kind}" data-i="${i}" title="${t('Remove this mark')}">&#10005;</button>`;
            const meta = document.createElement('div');
            meta.className = 'dev-flag-meta';
            meta.textContent = `node: ${f.nodeId}${f.existing ? ' / ' + f.existing : ' / ' + t('unmapped')}`;
            item.append(head, meta);
            if (kind === 'mislink') {
                const note = document.createElement('input');
                note.className = 'dev-flag-note';
                note.placeholder = t('What should it be? (note)');
                note.value = f.note;
                note.addEventListener('input', () => { f.note = note.value; deps.refreshReports(); });
                item.appendChild(note);
            }
            listEl.appendChild(item);
        });

        deps.refreshReports(); // ③ REPORT column follows every change live
    }

    function renderAll(): void {
        render('ghost');
        render('mislink');
    }

    function setHighlights(on: boolean): void {
        (Object.entries(flagLists) as [FlagKind, Flag[]][]).forEach(([kind, list]) => {
            list.forEach(f => { if (f.el) f.el.classList.toggle(FLAG_CLASS[kind], on); });
        });
    }

    function reattach(): void {
        (Object.entries(flagLists) as [FlagKind, Flag[]][]).forEach(([kind, list]) => {
            list.forEach(f => {
                f.el = f.elId ? document.getElementById(f.elId) : null;
                if (f.el) f.el.classList.add(FLAG_CLASS[kind]);
            });
            render(kind);
        });
    }

    // GHOST / MISLINK reports: a flat markdown list of the user-flagged
    // controls, formatted as a self-contained fix request.
    function buildReport(kind: FlagKind): string {
        const list = flagLists[kind];
        return buildMarkdownReport({
            title: kind === 'ghost'
                ? '# URX Signal Path Visualizer — phantom-control report (DEVELOPER TOOL / GHOST)'
                : '# URX Signal Path Visualizer — wrong-link report (DEVELOPER TOOL / MISLINK)',
            intro: kind === 'ghost'
                ? ['The controls below are shown in the UI but do not exist on the real',
                   'device. Consider removing them from src/ui/ui-builder.ts and src/data/device-map.ts.']
                : ['The controls below have a wrong mapping / link — see each item\'s note.',
                   'Fix src/data/device-map.ts or src/ui/ui-builder.ts accordingly.'],
            model: (document.getElementById('model-select') as HTMLSelectElement).value,
            emptyMessage: '(no marks)',
            sections: list.map((f, i) => {
                const lines = [`## ${i + 1}. Element \`${f.elId || '(no id)'}\` (node: ${f.nodeId})`];
                lines.push(`- DOM: ${f.desc}`);
                lines.push(`- Existing mapping: ${f.existing || 'none (UI only)'}`);
                if (kind === 'mislink') lines.push(`- Note: ${f.note || '(empty)'}`);
                return lines.join('\n');
            }),
        });
    }

    // ---------------------------------------------------------------
    // Wiring: per-kind list deletes, Pick in the re-rendered target card
    // (delegated on the card container) and the Clear All buttons
    // ---------------------------------------------------------------

    (['ghost', 'mislink'] as const).forEach(kind => {
        document.getElementById(`dev-${kind}-list`)!.addEventListener('click', (e) => {
            const del = (e.target as HTMLElement).closest<HTMLElement>('.dev-flag-del');
            if (del) remove(kind, Number(del.dataset.i));
        });
        document.getElementById(`dev-${kind}-target`)!.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest(`#dev-${kind}-pick`)) deps.togglePicking();
        });
        document.getElementById(`dev-${kind}-clear`)!.addEventListener('click', () => clear(kind));
    });

    return { add, renderAll, setHighlights, reattach, buildReport };
}

// Shared report plumbing for the developer tool: one parameterized
// markdown-report head builder (CAPTURE / GHOST / MISLINK all share the
// same shape) and the Copy / Download wiring that used to be copy-pasted
// per mode.

// Self-contained fix-request head: title, intro paragraph, model/date
// line. `sections` are the per-item markdown blocks; an empty list falls
// back to `emptyMessage`.
export function buildMarkdownReport(opts: {
    title: string;
    intro: string[];
    model: string;
    emptyMessage: string;
    sections: string[];
}): string {
    const head = [
        opts.title,
        '',
        ...opts.intro,
        '',
        `- Model: ${opts.model} / captured at: ${new Date().toLocaleString()}`,
        '',
    ].join('\n');
    if (!opts.sections.length) return head + opts.emptyMessage + '\n';
    return head + opts.sections.join('\n\n') + '\n';
}

// Shared clipboard copy with a transient "Copied!" on the button
// (navigator.clipboard, with a file:// execCommand fallback)
export function copyToClipboard(text: string, btn: HTMLElement): void {
    const label = btn.textContent;
    const done = () => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = label; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done);
    } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
    }
}

// Text file download (report exports)
function downloadText(filename: string, text: string): void {
    const blob = new Blob([text], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// Live report previews (③ REPORT columns): regenerated on every data
// change — no "build report" button. Scroll position is kept so the
// preview doesn't jump while notifications stream in.
export function setReportText(el: HTMLTextAreaElement, text: string): void {
    if (el.value === text) return;
    const st = el.scrollTop;
    el.value = text;
    el.scrollTop = st;
}

// One Copy + Download button pair per REPORT column, all wired the same
// way: copy the textarea, or download it as urx-dev-<slug>-report-<date>.md
export function wireReportButtons(copyBtnId: string, dlBtnId: string, textareaId: string, fileSlug: string): void {
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
    const stamp = () => new Date().toISOString().slice(0, 10);
    document.getElementById(copyBtnId)!.addEventListener('click', (e) =>
        copyToClipboard(textarea.value, e.currentTarget as HTMLElement));
    document.getElementById(dlBtnId)!.addEventListener('click', () =>
        downloadText(`urx-dev-${fileSlug}-report-${stamp()}.md`, textarea.value));
}

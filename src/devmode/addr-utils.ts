// Shared VD-address helpers for the developer tool: numeric sorting and
// the n-m range collapsing used by the CONSOLE lists and reports.

// numeric sort on the ":"-separated address parts
export function addrCompare(a: string, b: string): number {
    const pa = a.split(':').map(Number);
    const pb = b.split(':').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

// "139:0:0,139:0:1,139:0:2" -> "139:0:0-2": group on everything but
// the last part, then collapse consecutive last-part values
export function collapseRanges(addrs: string[]): string[] {
    const groups = new Map<string, number[]>();
    addrs.forEach(a => {
        const parts = a.split(':');
        const last = Number(parts.pop());
        const prefix = parts.join(':');
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix)!.push(last);
    });
    const lines: string[] = [];
    [...groups.keys()].sort(addrCompare).forEach(prefix => {
        const vals = groups.get(prefix)!.sort((a, b) => a - b);
        let start = vals[0]!;
        let prev = vals[0]!;
        for (let i = 1; i <= vals.length; i++) {
            const v = vals[i]!;
            if (v === prev + 1) { prev = v; continue; }
            const seg = start === prev ? `${start}` : `${start}-${prev}`;
            lines.push(prefix ? `${prefix}:${seg}` : seg);
            start = prev = v;
        }
    });
    return lines;
}

// Collapsed one-line-per-range listing, "parameters" first then "meters"
export function subsListText(params: string[], meters: string[]): string {
    return [
        ...collapseRanges(params).map(l => `parameters ${l}`),
        ...collapseRanges(meters).map(l => `meters ${l}`),
    ].join('\n');
}

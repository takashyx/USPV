// Single source of truth for the app version is package.json "version".
// This script stamps that number into every other place it is shown —
// the app UI (index.html) and the human-facing docs — so a release only
// needs one edit: bump package.json (e.g. `npm version 0.3.0
// --no-git-tag-version`), then run `npm run sync-version` (also run
// automatically as part of `npm run build`).
//
// It must tolerate two repo layouts, because it also runs in CI on the
// public mirror (takashyx/USPV) that `copy_to_uspv` produces: there
// README.md is the public readme (README_USPV.md renamed) and the
// internal README.md / REQUIREMENTS.md are absent. So every file and
// every pattern is optional — a missing file or a non-matching pattern
// is skipped, not an error. A file that exists but matches nothing is a
// warning (possible drift), never a hard failure.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const V = String.raw`\d+\.\d+\.\d+`; // matches the current x.y.z, whatever it is

// Version markers, each with two capture groups wrapping the number so the
// `$1<version>$2` replacement is unambiguous. Not every marker appears in
// every file; each file is scanned for all markers and the ones that match
// are replaced.
const TITLE = new RegExp(`(<title>URX Signal Path Visualizer v)${V}(</title>)`);
const SPAN = new RegExp(`(<span class="app-version">v)${V}(</span>)`);
const GENKOU = new RegExp(`(\\*\\*現行バージョン: v)${V}(\\*\\*)`);
const BETA = new RegExp(`(\\*\\*v)${V}( \\(beta\\)\\*\\*)`);

const targets = [
    { file: 'index.html', patterns: [TITLE, SPAN] },
    // README.md is the internal readme here and the public one on the USPV
    // mirror; README_USPV.md is the public source here and absent on the
    // mirror. Give both files both readme markers and let matching decide.
    { file: 'README.md', patterns: [GENKOU, BETA] },
    { file: 'README_USPV.md', patterns: [GENKOU, BETA] },
];

let changed = 0;
for (const { file, patterns } of targets) {
    const path = join(root, file);
    if (!existsSync(path)) continue; // layout without this file (e.g. USPV mirror)

    const before = readFileSync(path, 'utf8');
    let after = before;
    let matched = 0;
    for (const pattern of patterns) {
        if (!pattern.test(after)) continue; // marker not present in this file
        matched++;
        after = after.replace(pattern, `$1${version}$2`);
    }
    if (!matched) {
        console.warn(`WARNING: no version marker found in ${file} (skipped)`);
        continue;
    }
    if (after !== before) {
        writeFileSync(path, after);
        console.log(`updated ${file} -> v${version}`);
        changed++;
    }
}

console.log(changed ? `Synced ${changed} file(s) to v${version}.` : `Already at v${version}.`);

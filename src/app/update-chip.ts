// Update chip in the app title bar. The update check itself lives in the
// Electron main process (electron/main.cjs); it pushes state here through
// the preload bridge (electron/preload.cjs). That bridge does not exist
// when the page runs over file:// in a browser, so there the chip stays
// hidden and this module does nothing.
//
// Two states, matching what the main process can actually offer:
//   available  — a newer release exists. Click opens the releases page.
//                This is the only notification on macOS, where the unsigned
//                app cannot install updates in place.
//   downloaded — Windows only: the installer is already in the update cache
//                and will run on quit. Click restarts and applies it now.

import { setTooltip } from './i18n';
import { adjustSectionPadding } from './layout';

interface UpdateInfo {
    version: string;
    state: 'available' | 'downloaded';
}

interface UpdateBridge {
    subscribe(cb: (info: UpdateInfo) => void): void;
    openReleasesPage(): void;
    restartAndInstall(): void;
}

declare global {
    interface Window {
        uspvUpdate?: UpdateBridge;
    }
}

export function initUpdateChip(): void {
    const bridge = window.uspvUpdate;
    if (!bridge) return; // browser (or an older shell): no updater, no chip

    const chip = document.getElementById('update-chip') as HTMLButtonElement;
    let current: UpdateInfo | null = null;

    function render(info: UpdateInfo): void {
        current = info;
        const ready = info.state === 'downloaded';
        chip.textContent = ready ? `Update v${info.version} ready` : `Update v${info.version}`;
        chip.classList.toggle('ready', ready);
        setTooltip(chip, ready
            ? 'Update downloaded — click to restart and apply it now'
            : 'A new version is available — click to open the download page');
        chip.hidden = false;
        // The chip can push the title onto a second line, which changes the
        // header height the column layout is padded against.
        adjustSectionPadding();
    }

    chip.addEventListener('click', () => {
        if (!current) return;
        if (current.state === 'downloaded') bridge.restartAndInstall();
        else bridge.openReleasesPage();
    });

    bridge.subscribe(render);
}

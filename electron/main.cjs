// Electron main process. The renderer is the exact same static app that
// runs over file:// in a browser (index.html + dist/bundle.js), so this
// file only creates a window, loads it and checks for updates — no
// preload, no IPC. Downloads (config export, dev reports) and
// <input type=file> are handled by Chromium's built-in dialogs.
const { app, BrowserWindow, dialog, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const RELEASES_URL = 'https://github.com/takashyx/USPV/releases/latest';

// Check github.com/takashyx/USPV releases on launch (feed configured via
// "publish" in package.json, embedded as app-update.yml when packaged).
// Windows (NSIS) supports in-place updates: download in the background and
// prompt to restart. The macOS app is not code-signed, so electron-updater
// cannot install updates there — notify and link to the releases page
// instead. Skipped in development (unpackaged) runs; network/rate-limit
// errors stay silent so an offline launch never bothers the user.
function setupAutoUpdate() {
    if (!app.isPackaged) return;
    const { autoUpdater } = require('electron-updater');
    const canInstall = process.platform === 'win32';
    autoUpdater.autoDownload = canInstall;
    autoUpdater.on('error', () => {});

    autoUpdater.on('update-available', async (info) => {
        if (canInstall) return; // Windows: wait for update-downloaded instead
        const { response } = await dialog.showMessageBox({
            type: 'info',
            message: `A new version v${info.version} is available.`,
            detail: 'Open the download page to get the latest version?',
            buttons: ['Open Download Page', 'Later'],
            cancelId: 1,
        });
        if (response === 0) shell.openExternal(RELEASES_URL);
    });

    autoUpdater.on('update-downloaded', async (info) => {
        const { response } = await dialog.showMessageBox({
            type: 'info',
            message: `Update v${info.version} has been downloaded.`,
            detail: 'Restart now to apply it? Otherwise it will be applied the next time the app quits.',
            buttons: ['Restart Now', 'Later'],
            cancelId: 1,
        });
        if (response === 0) autoUpdater.quitAndInstall();
    });

    autoUpdater.checkForUpdates().catch(() => {});
}

// Window size/position persistence: bounds and maximized state are saved
// to window-state.json in userData and restored on the next launch. The
// saved position is discarded if it no longer intersects any display
// (e.g. a monitor was unplugged) so the window can't come back off-screen.
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        const state = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
        if (typeof state.width !== 'number' || typeof state.height !== 'number') return null;
        const visible = typeof state.x === 'number' && typeof state.y === 'number' &&
            screen.getAllDisplays().some(({ workArea: a }) =>
                state.x < a.x + a.width && state.x + state.width > a.x &&
                state.y < a.y + a.height && state.y + state.height > a.y);
        if (!visible) { delete state.x; delete state.y; }
        return state;
    } catch {
        return null; // first launch or corrupt file: fall back to defaults
    }
}

function trackWindowState(win) {
    let bounds = win.getBounds();
    const save = () => {
        // Keep the last normal bounds so un-maximizing after a restart
        // returns to the previous size, not the maximized one.
        if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
            bounds = win.getBounds();
        }
        try {
            fs.writeFileSync(windowStateFile(),
                JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
        } catch {}
    };
    let timer = null;
    const debouncedSave = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 300);
    };
    win.on('resize', debouncedSave);
    win.on('move', debouncedSave);
    win.on('maximize', debouncedSave);
    win.on('unmaximize', debouncedSave);
    win.on('close', () => { clearTimeout(timer); save(); });
}

function createWindow() {
    const state = loadWindowState();
    const win = new BrowserWindow({
        width: state?.width ?? 1600,
        height: state?.height ?? 900,
        x: state?.x,
        y: state?.y,
        minWidth: 1200,
        minHeight: 700,
        // Renderer stays on Electron's secure defaults: no nodeIntegration,
        // contextIsolation on. The app never needs Node APIs.
    });
    if (state?.maximized) win.maximize();
    trackWindowState(win);
    win.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
    createWindow();
    setupAutoUpdate();

    // macOS: re-create the window when the Dock icon is clicked and no
    // window is open.
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed, except on macOS where apps stay
// active until the user quits explicitly.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

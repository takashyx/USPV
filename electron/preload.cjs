// The only bridge between the main process and the renderer. The renderer is
// otherwise the exact same static page that runs over file:// in a browser,
// so nothing exposed here may be required for the app to work: the update
// chip is the one feature that needs main-process knowledge, and it simply
// never appears when window.uspvUpdate is absent (i.e. in a browser).
//
// contextIsolation stays on — the renderer sees this object only, never
// ipcRenderer or any Node built-in.
const { contextBridge, ipcRenderer } = require('electron');

const STATE_CHANNEL = 'uspv:update-state';

contextBridge.exposeInMainWorld('uspvUpdate', {
    // cb({ version, state }) with state 'available' | 'downloaded'; called
    // again whenever the state advances. The update check can finish before
    // dist/bundle.js has run, so subscribing also asks the main process to
    // replay the current state (it sends nothing if there is none).
    subscribe(cb) {
        ipcRenderer.on(STATE_CHANNEL, (_event, state) => cb(state));
        ipcRenderer.send('uspv:update-state-request');
    },
    openReleasesPage() { ipcRenderer.send('uspv:open-releases'); },
    restartAndInstall() { ipcRenderer.send('uspv:restart-and-install'); },
});

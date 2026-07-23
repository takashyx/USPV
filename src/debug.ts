// The ONE deliberate window global: a debugging namespace for DevTools.
// The app itself never reads window.urx — modules import each other
// directly — but a console session can inspect state and trigger redraws:
//
//   urx.drawLines()                    force a full redraw
//   urx.state.activeNodeId             current focus selection
//   urx.patches                        live patch map
//   urx.deviceSync.isConnected()       Device Center connection state
//   urx.ConfigStore.exportText()       current settings blob

import { appState } from './app/app-state';
import { switchModel } from './app/model-switch';
import { debouncedDrawLines } from './broker/redraw';
import { deviceSync } from './broker/socket';
import { ConfigStore } from './config/config-store';
import { connections, currentPatches } from './data/topology';
import { updateHighlights } from './view/highlight';
import { drawLines, suppressChangeEffects } from './view/render';
import { viewState } from './view/view-state';

export function installDebugNamespace(): void {
    (window as any).urx = {
        drawLines,
        debouncedDrawLines,
        updateHighlights,
        suppressChangeEffects,
        switchModel,
        deviceSync,
        ConfigStore,
        state: viewState,
        appState,
        patches: currentPatches,
        connections,
    };
}

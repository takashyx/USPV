// Model switch orchestration: every model-switch path (dropdown, device
// detection, demo) funnels through switchModel — the one place that owns
// the order-critical rebuild pipeline
//   buildAll -> wrapSectionBodies -> sizeFixedColumns/adjustSectionPadding
//   -> initConnections -> reinitBroker (assignDynamicIds ->
//   initializeSvgPaths -> drawLines) -> urx:model-switched.

import { connectToDevice, reinitBroker } from '../broker/socket';
import { ConfigStore } from '../config/config-store';
import { initConnections } from '../data/topology';
import { EVENT_MODEL_SWITCHED } from '../shared/constants';
import { UIBuilder } from '../ui/ui-builder';
import { suppressChangeEffects } from '../view/render';
import { wrapSectionBodies } from './bootstrap';
import { adjustSectionPadding, sizeFixedColumns } from './layout';

// Switch model layout and rebuild everything.
export function switchModel(modelId: string): void {
    // Every model-switch path funnels through here — the one save point
    // for the model setting
    ConfigStore.set('model', modelId);

    // Rebuilding the DOM resets every control, flipping many connection
    // states at once — snap without per-line effects
    suppressChangeEffects(1500);

    UIBuilder.setModel(modelId);
    UIBuilder.buildAll();
    wrapSectionBodies();
    sizeFixedColumns();
    adjustSectionPadding();

    // Reinitialize connections, then broker endpoints mapping & svg paths
    initConnections(modelId);
    reinitBroker();

    // Post-rebuild hook for other modules (demo mode reapplies its baseline)
    document.dispatchEvent(new CustomEvent(EVENT_MODEL_SWITCHED));
}

export function initModelSwitch(): void {
    // Hook model selection dropdown change
    document.getElementById('model-select')!.addEventListener('change', (e) => {
        const select = e.target as HTMLSelectElement;
        const selectedOpt = select.options[select.selectedIndex]!;
        const uid = selectedOpt.dataset.uid;

        if (uid) {
            connectToDevice(uid, select.value);
        } else {
            switchModel(select.value);
        }
    });
}

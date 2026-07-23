// First DOM build: restores the saved model, generates the node DOM and
// wraps each section's content in a .section-body — the exact top-level
// work js/app.js used to run at script-eval time.

import { ConfigStore } from '../config/config-store';
import { initConnections } from '../data/topology';
import { MODEL_IDS } from '../shared/constants';
import { UIBuilder } from '../ui/ui-builder';
import { updateFade } from './layout';

// Wrap non-h2 children of each .section in a .section-body for proper
// scroll/fade scoping. Re-run after every UIBuilder.buildAll().
export function wrapSectionBodies(): void {
    document.querySelectorAll('.section').forEach(sec => {
        const existingBody = sec.querySelector('.section-body');
        if (existingBody) {
            existingBody.remove();
        }
        const h2 = sec.querySelector('h2');
        const children = Array.from(sec.childNodes).filter(n => n !== h2);
        const body = document.createElement('div');
        body.className = 'section-body';
        children.forEach(c => body.appendChild(c));
        sec.appendChild(body);
        updateFade(body);
    });
}

// Restore the saved model before the first DOM build. main.ts already ran
// initConnections with the default model, so re-derive the connection list
// when the saved model differs.
export function initAppDom(): void {
    const savedModel = ConfigStore.get('model');
    if (MODEL_IDS.includes(savedModel) && savedModel !== UIBuilder.getModel()) {
        UIBuilder.setModel(savedModel);
        initConnections(savedModel);
    }
    (document.getElementById('model-select') as HTMLSelectElement).value = UIBuilder.getModel();

    // Generate node DOM before the broker initializes
    UIBuilder.buildAll();
    wrapSectionBodies();
}

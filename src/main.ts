// Entry point. Bundled by esbuild into dist/bundle.js (committed, so the
// app keeps launching over file:// with no build step at runtime).
//
// Init order mirrors the historical classic-script load order and the
// top-to-bottom statement order inside the old js/app.js exactly:
// config store first (everything else reads stored values during init),
// then the default topology build, then the app-shell wiring blocks in
// their original file order, then broker / demo / devmode.

import { initConfigStore } from './config/config-store';
import { initConnections } from './data/topology';
import { initMeterTaps } from './data/meter-taps';
import { initAppDom } from './app/bootstrap';
import { initModelSwitch } from './app/model-switch';
import { initSelection } from './app/selection';
import { initConfigButtons, initFontSize, initHeaderHamburger, initHeaderToggles, initScrollToChangeToggle } from './app/header';
import { initI18n } from './app/i18n';
import { initUpdateChip } from './app/update-chip';
import { initDawToggles } from './app/daw-toggle';
import { initCollapse } from './app/collapse';
import { finalizeInitialLayout, initLayoutListeners } from './app/layout';
import { initBroker } from './broker/socket';
import { initDemo } from './demo/demo';
import { initDevmode } from './devmode/devmode';
import { installDebugNamespace } from './debug';

initConfigStore();          // js/config-store.js
initConnections('URX44V');  // js/connections-data.js eval-time default build

// js/app.js top-level blocks, in original order:
initAppDom();               // model restore + buildAll + wrapSectionBodies
initMeterTaps();            // restore meter tap selection (before broker subscribes)
initModelSwitch();          // switchModel + model-select listener
initSelection();            // node click / background / ESC
initHeaderToggles();        // scroll-to-selection, hide-muted, focus x3
initDawToggles();           // DAW visibility restore + toggle animation
initCollapse();             // collapse view restore + buttons
initScrollToChangeToggle();
initFontSize();
initHeaderHamburger();
initConfigButtons();
initI18n();                 // EN/JA toggle; translates the built DOM's tooltips
initUpdateChip();           // title-bar update chip (Electron only; after initI18n so its tooltip is translated)
initLayoutListeners();      // resize + scroll (capture) listeners
finalizeInitialLayout();    // adjustSectionPadding now + once more at +200ms

initBroker();               // js/broker.js (real init on DOMContentLoaded)
initDemo();                 // js/demo.js (auto-start after broker's init)
initDevmode();              // js/devmode.js (panel injection + wiring, last)

// Deliberate debugging surface — the only window global the app installs.
installDebugNamespace();

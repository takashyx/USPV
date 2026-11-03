"use strict";
(() => {
  // src/config/config-store.ts
  var KEY = "uspv.config.v1";
  var SAVE_DEBOUNCE_MS = 300;
  var DEFAULTS = {
    model: "URX44V",
    demoMode: false,
    language: "en",
    fontSize: 1,
    headerCollapsed: true,
    scrollToSelection: true,
    scrollToChange: true,
    hideMuted: true,
    focusNodesPathOnly: true,
    focusEffectsPathOnly: true,
    focusScrollPathOnly: true,
    dawVisible: { "col-physical-inputs": true, "col-physical": true },
    collapsedNodes: [],
    meterTaps: {},
    showUnmapped: false,
    devMode: false,
    devLogRx: true,
    devLogTx: true,
    devLogMeters: false,
    devLogWrap: false,
    autoConnect: false
  };
  function createConfigStore(backend, legacyRead) {
    function importLegacyKeys() {
      const settings = {};
      if (!legacyRead) return settings;
      try {
        if (legacyRead("dev_mode") !== null) {
          settings.devMode = legacyRead("dev_mode") === "true";
        }
        if (legacyRead("sync_auto_connect") !== null) {
          settings.autoConnect = legacyRead("sync_auto_connect") === "true";
        }
      } catch (e) {
      }
      return settings;
    }
    let data = backend.read();
    if (!data || typeof data !== "object" || data.version !== 1) {
      data = { version: 1, settings: importLegacyKeys() };
    }
    if (!data.settings || typeof data.settings !== "object") data.settings = {};
    let saveTimer = null;
    function flush() {
      if (saveTimer === null) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      backend.write(data);
    }
    function scheduleSave() {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }
    function fillDefaults() {
      let filled = false;
      Object.keys(DEFAULTS).forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(data.settings, k)) return;
        const v = DEFAULTS[k];
        data.settings[k] = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
        filled = true;
      });
      return filled;
    }
    if (fillDefaults()) scheduleSave();
    const EXPORT_KEY_ORDER = Object.keys(DEFAULTS);
    function exportText() {
      const ordered = {};
      EXPORT_KEY_ORDER.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(data.settings, k)) ordered[k] = data.settings[k];
      });
      Object.keys(data.settings).forEach((k) => {
        if (!(k in ordered)) ordered[k] = data.settings[k];
      });
      return JSON.stringify({
        format: "uspv-config",
        version: data.version,
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        settings: ordered
      }, null, 2) + "\n";
    }
    function importText(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new Error("Could not parse as JSON: " + e.message);
      }
      if (!parsed || parsed.format !== "uspv-config") {
        throw new Error("Not a uspv settings file (format mismatch)");
      }
      if (parsed.version !== 1) {
        throw new Error("Unsupported settings version: " + parsed.version);
      }
      if (!parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings)) {
        throw new Error("Missing settings object");
      }
      data = { version: 1, settings: parsed.settings };
      fillDefaults();
      scheduleSave();
      flush();
    }
    return {
      get(key, fallback) {
        return Object.prototype.hasOwnProperty.call(data.settings, key) ? data.settings[key] : fallback;
      },
      set(key, value) {
        data.settings[key] = value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;
        scheduleSave();
      },
      flush,
      exportText,
      importText
    };
  }
  var instance = null;
  function initConfigStore() {
    if (instance) return;
    const backend = {
      read() {
        try {
          return JSON.parse(localStorage.getItem(KEY));
        } catch (e) {
          return null;
        }
      },
      write(obj) {
        try {
          localStorage.setItem(KEY, JSON.stringify(obj));
        } catch (e) {
        }
      }
    };
    const legacyRead = (key) => {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    };
    instance = createConfigStore(backend, legacyRead);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") instance.flush();
    });
    window.addEventListener("pagehide", () => instance.flush());
  }
  var ConfigStore = {
    get: (key, fallback) => instance.get(key, fallback),
    set: (key, value) => instance.set(key, value),
    flush: () => instance.flush(),
    exportText: () => instance.exportText(),
    importText: (text) => instance.importText(text)
  };

  // src/shared/constants.ts
  var MODEL_IDS = ["URX44V", "URX44", "URX22"];
  var INPUT_CHANNEL_IDS = ["in-ch1", "in-ch2", "in-ch34", "in-ch56", "in-ch78", "in-ch910"];
  var MIX_FX_BUSES = ["bus-mix1", "bus-mix2", "bus-fx1", "bus-fx2"];
  var SELECTABLE_SOURCES = ["bus-stream", "bus-mix1", "bus-mix2", "bus-stereo", "bus-mon1", "bus-mon2"];
  var ptOut = (nodeId) => `pt-${nodeId}-out`;
  var ptIn = (nodeId) => `pt-${nodeId}-in`;
  var EVENT_MODEL_SWITCHED = "urx:model-switched";

  // src/data/topology.ts
  var currentPatches = {
    "out-main": "bus-mix1",
    "out-usba": "bus-stream",
    "out-usbb": "bus-mix1",
    "out-usbc": "in-ch1",
    "out-usbsub": "in-ch1",
    "bus-stream": "bus-mix1",
    "bus-mon1": "bus-mix1",
    "bus-mon2": "bus-mix2",
    "in-ch1": "in-port-mic1",
    "in-ch2": "in-port-mic2",
    "in-ch34": "in-port-aux",
    "in-ch56": "in-port-usba",
    "in-ch78": "in-port-usbb",
    "in-ch910": "in-port-usbsub"
  };
  var connections = [];
  function initConnections(model) {
    const conns = connections;
    conns.length = 0;
    const link = (fromNode, toNode) => ({
      from: ptOut(fromNode),
      fromNode,
      to: ptIn(toNode),
      toNode
    });
    ["bus-stereo", ...MIX_FX_BUSES].forEach((bus) => conns.push(link("bus-osc", bus)));
    ["bus-stereo", ...MIX_FX_BUSES].forEach((bus) => {
      INPUT_CHANNEL_IDS.forEach((ch) => conns.push(link(ch, bus)));
    });
    const dawSources = [
      "in-ch1",
      "in-ch2",
      "in-ch34",
      "in-ch34",
      "in-ch56",
      "in-ch56",
      "in-ch78",
      "in-ch78",
      "in-ch910",
      "in-ch910"
    ];
    dawSources.forEach((ch, i) => conns.push(link(ch, `out-daw${i + 1}`)));
    if (model !== "URX22") {
      conns.push(link("in-ch910", "out-daw11"));
      conns.push(link("in-ch910", "out-daw12"));
    }
    ["bus-fx1", "bus-fx2"].forEach((fx) => {
      conns.push(link(fx, "bus-mix1"));
      conns.push(link(fx, "bus-mix2"));
    });
    conns.push(link("bus-fx1", "bus-stereo"));
    conns.push(link("bus-fx2", "bus-stereo"));
    conns.push(link("bus-mix1", "bus-stereo"));
    conns.push(link("bus-mix2", "bus-stereo"));
    ["bus-stream", "bus-mon1", "bus-mon2"].forEach((dest) => {
      ["bus-mix1", "bus-mix2", "bus-stereo"].forEach((src) => conns.push(link(src, dest)));
    });
    ["out-usba", "out-usbb", "out-usbc", "out-usbsub"].forEach((usb) => {
      [...SELECTABLE_SOURCES, ...INPUT_CHANNEL_IDS].forEach((src) => conns.push(link(src, usb)));
    });
    SELECTABLE_SOURCES.forEach((src) => conns.push(link(src, "out-main")));
    conns.push(link("bus-mon1", "out-ph1"));
    conns.push(link("bus-mon2", "out-ph2"));
    const physicalInputNodeIds = ["in-port-mic1", "in-port-mic2"];
    if (model !== "URX22") {
      physicalInputNodeIds.push("in-port-mic3", "in-port-mic4");
    }
    physicalInputNodeIds.push(
      "in-port-aux",
      "in-port-usba",
      "in-port-usbb",
      "in-port-usbc",
      "in-port-daw12",
      "in-port-daw34",
      "in-port-daw56",
      "in-port-daw78",
      "in-port-daw910"
    );
    if (model !== "URX22") {
      physicalInputNodeIds.push("in-port-daw1112");
    }
    physicalInputNodeIds.push("in-port-usbsub");
    if (model !== "URX22") {
      physicalInputNodeIds.push("in-port-sdplay");
    }
    if (model === "URX44V") {
      physicalInputNodeIds.push("in-port-hdmi");
    }
    INPUT_CHANNEL_IDS.forEach((chId) => {
      physicalInputNodeIds.forEach((portId) => conns.push(link(portId, chId)));
    });
  }

  // src/app/i18n.ts
  var EVENT_LANG_CHANGED = "urx:lang-changed";
  var JA = {
    // Header toggles / buttons (index.html)
    "Auto-scroll to the active nodes when the flow selection changes": "\u30D5\u30ED\u30FC\u8868\u793A\u5207\u66FF\u6642\u306B\u30A2\u30AF\u30C6\u30A3\u30D6\u30CE\u30FC\u30C9\u306E\u4F4D\u7F6E\u3078\u81EA\u52D5\u30B9\u30AF\u30ED\u30FC\u30EB",
    "Auto-scroll to a node when its connection state or parameters change": "\u7D50\u7DDA\u72B6\u614B\u3084\u30D1\u30E9\u30E1\u30FC\u30BF\u306E\u5909\u5316\u6642\u306B\u305D\u306E\u30CE\u30FC\u30C9\u3078\u81EA\u52D5\u30B9\u30AF\u30ED\u30FC\u30EB",
    "Hide muted connection lines": "\u30DF\u30E5\u30FC\u30C8\u4E2D\uFF08muted\uFF09\u306E\u7D50\u7DDA\u3092\u975E\u8868\u793A\u306B\u3057\u307E\u3059",
    // Routing-line legend beside the title (index.html #line-legend)
    "Moving dashes: an enabled signal path (not a level meter). The color follows the source node.": "\u52D5\u304F\u7834\u7DDA: \u6709\u52B9\u306A\u4FE1\u53F7\u7D4C\u8DEF\uFF08\u97F3\u58F0\u30EC\u30D9\u30EB\u306E\u8868\u793A\u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF09\u3002\u8272\u306F\u9001\u4FE1\u5143\u30CE\u30FC\u30C9\u306B\u5BFE\u5FDC\u3057\u307E\u3059",
    "Still dark dashes: a path muted by a channel, send or level setting. Hidden in the diagram while Hide Muted is on.": "\u9759\u6B62\u3057\u305F\u6697\u3044\u7834\u7DDA: \u30C1\u30E3\u30F3\u30CD\u30EB\u30FB\u30BB\u30F3\u30C9\u30FB\u30EC\u30D9\u30EB\u8A2D\u5B9A\u3067\u30DF\u30E5\u30FC\u30C8\u3055\u308C\u305F\u7D4C\u8DEF\u3002Hide Muted \u304C ON \u306E\u9593\u306F\u56F3\u4E2D\u3067\u306F\u975E\u8868\u793A\u306B\u306A\u308A\u307E\u3059",
    "In FOCUS VIEW, hide off-path nodes entirely (OFF dims them instead)": "FOCUS VIEW\u4E2D\u3001\u30D1\u30B9\u5916\u306E\u30CE\u30FC\u30C9\u3092\u975E\u8868\u793A\u306B\u3059\u308B\uFF08OFF\u3067\u306F\u6E1B\u5149\u8868\u793A\uFF09",
    "In FOCUS VIEW, suppress wipe/blink effects for off-path changes (disconnections from and new connections to the path are still shown)": "FOCUS VIEW\u4E2D\u3001\u30D1\u30B9\u5916\u306E\u5909\u5316\u306E\u30EF\u30A4\u30D7/\u30D6\u30EA\u30F3\u30AF\u3092\u6291\u5236\u3059\u308B\uFF08\u30D1\u30B9\u306E\u5207\u65AD\u30FB\u30D1\u30B9\u3078\u306E\u65B0\u898F\u63A5\u7D9A\u306F\u5BFE\u8C61\u5916\uFF09",
    "In FOCUS VIEW, suppress Scroll to Change for off-path changes": "FOCUS VIEW\u4E2D\u3001\u30D1\u30B9\u5916\u306E\u5909\u5316\u3078\u306E Scroll to Change \u3092\u6291\u5236\u3059\u308B",
    "Collapse every section (title + horizontal meter only)": "\u5168\u30BB\u30AF\u30B7\u30E7\u30F3\u3092\u6298\u308A\u305F\u305F\u307F\u8868\u793A\uFF08\u30BF\u30A4\u30C8\u30EB\uFF0B\u6A2A\u5411\u304D\u30E1\u30FC\u30BF\u30FC\u306E\u307F\uFF09\u306B\u3059\u308B",
    "Restore every section to the normal full view": "\u5168\u30BB\u30AF\u30B7\u30E7\u30F3\u3092\u901A\u5E38\u306E\u30D5\u30EB\u8868\u793A\u306B\u623B\u3059",
    "Export the current settings (model, toggles, collapse states, ...) as a JSON file": "\u73FE\u5728\u306E\u8A2D\u5B9A\uFF08\u30E2\u30C7\u30EB\u30FB\u30C8\u30B0\u30EB\u30FB\u6298\u308A\u305F\u305F\u307F\u72B6\u614B\u7B49\uFF09\u3092JSON\u30D5\u30A1\u30A4\u30EB\u3068\u3057\u3066\u66F8\u304D\u51FA\u3059",
    "Load and apply a settings JSON file (reloads the page)": "\u8A2D\u5B9AJSON\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u9069\u7528\u3059\u308B\uFF08\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u307E\u3059\uFF09",
    "Decrease the overall font size by one step (5 steps)": "\u5168\u4F53\u306E\u6587\u5B57\u30B5\u30A4\u30BA\u30921\u6BB5\u968E\u5C0F\u3055\u304F\uFF085\u6BB5\u968E\uFF09",
    "Increase the overall font size by one step (5 steps)": "\u5168\u4F53\u306E\u6587\u5B57\u30B5\u30A4\u30BA\u30921\u6BB5\u968E\u5927\u304D\u304F\uFF085\u6BB5\u968E\uFF09",
    "Model selection": "\u30E2\u30C7\u30EB\u9078\u629E",
    "Device System firmware version (/vd/device)": "\u5B9F\u6A5F\u306E System \u30D5\u30A1\u30FC\u30E0\u30A6\u30A7\u30A2\u30D0\u30FC\u30B8\u30E7\u30F3\uFF08/vd/device\uFF09",
    "Device DSP / USB streaming sample rate (display only)": "\u5B9F\u6A5F\u306E DSP / USB \u30B9\u30C8\u30EA\u30FC\u30DF\u30F3\u30B0\u30B5\u30F3\u30D7\u30EB\u30EC\u30FC\u30C8\uFF08\u8868\u793A\u306E\u307F\uFF09",
    "Demo mode: simulates device behavior without a connection": "\u63A5\u7D9A\u306A\u3057\u3067\u5B9F\u6A5F\u6319\u52D5\u3092\u30B7\u30DF\u30E5\u30EC\u30FC\u30C8\u3059\u308B\u30C7\u30E2\u30E2\u30FC\u30C9",
    "Outline every control that has no device mapping in red (steady; DEV mode shows the same outlines while picking)": "\u30C7\u30D0\u30A4\u30B9\u30DE\u30C3\u30D4\u30F3\u30B0\u3092\u6301\u305F\u306A\u3044\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u8D64\u67A0\u8868\u793A\u3059\u308B\uFF08\u70B9\u6EC5\u306A\u3057\u3002DEV\u30E2\u30FC\u30C9\u3067\u306F\u5BFE\u8C61\u9078\u629E\u4E2D\u306B\u540C\u3058\u8D64\u67A0\u304C\u51FA\u307E\u3059\uFF09",
    "Developer mode: red outlines on unmapped elements, Device Center log, click-to-capture for mapping research": "\u958B\u767A\u8005\u30E2\u30FC\u30C9: \u672A\u30DE\u30C3\u30D4\u30F3\u30B0\u8981\u7D20\u306E\u8D64\u67A0\u8868\u793A\u30FBDevice Center\u30ED\u30B0\u30FB\u30AF\u30EA\u30C3\u30AF\u3067\u30DE\u30C3\u30D4\u30F3\u30B0\u8ABF\u67FB\u30AD\u30E3\u30D7\u30C1\u30E3",
    "Show/hide the header controls": "\u30D8\u30C3\u30C0\u30FC\u306E\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u8868\u793A/\u975E\u8868\u793A",
    "A new version is available \u2014 click to open the download page": "\u65B0\u3057\u3044\u30D0\u30FC\u30B8\u30E7\u30F3\u304C\u3042\u308A\u307E\u3059 \u2014 \u30AF\u30EA\u30C3\u30AF\u3067\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u30DA\u30FC\u30B8\u3092\u958B\u304D\u307E\u3059",
    "Update downloaded \u2014 click to restart and apply it now": "\u30A2\u30C3\u30D7\u30C7\u30FC\u30C8\u306E\u30C0\u30A6\u30F3\u30ED\u30FC\u30C9\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F \u2014 \u30AF\u30EA\u30C3\u30AF\u3067\u518D\u8D77\u52D5\u3057\u3066\u9069\u7528\u3057\u307E\u3059",
    "Switch language": "\u8A00\u8A9E\u5207\u66FF",
    // Sections / nodes (UIBuilder templates, collapse buttons)
    "Collapse all nodes in this section": "\u30BB\u30AF\u30B7\u30E7\u30F3\u5185\u306E\u5168\u30CE\u30FC\u30C9\u3092\u6298\u308A\u305F\u305F\u307F\u8868\u793A\u306B\u3059\u308B",
    "Restore all nodes in this section to full view": "\u30BB\u30AF\u30B7\u30E7\u30F3\u5185\u306E\u5168\u30CE\u30FC\u30C9\u3092\u30D5\u30EB\u8868\u793A\u306B\u623B\u3059",
    "Show/hide the USB DAW nodes": "USB DAW \u30CE\u30FC\u30C9\u306E\u8868\u793A/\u975E\u8868\u793A",
    "Toggle collapsed/full view": "\u6298\u308A\u305F\u305F\u307F\u8868\u793A/\u30D5\u30EB\u8868\u793A\u3092\u5207\u308A\u66FF\u3048",
    "Click or press ESC to clear": "\u30AF\u30EA\u30C3\u30AF\u307E\u305F\u306FESC\u3067\u89E3\u9664",
    // Meter tap chips (static template titles + the dynamic re-writes)
    "Meter tap: INPUT (before all DSP)": "\u30E1\u30FC\u30BF\u30FC\u30BF\u30C3\u30D7: INPUT\uFF08\u5168DSP\u524D\uFF09",
    "Meter tap: POST (output after inserts)": "\u30E1\u30FC\u30BF\u30FC\u30BF\u30C3\u30D7: POST\uFF08\u30A4\u30F3\u30B5\u30FC\u30C8\u5F8C\u306E\u51FA\u529B\uFF09",
    "Meter tap: OUT (output)": "\u30E1\u30FC\u30BF\u30FC\u30BF\u30C3\u30D7: OUT\uFF08\u51FA\u529B\uFF09",
    "Meter tap: {label} (click to cycle: {cycle})": "\u30E1\u30FC\u30BF\u30FC\u30BF\u30C3\u30D7: {label}\uFF08\u30AF\u30EA\u30C3\u30AF\u3067\u5207\u66FF: {cycle}\uFF09",
    "Meter tap: {label}": "\u30E1\u30FC\u30BF\u30FC\u30BF\u30C3\u30D7: {label}",
    // Alerts
    "Could not load the settings file:": "\u8A2D\u5B9A\u30D5\u30A1\u30A4\u30EB\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F:",
    // Devmode panel (static tooltips)
    "Minimize/restore the panel": "\u30D1\u30CD\u30EB\u3092\u6700\u5C0F\u5316/\u5FA9\u5143",
    "Device Center WebSocket RX/TX traffic": "Device Center WebSocket \u306E RX/TX \u30C8\u30E9\u30D5\u30A3\u30C3\u30AF",
    "Device Center subscriptions and manual subscribe": "Device Center \u3078\u306E\u8CFC\u8AAD\u72B6\u6CC1\u3068\u624B\u52D5\u8CFC\u8AAD",
    "Remove all manual/range subscriptions and restore the default mapped set (only while connected)": "\u624B\u52D5/\u7BC4\u56F2\u8CFC\u8AAD\u3092\u3059\u3079\u3066\u89E3\u9664\u3057\u3001\u30DE\u30C3\u30D4\u30F3\u30B0\u5B9A\u7FA9\u6E08\u307F\u306E\u65E2\u5B9A\u8CFC\u8AAD\u306B\u623B\u3059\uFF08\u30C7\u30D0\u30A4\u30B9\u63A5\u7D9A\u4E2D\u306E\u307F\uFF09",
    "Unsubscribe everything (only while connected)": "\u3059\u3079\u3066\u306E\u8CFC\u8AAD\u3092\u89E3\u9664\u3059\u308B\uFF08\u30C7\u30D0\u30A4\u30B9\u63A5\u7D9A\u4E2D\u306E\u307F\uFF09",
    "Address or range to subscribe. Auto-detected by part count (3 = parameters / 2 = meters). Enter adds": "\u8CFC\u8AAD\u3059\u308B\u30A2\u30C9\u30EC\u30B9\u307E\u305F\u306F\u7BC4\u56F2\u3002\u8981\u7D20\u6570\u3067\u81EA\u52D5\u5224\u5225\uFF083\u8981\u7D20=parameters / 2\u8981\u7D20=meters\uFF09\u3002Enter\u3067\u8FFD\u52A0",
    "Subscribe the entered address (ranges expand to a bulk add; only while connected)": "\u5165\u529B\u3057\u305F\u30A2\u30C9\u30EC\u30B9\uFF08\u7BC4\u56F2\u306F\u5C55\u958B\u3057\u3066\u4E00\u62EC\uFF09\u3092\u8CFC\u8AAD\u3059\u308B\uFF08\u30C7\u30D0\u30A4\u30B9\u63A5\u7D9A\u4E2D\u306E\u307F\uFF09",
    "Show received (RX) lines": "\u53D7\u4FE1\uFF08RX\uFF09\u884C\u3092\u8868\u793A\u3059\u308B",
    "Show sent (TX) lines": "\u9001\u4FE1\uFF08TX\uFF09\u884C\u3092\u8868\u793A\u3059\u308B",
    "Include meter notifications in the log/captures (very high volume)": "\u30E1\u30FC\u30BF\u30FC\u901A\u77E5\u3082\u30ED\u30B0/\u30AD\u30E3\u30D7\u30C1\u30E3\u306B\u542B\u3081\u308B\uFF08\u5927\u91CF\u306B\u6D41\u308C\u307E\u3059\uFF09",
    "Wrap long lines (horizontal scroll when off)": "\u9577\u3044\u884C\u3092\u6298\u308A\u8FD4\u3057\u3066\u8868\u793A\uFF08\u30AA\u30D5\u306E\u3068\u304D\u306F\u6A2A\u30B9\u30AF\u30ED\u30FC\u30EB\uFF09",
    "Clear the log and the observed address lists": "\u30ED\u30B0\u3068\u53D7\u4FE1\u30A2\u30C9\u30EC\u30B9\u4E00\u89A7\u3092\u30AF\u30EA\u30A2",
    "Copy the observed address list to the clipboard": "\u53D7\u4FE1\u30A2\u30C9\u30EC\u30B9\u4E00\u89A7\u3092\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u306B\u30B3\u30D4\u30FC",
    "Copy the unmapped observed addresses to the clipboard": "\u672A\u30DE\u30C3\u30D4\u30F3\u30B0\u306E\u53D7\u4FE1\u30A2\u30C9\u30EC\u30B9\u4E00\u89A7\u3092\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u306B\u30B3\u30D4\u30FC",
    "Investigate unmapped controls by operating the hardware": "\u672A\u30DE\u30C3\u30D4\u30F3\u30B0\u306E\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u5B9F\u6A5F\u64CD\u4F5C\u3067\u8ABF\u67FB",
    "Flag controls shown in the UI that do not exist on the real device": "\u753B\u9762\u4E0A\u306B\u3042\u308B\u304C\u5B9F\u6A5F\u306B\u306F\u5B58\u5728\u3057\u306A\u3044\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u6307\u6458",
    "Flag controls whose link/mapping is wrong": "\u30EA\u30F3\u30AF/\u30DE\u30C3\u30D4\u30F3\u30B0\u304C\u8AA4\u3063\u3066\u3044\u308B\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u6307\u6458",
    "Discard all captures": "\u30AD\u30E3\u30D7\u30C1\u30E3\u8A18\u9332\u3092\u3059\u3079\u3066\u7834\u68C4",
    "Copy to clipboard": "\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u306B\u30B3\u30D4\u30FC",
    "Save as a text file": "\u30C6\u30AD\u30B9\u30C8\u30D5\u30A1\u30A4\u30EB\u3068\u3057\u3066\u4FDD\u5B58",
    "Pick controls that do not exist on the device (repeat OK / Esc to finish)": "\u5B9F\u6A5F\u306B\u5B58\u5728\u3057\u306A\u3044\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u9078\u629E\uFF08\u9023\u7D9A\u53EF / Esc\u3067\u7D42\u4E86\uFF09",
    "Pick controls whose link is wrong (repeat OK / Esc to finish)": "\u30EA\u30F3\u30AF\u304C\u8AA4\u3063\u3066\u3044\u308B\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u9078\u629E\uFF08\u9023\u7D9A\u53EF / Esc\u3067\u7D42\u4E86\uFF09",
    "Discard all marks": "\u30DE\u30FC\u30AF\u3092\u3059\u3079\u3066\u7834\u68C4",
    // Devmode panel — TRYMAP mode
    "Temporarily link an unmapped address to a UI control and verify live": "\u672A\u30DE\u30C3\u30D4\u30F3\u30B0\u30A2\u30C9\u30EC\u30B9\u3092UI\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3078\u4E00\u6642\u30DE\u30C3\u30D7\u3057\u3066\u52D5\u4F5C\u78BA\u8A8D",
    "Pick the UI control to drive": "\u99C6\u52D5\u3059\u308BUI\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u9078\u629E",
    "Value type used to decode parameter notifications": "parameters\u901A\u77E5\u306E\u30C7\u30B3\u30FC\u30C9\u306B\u4F7F\u3046\u5024\u30BF\u30A4\u30D7",
    "Create the temporary link (this session only)": "\u4E00\u6642\u30EA\u30F3\u30AF\u3092\u4F5C\u6210\uFF08\u30BB\u30C3\u30B7\u30E7\u30F3\u9650\u308A\u30FB\u4FDD\u5B58\u3055\u308C\u307E\u305B\u3093\uFF09",
    "Remove all temporary links": "\u4E00\u6642\u30EA\u30F3\u30AF\u3092\u3059\u3079\u3066\u89E3\u9664",
    "Unlink": "\u30EA\u30F3\u30AF\u89E3\u9664",
    "Cancel picking (Esc)": "\u9078\u629E\u5F85\u3061\u3092\u30AD\u30E3\u30F3\u30BB\u30EB\uFF08Esc\uFF09",
    "Deselect the target (Esc)": "\u5BFE\u8C61\u306E\u9078\u629E\u3092\u89E3\u9664\uFF08Esc\uFF09",
    // Devmode panel (dynamic strings in src/devmode/devmode.ts)
    "{n} items": "{n}\u4EF6",
    "Remove this mark": "\u3053\u306E\u30DE\u30FC\u30AF\u3092\u524A\u9664",
    "unmapped": "\u672A\u30DE\u30C3\u30D4\u30F3\u30B0",
    "What should it be? (note)": "\u6B63\u3057\u304F\u306F\u3069\u3046\u3042\u308B\u3079\u304D\u304B\uFF08\u30E1\u30E2\uFF09",
    "Unsubscribe": "\u8CFC\u8AAD\u89E3\u9664",
    "total {n}": "\u8A08{n}",
    "existing:": "\u65E2\u5B58:",
    "Most frequent unassigned = mapping candidate": "\u672A\u5272\u5F53\u306E\u3046\u3061\u6700\u983B = \u30DE\u30C3\u30D4\u30F3\u30B0\u5019\u88DC",
    "Click a control on the board to choose the capture target (other clicks are disabled while picking)": "\u753B\u9762\u4E0A\u306E\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u30AD\u30E3\u30D7\u30C1\u30E3\u5BFE\u8C61\u3092\u9078\u629E\uFF08\u9078\u629E\u4E2D\u306F\u4ED6\u306E\u30AF\u30EA\u30C3\u30AF\u64CD\u4F5C\u3092\u7121\u52B9\u5316\uFF09",
    "Cancel without recording (Esc)": "\u9078\u629E\u3092\u30AD\u30E3\u30F3\u30BB\u30EB\uFF08\u8A18\u9332\u3057\u306A\u3044 / Esc\uFF09",
    "Finish and record this capture (Enter)": "\u3053\u306E\u30AD\u30E3\u30D7\u30C1\u30E3\u3092\u5B8C\u4E86\u3057\u3066\u8A18\u9332 (Enter)",
    "Delete this record": "\u3053\u306E\u8A18\u9332\u3092\u524A\u9664"
  };
  var lang = "en";
  function t(en, params) {
    let text = lang === "ja" ? JA[en] ?? en : en;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.split(`{${k}}`).join(v);
      }
    }
    return text;
  }
  function setTooltip(el, en, params) {
    if (!en) {
      el.removeAttribute("title");
      delete el.dataset.i18nEn;
      delete el.dataset.i18nArgs;
      return;
    }
    el.dataset.i18nEn = en;
    if (params) el.dataset.i18nArgs = JSON.stringify(params);
    else delete el.dataset.i18nArgs;
    el.title = t(en, params);
  }
  function refreshTooltips() {
    document.querySelectorAll("[title], [data-i18n-en]").forEach((el) => {
      const en = el.dataset.i18nEn ?? el.getAttribute("title");
      if (!en) return;
      el.dataset.i18nEn = en;
      let params;
      if (el.dataset.i18nArgs) {
        try {
          params = JSON.parse(el.dataset.i18nArgs);
        } catch {
        }
      }
      const text = t(en, params);
      if (el.title !== text) el.title = text;
    });
    syncToggleButton();
  }
  function setLang(next) {
    lang = next;
    ConfigStore.set("language", lang);
    document.documentElement.lang = lang;
    refreshTooltips();
    syncToggleButton();
    document.dispatchEvent(new CustomEvent(EVENT_LANG_CHANGED));
  }
  function syncToggleButton() {
    const btn = document.getElementById("lang-toggle");
    if (!btn) return;
    btn.textContent = lang.toUpperCase();
    setTooltip(btn, "Switch language");
  }
  function initI18n() {
    const saved = ConfigStore.get("language");
    if (saved === "ja" || saved === "en") lang = saved;
    document.documentElement.lang = lang;
    if (lang !== "en") refreshTooltips();
    syncToggleButton();
    document.addEventListener("click", (e) => {
      if (e.target.closest?.("#lang-toggle")) {
        setLang(lang === "en" ? "ja" : "en");
      }
    });
    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
      if (lang !== "en") refreshTooltips();
    });
  }

  // src/app/app-state.ts
  var appState = {
    // Scroll to Selection: follow the highlighted flow (header toggle)
    scrollToSelectionEnabled: true,
    // Scroll to Change: follow connection-state / parameter changes
    // (header toggle; read by the view and the broker)
    scrollToChangeEnabled: true
  };

  // src/view/categories.ts
  var NODE_CATEGORIES = [
    { className: "node-input", cssVar: "--accent-green", match: (id) => id.startsWith("in-ch") || id === "bus-osc" },
    { className: "node-mix", cssVar: "--accent-blue", match: (id) => id.startsWith("bus-mix") },
    { className: "node-fx", cssVar: "--accent-yellow", match: (id) => id.startsWith("bus-fx") },
    { className: "node-stereo", cssVar: "--accent-red", match: (id) => id === "bus-stereo" },
    // Logical outputs (MONITOR 1/2, STREAMING) share the purple accent
    { className: "node-monitor", cssVar: "--accent-purple", match: (id) => id.startsWith("bus-mon") || id === "bus-stream" },
    { className: "node-port", cssVar: "--text-muted", match: (id) => id.startsWith("in-port-") },
    { className: "node-output", cssVar: "--text-muted", match: (id) => id.startsWith("out-") || id.startsWith("daw-") }
  ];
  var colorCache = /* @__PURE__ */ new Map();
  function cssColor(varName) {
    let v = colorCache.get(varName);
    if (!v) {
      v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (v) colorCache.set(varName, v);
    }
    return v;
  }
  function getNodeCategory(nodeId) {
    return NODE_CATEGORIES.find((c) => c.match(nodeId)) || null;
  }
  function getNodeCategoryColor(nodeId) {
    const cat = getNodeCategory(nodeId);
    return cssColor(cat ? cat.cssVar : "--text-muted");
  }
  var colorOverrides = /* @__PURE__ */ new Map();
  function setNodeColorOverride(nodeId, hex) {
    if (hex) colorOverrides.set(nodeId, hex);
    else colorOverrides.delete(nodeId);
  }
  function effectiveNodeColor(nodeId) {
    return colorOverrides.get(nodeId) || getNodeCategoryColor(nodeId);
  }

  // src/view/connection-state.ts
  var PATCH_DESTINATIONS = [
    "out-main",
    "out-usba",
    "out-usbb",
    "out-usbc",
    "out-usbsub",
    "bus-stream",
    "bus-mon1",
    "bus-mon2"
  ];
  function getConnectionState(conn, reader, patches) {
    const { isBtnOff, isFaderMuted } = reader;
    if (conn.fromNode.startsWith("in-ch") && isBtnOff(`${conn.fromNode}-btn-on`)) return "muted";
    if (PATCH_DESTINATIONS.includes(conn.toNode) || conn.toNode.startsWith("in-ch")) {
      const activeSrc = patches[conn.toNode];
      if (!activeSrc || conn.fromNode !== activeSrc) return "inactive";
    }
    if (conn.fromNode.startsWith("in-ch") && conn.toNode === "bus-stereo") {
      if (isBtnOff(`${conn.fromNode}-btn-tost`)) return "muted";
      if (isFaderMuted(`${conn.fromNode}-knob-ch`)) return "muted";
    }
    if (conn.fromNode.startsWith("in-ch") && (conn.toNode.startsWith("bus-mix") || conn.toNode.startsWith("bus-fx"))) {
      const faderSuffix = conn.toNode.replace("bus-", "");
      if (isBtnOff(`${conn.fromNode}-send-${faderSuffix}-on`)) return "muted";
      if (isFaderMuted(`${conn.fromNode}-knob-${faderSuffix}`)) return "muted";
    }
    if (conn.fromNode === "bus-osc") {
      if (isBtnOff("bus-osc-btn-on")) return "muted";
      const faderSuffix = conn.toNode.replace("bus-", "");
      if (isBtnOff(`bus-osc-send-${faderSuffix}-on`)) return "muted";
    }
    if (conn.fromNode.startsWith("bus-fx")) {
      if (isBtnOff(`${conn.fromNode}-btn-on`)) return "muted";
      if (isFaderMuted(`${conn.fromNode}-fader-rtn`)) return "muted";
      if (conn.toNode === "bus-stereo" && isBtnOff(`${conn.fromNode}-btn-tost`)) return "muted";
      if (conn.toNode.startsWith("bus-mix")) {
        const sendSuffix = conn.toNode.replace("bus-", "");
        if (isBtnOff(`${conn.fromNode}-send-${sendSuffix}-on`)) return "muted";
        if (isFaderMuted(`${conn.fromNode}-knob-${sendSuffix}`)) return "muted";
      }
    }
    if (conn.fromNode.startsWith("bus-mix")) {
      if (isBtnOff(`${conn.fromNode}-btn-on`)) return "muted";
      if (isFaderMuted(`${conn.fromNode}-fader-mst`)) return "muted";
      if (conn.toNode === "bus-stereo" && isBtnOff(`${conn.fromNode}-btn-tost`)) return "muted";
    }
    if (conn.fromNode.startsWith("bus-mon") && isBtnOff(`${conn.fromNode}-btn-on`)) return "muted";
    if (conn.fromNode === "bus-stereo") {
      if (isBtnOff("bus-stereo-btn-on")) return "muted";
      if (isFaderMuted("bus-stereo-fader-out")) return "muted";
    }
    if ((conn.fromNode === "out-main" || conn.toNode === "out-main") && isBtnOff("out-main-btn-on")) {
      return "muted";
    }
    return "flow";
  }

  // src/view/control-reader.ts
  var controlCache = /* @__PURE__ */ new Map();
  function clearControlCache() {
    controlCache.clear();
  }
  function getControlEl(id) {
    let el = controlCache.get(id);
    if (el === void 0) {
      el = document.getElementById(id);
      controlCache.set(id, el);
    }
    return el;
  }
  var domControlReader = {
    isBtnOff(id) {
      const btn = getControlEl(id);
      return !!btn && !btn.classList.contains("active");
    },
    isFaderMuted(id) {
      const fader = getControlEl(id);
      if (!fader) return false;
      const val = fader.value !== void 0 ? parseFloat(fader.value) : parseFloat(fader.dataset.value);
      return isNaN(val) || val <= -60;
    }
  };

  // src/view/dom-refs.ts
  var _svgLayer = null;
  var _container = null;
  function svgLayer() {
    if (!_svgLayer) _svgLayer = document.getElementById("svg-layer");
    return _svgLayer;
  }
  function container() {
    if (!_container) _container = document.getElementById("main-container");
    return _container;
  }

  // src/view/view-state.ts
  var viewState = {
    // Selected node for the FOCUS VIEW highlight (null = no selection).
    activeNodeId: null,
    // Inactive (unpatched) lines are always hidden; muted lines are hidden
    // while the Hide Muted toggle is on (default ON, REQUIREMENTS.md §5.2).
    hideMuted: true,
    // Focus view suppression toggles (REQUIREMENTS.md §2.2.6, both default
    // ON): while a node is selected, state changes on connections/nodes
    // OUTSIDE the highlighted path skip the wipe/blink effects and/or the
    // Scroll to Change. No effect while nothing is selected.
    focusEffectsPathOnly: true,
    focusScrollPathOnly: true,
    // Hide (not just dim) the nodes outside the highlighted path
    focusNodesPathOnly: true
  };

  // src/view/highlight.ts
  function collectConnected(startId, nearKey, farKey, activeNodes, activeLines) {
    const queue = [startId];
    const visited = /* @__PURE__ */ new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      activeNodes.add(current);
      connections.forEach((conn, index) => {
        if (conn[nearKey] !== current) return;
        const state2 = getConnectionState(conn, domControlReader, currentPatches);
        if (state2 === "inactive") return;
        activeLines.add(index);
        if (state2 === "flow") {
          activeNodes.add(conn[farKey]);
          if (!visited.has(conn[farKey])) {
            queue.push(conn[farKey]);
          }
        }
      });
    }
  }
  var lastChipNodeId = null;
  function updateHighlights() {
    const activeNodeId = viewState.activeNodeId;
    if (!activeNodeId && !container().classList.contains("has-active-node") && lastChipNodeId === null) {
      return;
    }
    container().classList.toggle("has-active-node", !!activeNodeId);
    container().classList.toggle("path-only", !!activeNodeId && viewState.focusNodesPathOnly);
    document.body.classList.toggle("focus-view", !!activeNodeId);
    const chip = document.getElementById("focus-view-chip");
    if (chip) setTooltip(chip, activeNodeId ? "Click or press ESC to clear" : "");
    if (activeNodeId !== lastChipNodeId) {
      lastChipNodeId = activeNodeId;
      if (activeNodeId) {
        const chipNode = document.getElementById("focus-view-chip-node");
        const nodeEl = document.getElementById(activeNodeId);
        const titleEl = nodeEl && nodeEl.querySelector(".node-title");
        chipNode.textContent = titleEl ? titleEl.textContent.replace(/\s+/g, " ").trim() : activeNodeId;
      }
    }
    document.querySelectorAll(".node").forEach((node) => {
      node.classList.remove("active-node");
      node.classList.remove("clicked-node");
      node.style.borderColor = "var(--border-color)";
      if (node.dataset.chColor) {
        node.style.setProperty("border-top-color", node.dataset.chColor, "important");
      }
    });
    document.querySelectorAll(".routing-line").forEach((path) => {
      path.classList.remove("active");
    });
    if (!activeNodeId) return;
    const activeNodes = /* @__PURE__ */ new Set();
    const activeLines = /* @__PURE__ */ new Set();
    collectConnected(activeNodeId, "toNode", "fromNode", activeNodes, activeLines);
    collectConnected(activeNodeId, "fromNode", "toNode", activeNodes, activeLines);
    activeNodes.forEach((nodeId) => {
      const el = document.getElementById(nodeId);
      if (el) {
        el.classList.add("active-node");
        if (nodeId === activeNodeId) {
          el.classList.add("clicked-node");
        }
      }
    });
    activeLines.forEach((index) => {
      const basePath = document.getElementById(`path-${index}-base`);
      const flowPath = document.getElementById(`path-${index}-flow`);
      const mutedPath = document.getElementById(`path-${index}-muted`);
      [basePath, flowPath, mutedPath].forEach((path) => {
        if (path) path.classList.add("active");
      });
    });
  }

  // src/view/render.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  var prevConnStates = /* @__PURE__ */ new Map();
  var connTransitions = /* @__PURE__ */ new Map();
  var effectsSuppressedUntil = 0;
  function suppressChangeEffects(ms) {
    effectsSuppressedUntil = Math.max(effectsSuppressedUntil, Date.now() + ms);
    activeWipes.forEach((cancel) => cancel());
    activeWipes.clear();
    connTransitions.clear();
  }
  var WIPE_DURATION_MS = 1e3;
  var TRANSITION_WINDOW_MS = WIPE_DURATION_MS + 200;
  var WIPE_GLOW = "drop-shadow(0 0 4px currentColor) drop-shadow(0 0 10px currentColor)";
  var STATE_RANK = { inactive: 0, muted: 1, flow: 2 };
  function setLinesVisible(visible) {
    svgLayer().classList.toggle("lines-hidden", !visible);
  }
  function resolveConnColor(conn) {
    return effectiveNodeColor(conn.fromNode);
  }
  function refreshNodeLineColors(nodeId) {
    connections.forEach((conn, idx) => {
      if (conn.fromNode !== nodeId) return;
      conn.color = resolveConnColor(conn);
      const entry = connGroups[idx];
      if (!entry) return;
      entry.g.style.color = conn.color;
      entry.basePath.setAttribute("stroke", conn.color);
      entry.flowPath.setAttribute("stroke", conn.color);
    });
    updatePatchChips();
  }
  function updatePatchChips() {
    const setChip = (chip, srcId) => {
      const srcTitle = srcId && document.querySelector(`#${srcId} .node-title`);
      chip.textContent = srcTitle ? srcTitle.textContent : "";
      chip.style.color = srcId ? effectiveNodeColor(srcId) : "";
    };
    for (const [destId, srcId] of Object.entries(currentPatches)) {
      const chip = document.getElementById(`${destId}-ind-src`) || document.getElementById(`${destId}-ind-patch`);
      if (chip) setChip(chip, srcId);
    }
    [["out-ph1", "bus-mon1"], ["out-ph2", "bus-mon2"]].forEach(([phId, monId]) => {
      const chip = document.getElementById(`${phId}-ind-src`);
      if (chip) setChip(chip, currentPatches[monId]);
    });
  }
  function createConnGroup(idx) {
    const g = document.createElementNS(SVG_NS, "g");
    g.id = `conn-group-${idx}`;
    const makePath = (kind) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.id = `path-${idx}-${kind}`;
      path.setAttribute("class", `routing-line ${kind}-line`);
      g.appendChild(path);
      return path;
    };
    return {
      g,
      basePath: makePath("base"),
      flowPath: makePath("flow"),
      mutedPath: makePath("muted")
    };
  }
  var connGroups = [];
  function initializeSvgPaths() {
    svgLayer().innerHTML = "";
    connGroups.length = 0;
    clearControlCache();
    connections.forEach((conn, index) => {
      conn.color = resolveConnColor(conn);
      const entry = createConnGroup(index);
      const { g, basePath, flowPath, mutedPath } = entry;
      g.style.opacity = "0";
      g.style.color = conn.color;
      basePath.setAttribute("stroke", conn.color);
      flowPath.setAttribute("stroke", conn.color);
      mutedPath.setAttribute("stroke", cssColor("--line-muted-stroke"));
      mutedPath.style.color = cssColor("--text-muted");
      svgLayer().appendChild(g);
      connGroups[index] = entry;
    });
    updatePatchChips();
  }
  var settleRedraws = /* @__PURE__ */ new Map();
  function scheduleSettleRedraw(delayMs) {
    const due = Math.ceil((Date.now() + delayMs) / 50) * 50;
    if (settleRedraws.has(due)) return;
    settleRedraws.set(due, setTimeout(() => {
      settleRedraws.delete(due);
      drawLines();
    }, Math.max(0, due - Date.now())));
  }
  function evaluateConnections() {
    const blinkNodes = /* @__PURE__ */ new Set();
    const newTransitions = [];
    const now = Date.now();
    const evaluated = connections.map((conn, idx) => {
      const state2 = getConnectionState(conn, domControlReader, currentPatches);
      const connKey = `${conn.fromNode}->${conn.toNode}`;
      const prevState = prevConnStates.get(connKey);
      let newlyChanged = false;
      if (prevState !== void 0 && prevState !== state2 && now >= effectsSuppressedUntil) {
        let offPath = false;
        if (viewState.activeNodeId) {
          const flowEl = document.getElementById(`path-${idx}-flow`);
          const lineActive = flowEl && flowEl.classList.contains("active");
          if (!lineActive) {
            const touchesPath = (id) => {
              const el = document.getElementById(id);
              return el && el.classList.contains("active-node");
            };
            const joinsPath = state2 !== "inactive" && (touchesPath(conn.fromNode) || touchesPath(conn.toNode));
            offPath = !joinsPath;
          }
        }
        if (!(offPath && viewState.focusScrollPathOnly)) {
          blinkNodes.add(conn.fromNode);
          blinkNodes.add(conn.toNode);
        }
        if (offPath && viewState.focusEffectsPathOnly) {
          prevConnStates.set(connKey, state2);
          const stale = connTransitions.get(connKey);
          return { conn, idx, state: state2, inTransition: !!stale && now < stale.until, newlyChanged: false, transition: stale, connKey };
        }
        newlyChanged = true;
        const dir = STATE_RANK[state2] > STATE_RANK[prevState] ? "in" : "out";
        const transition2 = {
          dir,
          showFlow: state2 === "flow" || prevState === "flow",
          // The dotted muted layer stays hidden while a flow line wipes
          // out toward it (it appears once the wipe settles); when
          // unmuting it stays visible under the growing flow line
          showMuted: prevState === "muted" || state2 === "muted" && dir === "in",
          // Appearing wipes also grow the solid base line, but only
          // when coming from inactive (disappearing wipes hide the
          // base directly in startWipe and never consult this flag)
          wipeBase: prevState === "inactive",
          // Both endpoints blink exactly when this wipe starts
          nodes: [conn.fromNode, conn.toNode],
          effectsReady: null,
          // set below when a Scroll to Change runs
          startDelay: 0,
          // set below when paired with a disconnect
          until: now + TRANSITION_WINDOW_MS
        };
        connTransitions.set(connKey, transition2);
        newTransitions.push(transition2);
      }
      prevConnStates.set(connKey, state2);
      const transition = connTransitions.get(connKey);
      const inTransition = !!transition && now < transition.until;
      return { conn, idx, state: state2, inTransition, newlyChanged, transition, connKey };
    });
    if (appState.scrollToChangeEnabled && blinkNodes.size > 0) {
      const scroll = scrollToNodes(blinkNodes);
      if (scroll.scrolled > 0) {
        newTransitions.forEach((t2) => {
          t2.effectsReady = scroll.done;
        });
      }
    }
    const outPhasesMs = newTransitions.reduce(
      (max, t2) => t2.dir === "out" ? Math.max(max, TRANSITION_WINDOW_MS - 200) : max,
      0
    );
    if (outPhasesMs > 0) {
      newTransitions.forEach((t2) => {
        if (t2.dir === "in") {
          t2.startDelay = outPhasesMs;
          t2.until = now + outPhasesMs + TRANSITION_WINDOW_MS;
        }
      });
    }
    if (settleRedraws.size === 0 && evaluated.some((item) => item.inTransition)) {
      scheduleSettleRedraw(TRANSITION_WINDOW_MS + 5);
    }
    return evaluated;
  }
  var activeWipes = /* @__PURE__ */ new Map();
  function cancelWipe(path) {
    const cancel = activeWipes.get(path);
    if (cancel) {
      cancel();
      activeWipes.delete(path);
    }
  }
  function wipePath(path, dir, delayMs = 0, onBegin = null) {
    cancelWipe(path);
    const len = path.getTotalLength();
    if (!len) return;
    let raf = 0;
    let timer = 0;
    activeWipes.set(path, () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    });
    const applyT = (t2) => {
      path.style.setProperty("stroke-dasharray", `${t2} ${len}`, "important");
    };
    const begin = () => {
      if (onBegin) onBegin();
      const start = performance.now();
      path.style.setProperty("stroke-dashoffset", "0", "important");
      path.style.setProperty("filter", WIPE_GLOW, "important");
      path.style.removeProperty("stroke-width");
      const baseWidth = parseFloat(getComputedStyle(path).strokeWidth) || 1.5;
      path.style.setProperty("stroke-width", `${baseWidth * 3}px`, "important");
      applyT(dir === "in" ? 0 : len);
      const frame = (now) => {
        const p = Math.min(1, (now - start) / WIPE_DURATION_MS);
        const eased = 1 - Math.pow(1 - p, 2);
        applyT((dir === "in" ? eased : 1 - eased) * len);
        if (p < 1) {
          raf = requestAnimationFrame(frame);
        } else {
          activeWipes.delete(path);
          path.style.removeProperty("filter");
          path.style.removeProperty("stroke-width");
          if (dir === "in") {
            clearWipeStyles(path);
          }
        }
      };
      raf = requestAnimationFrame(frame);
    };
    if (delayMs > 0) {
      timer = setTimeout(begin, delayMs);
    } else {
      begin();
    }
  }
  function clearWipeStyles(path) {
    if (activeWipes.has(path)) return;
    path.style.removeProperty("stroke-dasharray");
    path.style.removeProperty("stroke-dashoffset");
    path.style.removeProperty("filter");
    path.style.removeProperty("stroke-width");
  }
  function startWipe(transition, basePath, flowPath, mutedPath) {
    const primary = transition.showFlow ? flowPath : mutedPath;
    if (transition.dir === "out") {
      transition.hideBase = true;
      setPathVisible(basePath, false);
      wipePath(primary, "out");
      return;
    }
    wipePath(primary, transition.dir);
    if (transition.wipeBase) wipePath(basePath, transition.dir);
  }
  function prepareDeferredWipe(transition, basePath, flowPath, mutedPath) {
    if (transition.dir !== "in") return;
    const paths = [transition.showFlow ? flowPath : mutedPath];
    if (transition.wipeBase) paths.push(basePath);
    paths.forEach((path) => {
      const len = path.getTotalLength();
      if (!len) return;
      path.style.setProperty("stroke-dashoffset", "0", "important");
      path.style.setProperty("stroke-dasharray", `0 ${len}`, "important");
    });
  }
  function makeRectLookup() {
    const rects = /* @__PURE__ */ new Map();
    return (id, el) => {
      let r = rects.get(id);
      if (!r) {
        r = el.getBoundingClientRect();
        rects.set(id, r);
      }
      return r;
    };
  }
  function contentOrigin() {
    const el = container();
    const rect = el.getBoundingClientRect();
    return { left: rect.left - el.scrollLeft, top: rect.top - el.scrollTop };
  }
  function computeBezierD(rectFrom, rectTo, origin) {
    const startX = rectFrom.left + rectFrom.width / 2 - origin.left;
    const startY = rectFrom.top + rectFrom.height / 2 - origin.top;
    const endX = rectTo.left + rectTo.width / 2 - origin.left;
    const endY = rectTo.top + rectTo.height / 2 - origin.top;
    const cpX = startX + (endX - startX) * 0.5;
    return `M ${startX} ${startY} C ${cpX} ${startY}, ${cpX} ${endY}, ${endX} ${endY}`;
  }
  function ensureConnGroup(idx) {
    let entry = connGroups[idx];
    if (!entry) {
      entry = createConnGroup(idx);
      const color = connections[idx].color;
      entry.basePath.setAttribute("stroke", color);
      entry.flowPath.setAttribute("stroke", color);
      svgLayer().appendChild(entry.g);
      connGroups[idx] = entry;
    }
    return entry;
  }
  var lastAppliedD = /* @__PURE__ */ new WeakMap();
  function applyPathGeometry({ g, basePath, flowPath, mutedPath }, d) {
    if (lastAppliedD.get(g) === d) return;
    lastAppliedD.set(g, d);
    basePath.setAttribute("d", d);
    flowPath.setAttribute("d", d);
    mutedPath.setAttribute("d", d);
  }
  function setPathVisible(path, visible) {
    if (visible) {
      path.style.removeProperty("opacity");
    } else {
      path.style.setProperty("opacity", "0", "important");
    }
  }
  function applyStateStyles(g, basePath, flowPath, mutedPath, state2, inTransition, transition) {
    if (inTransition && transition) {
      setPathVisible(basePath, !transition.hideBase);
      setPathVisible(flowPath, transition.showFlow);
      setPathVisible(mutedPath, transition.showMuted);
    } else {
      setPathVisible(basePath, true);
      setPathVisible(flowPath, state2 === "flow");
      setPathVisible(mutedPath, state2 === "muted");
    }
    const isHiddenState = state2 === "inactive" || state2 === "muted" && viewState.hideMuted;
    if (isHiddenState && !inTransition) {
      g.style.setProperty("opacity", "0", "important");
      g.style.setProperty("pointer-events", "none", "important");
      g.classList.add("line-hidden");
    } else {
      g.style.removeProperty("opacity");
      g.style.removeProperty("pointer-events");
      g.classList.remove("line-hidden");
    }
  }
  function removeOrphanGroups(activeGroupIds) {
    Array.from(svgLayer().children).forEach((child) => {
      if (child.id && child.id.startsWith("conn-group-") && !activeGroupIds.has(child.id)) {
        delete connGroups[parseInt(child.id.slice("conn-group-".length), 10)];
        child.remove();
      }
    });
  }
  function raiseTransitioningGroups() {
    if (connTransitions.size === 0) return;
    svgLayer().querySelectorAll("g.line-transition").forEach((g) => svgLayer().appendChild(g));
  }
  function redrawLineGeometry() {
    const origin = contentOrigin();
    const rectOf = makeRectLookup();
    connections.forEach((conn, idx) => {
      const entry = connGroups[idx];
      if (!entry) return;
      const elFrom = document.getElementById(conn.from);
      const elTo = document.getElementById(conn.to);
      if (!elFrom || !elTo) return;
      if (elFrom.offsetParent === null || elTo.offsetParent === null) return;
      const d = computeBezierD(rectOf(conn.from, elFrom), rectOf(conn.to, elTo), origin);
      applyPathGeometry(entry, d);
    });
  }
  function drawLines() {
    const origin = contentOrigin();
    const rectOf = makeRectLookup();
    const evaluatedConns = evaluateConnections();
    const activeGroupIds = /* @__PURE__ */ new Set();
    evaluatedConns.forEach(({ conn, idx, state: state2, inTransition, newlyChanged, transition, connKey }) => {
      const elFrom = document.getElementById(conn.from);
      const elTo = document.getElementById(conn.to);
      if (!elFrom || !elTo) return;
      activeGroupIds.add(`conn-group-${idx}`);
      if (elFrom.offsetParent === null || elTo.offsetParent === null) {
        const { g: g2 } = ensureConnGroup(idx);
        g2.style.setProperty("opacity", "0", "important");
        g2.style.setProperty("pointer-events", "none", "important");
        g2.classList.remove("line-transition");
        return;
      }
      const d = computeBezierD(rectOf(conn.from, elFrom), rectOf(conn.to, elTo), origin);
      const entry = ensureConnGroup(idx);
      const { g, basePath, flowPath, mutedPath } = entry;
      applyPathGeometry(entry, d);
      applyStateStyles(g, basePath, flowPath, mutedPath, state2, inTransition, transition);
      if (newlyChanged && transition) {
        const begin = () => {
          if (connTransitions.get(connKey) !== transition) return;
          transition.until = Date.now() + TRANSITION_WINDOW_MS;
          transition.nodes.forEach(triggerNodeBlink);
          startWipe(transition, basePath, flowPath, mutedPath);
          scheduleSettleRedraw(TRANSITION_WINDOW_MS + 50);
        };
        if (transition.effectsReady || transition.startDelay > 0) {
          prepareDeferredWipe(transition, basePath, flowPath, mutedPath);
          const afterScroll = () => {
            if (transition.startDelay > 0) {
              setTimeout(begin, transition.startDelay);
            } else {
              begin();
            }
          };
          if (transition.effectsReady) {
            transition.effectsReady.then(afterScroll);
          } else {
            afterScroll();
          }
        } else {
          begin();
        }
      }
      if (!inTransition) {
        if (transition) connTransitions.delete(connKey);
        [basePath, flowPath, mutedPath].forEach(clearWipeStyles);
      }
      g.classList.toggle("line-transition", inTransition);
    });
    removeOrphanGroups(activeGroupIds);
    raiseTransitioningGroups();
    updateHighlights();
  }
  function dbToKnobAngle(db) {
    const pct = Math.max(0, Math.min(1, (db * 100 + 6e3) / 7e3));
    return -135 + pct * 270;
  }
  function setValueLabel(valEl, text) {
    valEl.textContent = text;
    valEl.style.color = text.includes("-inf") ? "var(--accent-red)" : "var(--accent-green)";
    const maxLen = Number(valEl.dataset.maxLen) || 0;
    if (text.length > maxLen) {
      valEl.dataset.maxLen = String(text.length);
      requestColumnRemeasure();
    }
  }
  function updateKnobElement(knobEl, angle, text) {
    knobEl.style.transform = `rotate(${angle}deg)`;
    if (text === void 0) return;
    const valEl = knobEl.parentElement.querySelector(".knob-val");
    if (valEl) setValueLabel(valEl, text);
  }
  function updateToggleElement(el, isActive) {
    if (el.classList.contains("dsp-block") || el.classList.contains("send-on") || el.classList.contains("send-pre")) {
      if (isActive) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
      if (el.id && el.id.match(/^(in-ch.*|bus-fx[12])-btn-on$/)) {
        const node = el.closest(".node");
        if (node) {
          node.classList.toggle("ch-muted", !isActive);
        }
      }
      debouncedDrawLines();
    } else if (el.classList.contains("indicator")) {
      const activeClass = Array.from(el.classList).find((c) => c.startsWith("active-")) || "active-blue";
      if (isActive) {
        el.classList.add(activeClass);
      } else {
        el.classList.remove(activeClass);
      }
    }
  }
  var nodeBlinkTimers = /* @__PURE__ */ new WeakMap();
  var nodeBlinkStarted = /* @__PURE__ */ new WeakMap();
  function triggerNodeBlink(nodeId) {
    const nodeEl = document.getElementById(nodeId);
    if (!nodeEl) return;
    const now = performance.now();
    const started = nodeBlinkStarted.get(nodeEl);
    if (started !== void 0 && now - started < 16) return;
    nodeBlinkStarted.set(nodeEl, now);
    const pending = nodeBlinkTimers.get(nodeEl);
    if (pending) clearTimeout(pending);
    nodeEl.classList.remove("node-blink");
    void nodeEl.offsetWidth;
    nodeEl.classList.add("node-blink");
    nodeBlinkTimers.set(nodeEl, setTimeout(() => {
      nodeBlinkTimers.delete(nodeEl);
      nodeEl.classList.remove("node-blink");
    }, 1050));
  }

  // src/broker/redraw.ts
  var DEBOUNCE_MS = 50;
  var MAX_WAIT_MS = 200;
  var isSyncingInitial = false;
  var drawLinesTimeout = null;
  var pendingSince = 0;
  function setSyncingInitial(v) {
    isSyncingInitial = v;
  }
  function flushDrawLines() {
    drawLinesTimeout = null;
    drawLines();
  }
  function debouncedDrawLines() {
    if (isSyncingInitial) return;
    const now = Date.now();
    if (drawLinesTimeout) {
      clearTimeout(drawLinesTimeout);
    } else {
      pendingSince = now;
    }
    const remaining = Math.max(0, pendingSince + MAX_WAIT_MS - now);
    drawLinesTimeout = setTimeout(flushDrawLines, Math.min(DEBOUNCE_MS, remaining));
  }

  // src/app/layout.ts
  function nodeScrollTarget(body, node, align) {
    const EDGE_MARGIN = 112;
    const contentTop = node.offsetTop - body.offsetTop;
    const centered = contentTop - (body.clientHeight - node.offsetHeight) / 2;
    const keepTopVisible = contentTop - EDGE_MARGIN;
    const keepBottomVisible = contentTop + node.offsetHeight + EDGE_MARGIN - body.clientHeight;
    const preferred = align === "top" ? keepTopVisible : centered;
    const target = Math.min(keepTopVisible, Math.max(keepBottomVisible, preferred));
    return Math.min(body.scrollHeight - body.clientHeight, Math.max(0, target));
  }
  function autoScrollToActiveNodes() {
    if (!appState.scrollToSelectionEnabled) return;
    document.querySelectorAll(".section").forEach((section) => {
      const body = section.querySelector(".section-body");
      if (!body) return;
      let diff = 0;
      const topSpacer = body.querySelector(".scroll-top-spacer");
      if (topSpacer) {
        diff = parseFloat(topSpacer.style.height) || 0;
      }
      if (diff > 0) {
        body.scrollTo({ top: diff / 2, behavior: "smooth" });
        return;
      }
      const activeNodes = Array.from(body.querySelectorAll(".node.active-node"));
      if (activeNodes.length === 0) {
        body.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      let topmost = activeNodes[0];
      activeNodes.forEach((n) => {
        if (n.offsetTop < topmost.offsetTop) {
          topmost = n;
        }
      });
      body.scrollTo({ top: nodeScrollTarget(body, topmost, "top"), behavior: "smooth" });
    });
  }
  function scrollToNodes(nodeIds) {
    const SCROLL_FALLBACK_MS = 800;
    const byBody = /* @__PURE__ */ new Map();
    for (const id of nodeIds) {
      const node = document.getElementById(id);
      if (!node) continue;
      const body = node.closest(".section-body");
      if (!body) continue;
      const current = byBody.get(body);
      if (!current || node.offsetTop < current.offsetTop) byBody.set(body, node);
    }
    const waits = [];
    byBody.forEach((node, body) => {
      const topSpacer = body.querySelector(".scroll-top-spacer");
      const diff = topSpacer ? parseFloat(topSpacer.style.height) || 0 : 0;
      if (diff > 0) return;
      const clamped = nodeScrollTarget(body, node, "center");
      if (Math.abs(body.scrollTop - clamped) < 1) return;
      body.scrollTo({ top: clamped, behavior: "smooth" });
      waits.push(new Promise((resolve) => {
        const finish = () => {
          clearTimeout(fallback);
          body.removeEventListener("scrollend", finish);
          resolve();
        };
        const fallback = setTimeout(finish, SCROLL_FALLBACK_MS);
        body.addEventListener("scrollend", finish);
      }));
    });
    return { scrolled: waits.length, done: Promise.all(waits) };
  }
  function layoutSectionBody(body, syncScroll, scrollBlend) {
    let topSpacer = body.querySelector(".scroll-top-spacer");
    if (!topSpacer) {
      topSpacer = document.createElement("div");
      topSpacer.className = "scroll-top-spacer";
      topSpacer.style.flex = "none";
      body.insertBefore(topSpacer, body.firstChild);
    }
    let bottomSpacer = body.querySelector(".scroll-bottom-spacer");
    if (!bottomSpacer) {
      bottomSpacer = document.createElement("div");
      bottomSpacer.className = "scroll-bottom-spacer";
      bottomSpacer.style.flex = "none";
      body.appendChild(bottomSpacer);
    }
    const nodes = Array.from(body.querySelectorAll(".node")).filter((n) => n.offsetParent !== null);
    let C = 0;
    if (nodes.length > 0) {
      const span = bottomSpacer.offsetTop - (topSpacer.offsetTop + topSpacer.offsetHeight);
      C = span + 8 + 24;
    }
    const H = body.clientHeight;
    const diff = H - C;
    const setStyle = (el, prop, value) => {
      if (el.style[prop] !== value) el.style[prop] = value;
    };
    if (diff > 0) {
      body.dataset.noOverflow = "true";
      setStyle(body, "paddingTop", "8px");
      setStyle(body, "paddingBottom", "24px");
      setStyle(topSpacer, "height", diff + "px");
      setStyle(bottomSpacer, "height", diff + "px");
      if (syncScroll) {
        const target = diff / 2;
        if (scrollBlend && scrollBlend.p < 1) {
          const eased = scrollBlend.p * scrollBlend.p * (3 - 2 * scrollBlend.p);
          body.scrollTop = scrollBlend.from + (target - scrollBlend.from) * eased;
        } else {
          body.scrollTop = target;
        }
        updateFade(body);
      } else {
        setTimeout(() => {
          body.scrollTo({ top: diff / 2, behavior: "smooth" });
          updateFade(body);
          debouncedDrawLines();
        }, 0);
      }
    } else {
      body.dataset.noOverflow = "false";
      setStyle(body, "paddingTop", "8px");
      setStyle(body, "paddingBottom", "24px");
      setStyle(topSpacer, "height", "0px");
      setStyle(bottomSpacer, "height", "0px");
      updateFade(body);
    }
  }
  function sizeFixedColumns() {
    const root = document.documentElement;
    const measured = [];
    [["col-inputs", "--col-inputs-w"], ["col-fx", "--col-fx-w"]].forEach(([id, prop]) => {
      const col = document.getElementById(id);
      if (!col || col.classList.contains("all-collapsed")) return;
      measured.push(col);
      root.style.setProperty(prop, "max-content");
      const w = Math.ceil(col.getBoundingClientRect().width);
      root.style.setProperty(prop, w + "px");
    });
    const board = container();
    const prevScrollLeft = board.scrollLeft;
    [["col-mix", "--col-mix-w"], ["col-stereo", "--col-stereo-w"]].forEach(([id, prop]) => {
      const col = document.getElementById(id);
      if (!col || col.classList.contains("all-collapsed")) return;
      measured.push(col);
      const prevWidth = col.style.width;
      const prevFlex = col.style.flex;
      const prevMinWidth = col.style.minWidth;
      col.style.minWidth = "0";
      col.style.width = "0";
      col.style.flex = "none";
      const colRect = col.getBoundingClientRect();
      let floor = 0;
      col.querySelectorAll(".node").forEach((node) => {
        const r = node.getBoundingClientRect();
        floor = Math.max(floor, r.right - colRect.left + (r.left - colRect.left));
      });
      col.style.width = prevWidth;
      col.style.flex = prevFlex;
      col.style.minWidth = prevMinWidth;
      if (floor > 0) root.style.setProperty(prop, Math.ceil(floor) + "px");
    });
    board.scrollLeft = prevScrollLeft;
    measured.forEach((col) => {
      col.querySelectorAll(".knob-val, .fader-val").forEach((label) => {
        label.dataset.maxLen = String((label.textContent || "").length);
      });
    });
  }
  function equalizeSectionHeadings() {
    const h2s = Array.from(document.querySelectorAll(".section > h2"));
    if (h2s.length === 0) return;
    h2s.forEach((h) => {
      h.style.minHeight = "";
    });
    const max = Math.ceil(Math.max(...h2s.map((h) => h.getBoundingClientRect().height)));
    h2s.forEach((h) => {
      h.style.minHeight = max + "px";
    });
  }
  function adjustSectionPadding() {
    equalizeSectionHeadings();
    document.querySelectorAll(".section-body").forEach((body) => layoutSectionBody(body, false));
    drawLines();
  }
  function updateFade(body) {
    if (body.dataset.noOverflow === "true") {
      body.dataset.fadeTop = "false";
      body.dataset.fadeBottom = "false";
      return;
    }
    const atTop = body.scrollTop <= 2;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
    body.dataset.fadeTop = (!atTop).toString();
    body.dataset.fadeBottom = (!atBottom).toString();
  }
  var remeasureQueued = false;
  function requestColumnRemeasure() {
    if (remeasureQueued) return;
    remeasureQueued = true;
    requestAnimationFrame(() => {
      remeasureQueued = false;
      sizeFixedColumns();
      debouncedDrawLines();
    });
  }
  function isValueLabelMutation(record) {
    const target = record.target;
    const el = target instanceof Element ? target : target.parentElement;
    return !!el && !!el.closest(".knob-val, .fader-val");
  }
  function initLayoutListeners() {
    let resizeLayoutQueued = false;
    window.addEventListener("resize", () => {
      if (!resizeLayoutQueued) {
        resizeLayoutQueued = true;
        requestAnimationFrame(() => {
          resizeLayoutQueued = false;
          adjustSectionPadding();
        });
      }
    });
    ["col-inputs", "col-fx", "col-mix", "col-stereo"].forEach((id) => {
      const col = document.getElementById(id);
      if (col) {
        new MutationObserver((records) => {
          if (records.every(isValueLabelMutation)) return;
          requestColumnRemeasure();
        }).observe(col, { childList: true, characterData: true, subtree: true });
      }
    });
    let scrollDrawQueued = false;
    window.addEventListener("scroll", (e) => {
      const target = e.target;
      if (target.classList && target.classList.contains("section-body")) {
        updateFade(target);
        if (!scrollDrawQueued) {
          scrollDrawQueued = true;
          requestAnimationFrame(() => {
            scrollDrawQueued = false;
            drawLines();
          });
        }
      }
    }, true);
  }
  function finalizeInitialLayout() {
    adjustSectionPadding();
    setTimeout(() => {
      adjustSectionPadding();
    }, 200);
  }

  // src/ui/ui-builder.ts
  var currentModel = "URX44V";
  var COLLAPSE_TOGGLE = '<span class="section-view-btns"><button class="section-btn section-collapse-btn" title="Collapse all nodes in this section"></button><button class="section-btn section-expand-btn" title="Restore all nodes in this section to full view"></button></span>';
  function createInputChannels() {
    const col = document.getElementById("col-inputs");
    if (!col) return;
    const channels = [
      { id: "in-ch1", title: "CH 1", subtitle: "Mic", preamp: ["+48V", "\xD8", "HPF", "", "AUTO", "SAFE"], dsp: ["GATE", "COMP", "EQ", "INS FX"] },
      { id: "in-ch2", title: "CH 2", subtitle: "Guitar", preamp: ["+48V", "\xD8", "HPF", "Hi-Z", "AUTO", "SAFE"], dsp: ["GATE", "COMP", "EQ", "INS FX"] },
      { id: "in-ch34", title: "CH 3/4", subtitle: "Keys L/R", preamp: ["\xD8", "", "AUTO", "SAFE"], dsp: ["EQ", "DUCKER"] },
      { id: "in-ch56", title: "CH 5/6", subtitle: "Synth", preamp: ["\xD8", "", "AUTO", "SAFE"], dsp: ["EQ", "DUCKER"] },
      { id: "in-ch78", title: "CH 7/8", subtitle: "Backing Track", preamp: ["\xD8", "", "AUTO", "SAFE"], dsp: ["EQ", "DUCKER"] },
      { id: "in-ch910", title: "CH 9/10", subtitle: "iPad", preamp: ["\xD8", "", "AUTO", "SAFE"], dsp: ["EQ", "DUCKER"] }
    ];
    let html = `<h2>Channel${COLLAPSE_TOGGLE}</h2>
`;
    channels.forEach((ch) => {
      const preampHtml = ch.preamp.map((p) => p ? `<div class="dsp-block${p === "+48V" || p === "Hi-Z" || p === "HPF" ? " active" : ""}">${p}</div>` : `<div></div>`).join("");
      const dspHtml = ch.dsp.map((d) => `<div class="dsp-block${d !== "INS FX" ? " active" : ""}">${d}</div>`).join("");
      const isStereo = ch.id !== "in-ch1" && ch.id !== "in-ch2";
      html += `
            <div class="node" id="${ch.id}">
                <div class="endpoint-in" id="pt-${ch.id}-in"></div>
                <div class="node-header">
                    <div class="titlebox">
                        <div class="node-title">${ch.title}</div>
                        <div class="node-subtitle" id="${ch.id}-subtitle">${ch.subtitle}</div>
                    </div>
                    <div class="src-chip" id="${ch.id}-ind-src"></div>
                </div>
                <div class="node-body">
                    <div class="knob-col">
                        <div class="knob-val"></div>
                        <div id="${ch.id}-knob-gain" class="knob" style="transform: rotate(-45deg);"></div>
                        <div class="knob-label">${isStereo ? "D.GAIN" : "GAIN"}</div>
                        <div class="preamp-buttons">
                            ${preampHtml}
                        </div>
                    </div>
                    <div class="dsp-chain-col dsp-chain-col--w40">
                        <div class="dsp-chain dsp-chain--vert">
                            ${dspHtml}
                        </div>
                    </div>
                    <div class="meter-col meter-col--stack">
                        <div class="meter-tap-chip" title="Meter tap: INPUT (before all DSP)">INPUT</div>
                        <div class="meter-container${isStereo ? " stereo" : ""}">
                            <div class="meter${isStereo ? " meter-l" : ""}" id="${ch.id}-meter"></div>
                            ${isStereo ? `<div class="meter meter-r" id="${ch.id}-meter-r"></div>` : ""}
                        </div>
                        <div class="node-btn-stack">
                            <div class="send-on" id="${ch.id}-btn-on">ON</div>
                        </div>
                    </div>
                    <div class="faders-group sends-section sends-grid-ch">
                        <!-- Row 1: Labels -->
                        <div></div>
                        <div class="knob-label">ST</div>
                        <div class="knob-label">MIX1</div>
                        <div class="knob-label">MIX2</div>
                        <div class="knob-label">FX1</div>
                        <div class="knob-label">FX2</div>

                        <!-- Row 2: ON -->
                        <div></div>
                        <div class="send-on" id="${ch.id}-btn-tost">ON</div>
                        <div class="send-on" id="${ch.id}-send-mix1-on">ON</div>
                        <div class="send-on" id="${ch.id}-send-mix2-on">ON</div>
                        <div class="send-on" id="${ch.id}-send-fx1-on">ON</div>
                        <div class="send-on" id="${ch.id}-send-fx2-on">ON</div>

                        <!-- Row 3: PRE -->
                        <div></div>
                        <div></div>
                        <div class="send-pre" id="${ch.id}-send-mix1-pre">PRE</div>
                        <div class="send-pre" id="${ch.id}-send-mix2-pre">PRE</div>
                        <div class="send-pre" id="${ch.id}-send-fx1-pre">PRE</div>
                        <div class="send-pre" id="${ch.id}-send-fx2-pre">PRE</div>

                        <!-- Row 4: Dashed Line -->
                        <div class="sends-divider"></div>

                        <!-- Row 5: PAN -->
                        <div class="sends-row-label">PAN</div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-pan" class="knob knob-pan" style="transform: rotate(0deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-mix1-pan" class="knob knob-pan" style="transform: rotate(0deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-mix2-pan" class="knob knob-pan" style="transform: rotate(0deg);"></div></div>
                        <div></div>
                        <div></div>

                        <!-- Row 6: LEVEL -->
                        <div class="sends-row-label">LEVEL</div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-ch" class="knob" style="transform: rotate(-135deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-mix1" class="knob" style="transform: rotate(-135deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-mix2" class="knob" style="transform: rotate(-135deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-fx1" class="knob" style="transform: rotate(-135deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="${ch.id}-knob-fx2" class="knob" style="transform: rotate(-135deg);"></div></div>
                    </div>
                </div>
                <div class="endpoint-out" id="pt-${ch.id}-out"></div>
            </div>`;
    });
    html += `
        <div class="node" id="bus-osc">
            <div class="node-header">
                <div>
                    <div class="node-title">OSCILLATOR</div>
                </div>
            </div>
            <div class="node-body">
                <div class="knob-col">
                    <div class="knob-val"></div>
                    <div id="bus-osc-knob-level" class="knob" style="transform: rotate(-135deg);"></div>
                    <div class="knob-label">LEVEL</div>
                </div>
                <div class="knob-col">
                    <div class="knob-val"></div>
                    <div id="bus-osc-knob-freq" class="knob" style="transform: rotate(0deg);"></div>
                    <div class="knob-label">FREQ</div>
                </div>
                <div class="dsp-chain-col osc-modes">
                    <div class="send-on osc-on-btn" id="bus-osc-btn-on">ON</div>
                    <div class="dsp-block osc-mode-btn" id="bus-osc-mode-sine">SINE</div>
                    <div class="dsp-block osc-mode-btn" id="bus-osc-mode-pink">PINK</div>
                    <div class="dsp-block osc-mode-btn" id="bus-osc-mode-burst">BURST</div>
                </div>
                <div class="faders-group sends-section sends-grid-osc">
                    <!-- Row 1: Labels -->
                    <div class="knob-label">ST</div>
                    <div class="knob-label">MIX1</div>
                    <div class="knob-label">MIX2</div>
                    <div class="knob-label">FX1</div>
                    <div class="knob-label">FX2</div>

                    <!-- Row 2: ON -->
                    <div class="send-on" id="bus-osc-send-stereo-on">ON</div>
                    <div class="send-on" id="bus-osc-send-mix1-on">ON</div>
                    <div class="send-on" id="bus-osc-send-mix2-on">ON</div>
                    <div class="send-on" id="bus-osc-send-fx1-on">ON</div>
                    <div class="send-on" id="bus-osc-send-fx2-on">ON</div>
                </div>
            </div>
            <div class="endpoint-out" id="pt-bus-osc-out"></div>
        </div>`;
    col.innerHTML = html;
  }
  function createMixBuses() {
    const colFx = document.getElementById("col-fx");
    if (colFx) {
      colFx.innerHTML = `<h2>FX<br>Buses${COLLAPSE_TOGGLE}</h2>
` + [1, 2].map((i) => `
            <div class="node" id="bus-fx${i}">
                <div class="endpoint-in" id="pt-bus-fx${i}-in"></div>
                <div class="node-header">
                    <div><div class="node-title">FX ${i}</div><div class="node-subtitle" id="bus-fx${i}-subtitle"></div></div>
                </div>
                <div class="node-body">
                    <div class="dsp-chain-col dsp-chain-col--tight">
                        <div class="meter-tap-chip" title="Meter tap: POST (output after inserts)">POST</div>
                        <div class="meter-container stereo"><div class="meter meter-l" id="bus-fx${i}-meter"></div><div class="meter meter-r" id="bus-fx${i}-meter-r"></div></div>
                        <div class="dsp-chain">
                            <div class="dsp-block active">${i === 1 ? "REV-X" : "DELAY"}</div>
                        </div>
                    </div>
                    <div class="faders-group">
                        <div class="fader-col">
                            <input type="range" id="bus-fx${i}-fader-rtn" orient="vertical" min="-144" max="10" value="0">
                            <div class="fader-label">LEVEL</div>
                        </div>
                    </div>
                    <div class="faders-group sends-section sends-grid-fx">
                        <!-- Row 1: Labels -->
                        <div class="knob-label">ST</div>
                        <div class="knob-label">MIX1</div>
                        <div class="knob-label">MIX2</div>

                        <!-- Row 2: ON (ST = TO ST assign) -->
                        <div class="send-on" id="bus-fx${i}-btn-tost">ON</div>
                        <div class="send-on active" id="bus-fx${i}-send-mix1-on">ON</div>
                        <div class="send-on active" id="bus-fx${i}-send-mix2-on">ON</div>

                        <!-- Row 3: PRE (MIX sends only) -->
                        <div></div>
                        <div class="send-pre" id="bus-fx${i}-send-mix1-pre">PRE</div>
                        <div class="send-pre" id="bus-fx${i}-send-mix2-pre">PRE</div>

                        <!-- Row 4: BAL -->
                        <div class="knob-col"><div class="knob-val"></div><div id="bus-fx${i}-knob-bal" class="knob knob-pan" style="transform: rotate(0deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="bus-fx${i}-knob-mix1-pan" class="knob knob-pan" style="transform: rotate(0deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="bus-fx${i}-knob-mix2-pan" class="knob knob-pan" style="transform: rotate(0deg);"></div></div>

                        <!-- Row 5: LEVEL (MIX sends only, default 0 dB) -->
                        <div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="bus-fx${i}-knob-mix1" class="knob" data-value="0" style="transform: rotate(96deg);"></div></div>
                        <div class="knob-col"><div class="knob-val"></div><div id="bus-fx${i}-knob-mix2" class="knob" data-value="0" style="transform: rotate(96deg);"></div></div>
                    </div>
                </div>
                <div class="endpoint-out" id="pt-bus-fx${i}-out"></div>
            </div>`).join("");
    }
    const colMix = document.getElementById("col-mix");
    if (colMix) {
      colMix.innerHTML = `<h2>MIX<br>Buses${COLLAPSE_TOGGLE}</h2>
` + [1, 2].map((i) => `
            <div class="node" id="bus-mix${i}">
                <div class="endpoint-in" id="pt-bus-mix${i}-in"></div>
                <div class="node-header">
                    <div><div class="node-title">MIX ${i}</div><div class="node-subtitle" id="bus-mix${i}-subtitle"></div></div>
                </div>
                <div class="node-body">
                    <div class="dsp-chain-col dsp-chain-col--pad">
                        <div class="meter-tap-chip" title="Meter tap: POST (output after inserts)">POST</div>
                        <div class="meter-container stereo"><div class="meter meter-l" id="bus-mix${i}-meter"></div><div class="meter meter-r" id="bus-mix${i}-meter-r"></div></div>
                        <div class="dsp-chain">
                            <div class="dsp-block active">EQ</div><div class="dsp-block">INS FX</div>
                        </div>
                    </div>
                    <div class="knob-col">
                        <div id="bus-mix${i}-knob-bal" class="knob knob-pan" style="transform: rotate(0deg);"></div>
                        <div class="knob-label">BAL</div>
                    </div>
                    <div class="faders-group">
                        <div class="fader-col">
                            <input type="range" id="bus-mix${i}-fader-mst" orient="vertical" min="-144" max="10" value="0">
                            <div class="fader-label">LEVEL</div>
                        </div>
                    </div>
                    <div class="faders-group sends-section sends-grid-mix">
                        <!-- ST send: assign ON only (REQUIREMENTS \xA74.8) -->
                        <div class="knob-label">ST</div>
                        <div class="send-on" id="bus-mix${i}-btn-tost">ON</div>
                    </div>
                </div>
                <div class="endpoint-out" id="pt-bus-mix${i}-out"></div>
            </div>`).join("");
    }
  }
  function createStereoBus() {
    const colStereo = document.getElementById("col-stereo");
    if (colStereo) {
      colStereo.innerHTML = `<h2>STEREO<br>BUS${COLLAPSE_TOGGLE}</h2>

            <div class="node" id="bus-stereo">
                <div class="endpoint-in" id="pt-bus-stereo-in"></div>
                <div class="node-header"><div class="node-title">STEREO</div></div>
                <div class="node-body">
                    <div class="dsp-chain-col dsp-chain-col--pad">
                        <div class="meter-tap-chip" title="Meter tap: POST (output after inserts)">POST</div>
                        <div class="meter-container stereo"><div class="meter meter-l" id="bus-stereo-meter"></div><div class="meter meter-r" id="bus-stereo-meter-r"></div></div>
                        <div class="dsp-chain">
                            <div class="dsp-block active">EQ</div><div class="dsp-block">INS FX</div>
                        </div>
                    </div>
                    <div class="knob-col">
                        <div class="knob knob-pan" style="transform: rotate(0deg);"></div>
                        <div class="knob-label">BAL</div>
                    </div>
                    <div class="faders-group">
                        <div class="fader-col">
                            <input type="range" id="bus-stereo-fader-out" orient="vertical" min="-144" max="10" value="0">
                            <div class="fader-label">OUT</div>
                        </div>
                    </div>
                </div>
                <div class="endpoint-out" id="pt-bus-stereo-out"></div>
            </div>`;
    }
  }
  function createLogicalOutputs() {
    const col = document.getElementById("col-logical");
    if (!col) return;
    col.innerHTML = `<h2>Logical<br>Outputs${COLLAPSE_TOGGLE}</h2>
            <div class="node" id="bus-stream">
                <div class="endpoint-in" id="pt-bus-stream-in"></div>
                <div class="node-header">
                    <div><div class="node-title">STREAMING</div><div class="node-subtitle" id="bus-stream-subtitle"></div></div>
                    <div class="src-chip" id="bus-stream-ind-src"></div>
                </div>
                <div class="node-body">
                    <div class="dsp-chain-col dsp-chain-col--center">
                        <div class="dsp-chain">
                            <div class="dsp-block" id="bus-stream-dsp-delay">DELAY</div>
                        </div>
                    </div>
                    <div class="knob-col">
                        <div class="knob-val"></div>
                        <div id="bus-stream-knob-delay" class="knob" style="transform: rotate(-135deg);"></div>
                        <div class="knob-label">DELAY</div>
                    </div>
                    <div class="knob-col">
                        <div class="knob-val" id="bus-stream-frame-rate">--</div>
                        <div class="knob-label">FPS</div>
                    </div>
                    <div class="meter-col meter-col--stack">
                        <div class="meter-tap-chip" title="Meter tap: OUT (output)">OUT</div>
                        <div class="meter-container stereo">
                            <div class="meter meter-l" id="bus-stream-meter"></div>
                            <div class="meter meter-r" id="bus-stream-meter-r"></div>
                        </div>
                    </div>
                </div>
                <div class="endpoint-out" id="pt-bus-stream-out"></div>
            </div>

` + [1, 2].map((i) => `
            <div class="node" id="bus-mon${i}">
                <div class="endpoint-in" id="pt-bus-mon${i}-in"></div>
                <div class="node-header"><div class="node-title">MONITOR ${i}</div><div class="src-chip" id="bus-mon${i}-ind-src"></div></div>
                <div class="node-body">
                    <div class="knob-col">
                        <div id="bus-mon${i}-knob-gain" class="knob" style="transform: rotate(-45deg);"></div>
                        <div class="knob-label">GAIN</div>
                    </div>
                    <div class="dsp-chain-col dsp-chain-col--center">
                        <div class="dsp-chain">
                            <div class="dsp-block" id="bus-mon${i}-cue-int">CUE INT</div><div class="dsp-block" id="bus-mon${i}-mono">MONO</div>
                        </div>
                    </div>
                    <div class="meter-col meter-col--stack">
                        <div class="meter-tap-chip" title="Meter tap: OUT (output)">OUT</div>
                        <div class="meter-container stereo"><div class="meter meter-l" id="bus-mon${i}-meter"></div><div class="meter meter-r" id="bus-mon${i}-meter-r"></div></div>
                    </div>
                </div>
                <div class="endpoint-out" id="pt-bus-mon${i}-out"></div>
            </div>`).join("");
  }
  function createPhysicalOutputs() {
    const col = document.getElementById("col-physical");
    if (!col) return;
    const dawCount = currentModel === "URX22" ? 10 : 12;
    const dawOuts = Array.from({ length: dawCount }, (_, i) => `
            <div class="node node-compact" id="out-daw${i + 1}">
                <div class="endpoint-in" id="pt-out-daw${i + 1}-in"></div>
                <div class="node-header">
                    <div><div class="node-title"><span class="title-break">USB</span> DAW ${i + 1}</div></div>
                </div>
            </div>`).join("");
    col.innerHTML = `<h2>Physical<br>Outputs<label class="section-daw-toggle" title="Show/hide the USB DAW nodes"><span>DAW</span><div class="toggle-track"><div class="toggle-thumb"></div></div></label></h2>
            <div class="node" id="out-main">
                <div class="endpoint-in" id="pt-out-main-in"></div>
                <div class="node-header">
                    <div><div class="node-title">MAIN OUT</div></div>
                    <div class="src-chip" id="out-main-ind-patch"></div>
                </div>
            </div>

            <div class="node" id="out-ph1">
                <div class="endpoint-in" id="pt-out-ph1-in"></div>
                <div class="node-header">
                    <!-- "(+ HEADSET OUT)" is a subtitle, not part of the node
                         name \u2014 the FOCUS VIEW chip shows only "PHONES 1" -->
                    <div><div class="node-title">PHONES 1</div><div class="node-title-sub">(+ HEADSET OUT)</div></div>
                    <div class="src-chip" id="out-ph1-ind-src"></div>
                </div>
                <div class="node-body">
                    <div class="knob-col">
                        <div class="knob-val"></div>
                        <div id="out-ph1-knob-out" class="knob" style="transform: rotate(-135deg);"></div>
                        <div class="knob-label">OUT</div>
                    </div>
                </div>
            </div>

            <div class="node" id="out-ph2">
                <div class="endpoint-in" id="pt-out-ph2-in"></div>
                <div class="node-header">
                    <div><div class="node-title">PHONES 2</div></div>
                    <div class="src-chip" id="out-ph2-ind-src"></div>
                </div>
                <div class="node-body">
                    <div class="knob-col">
                        <div class="knob-val"></div>
                        <div id="out-ph2-knob-out" class="knob" style="transform: rotate(-135deg);"></div>
                        <div class="knob-label">OUT</div>
                    </div>
                </div>
            </div>

            <div class="node" id="out-usba">
                <div class="endpoint-in" id="pt-out-usba-in"></div>
                <div class="node-header">
                    <div><div class="node-title"><span class="title-break">USB</span> MAIN A</div></div>
                    <div class="src-chip" id="out-usba-ind-patch"></div>
                </div>
            </div>

            <div class="node" id="out-usbb">
                <div class="endpoint-in" id="pt-out-usbb-in"></div>
                <div class="node-header">
                    <div><div class="node-title"><span class="title-break">USB</span> MAIN B</div></div>
                    <div class="src-chip" id="out-usbb-ind-patch"></div>
                </div>
            </div>

            <div class="node" id="out-usbc">
                <div class="endpoint-in" id="pt-out-usbc-in"></div>
                <div class="node-header">
                    <div><div class="node-title"><span class="title-break">USB</span> MAIN C</div></div>
                    <div class="src-chip" id="out-usbc-ind-patch"></div>
                </div>
            </div>

            <div class="node" id="out-usbsub">
                <div class="endpoint-in" id="pt-out-usbsub-in"></div>
                <div class="node-header">
                    <div><div class="node-title"><span class="title-break">USB</span> SUB</div></div>
                    <div class="src-chip" id="out-usbsub-ind-patch"></div>
                </div>
            </div>

            ${dawOuts}
        `;
  }
  function createPhysicalInputs() {
    const col = document.getElementById("col-physical-inputs");
    if (!col) return;
    const inputs = [
      { id: "in-port-mic1", title: "MIC/LINE 1" },
      { id: "in-port-mic2", title: "MIC/LINE 2" }
    ];
    if (currentModel !== "URX22") {
      inputs.push({ id: "in-port-mic3", title: "MIC/LINE 3" });
      inputs.push({ id: "in-port-mic4", title: "MIC/LINE 4" });
    }
    inputs.push({ id: "in-port-aux", title: "AUX" });
    inputs.push({ id: "in-port-usba", title: '<span class="title-break">USB</span> MAIN A' });
    inputs.push({ id: "in-port-usbb", title: '<span class="title-break">USB</span> MAIN B' });
    inputs.push({ id: "in-port-usbc", title: '<span class="title-break">USB</span> MAIN C' });
    inputs.push({ id: "in-port-daw12", title: '<span class="title-break">USB</span> DAW 1/2' });
    inputs.push({ id: "in-port-daw34", title: '<span class="title-break">USB</span> DAW 3/4' });
    inputs.push({ id: "in-port-daw56", title: '<span class="title-break">USB</span> DAW 5/6' });
    inputs.push({ id: "in-port-daw78", title: '<span class="title-break">USB</span> DAW 7/8' });
    inputs.push({ id: "in-port-daw910", title: '<span class="title-break">USB</span> DAW 9/10' });
    if (currentModel !== "URX22") {
      inputs.push({ id: "in-port-daw1112", title: '<span class="title-break">USB</span> DAW 11/12' });
    }
    inputs.push({ id: "in-port-usbsub", title: '<span class="title-break">USB</span> SUB' });
    if (currentModel !== "URX22") {
      inputs.push({ id: "in-port-sdplay", title: "SD PLAY" });
    }
    if (currentModel === "URX44V") {
      inputs.push({ id: "in-port-hdmi", title: "HDMI" });
    }
    col.innerHTML = '<h2>Physical<br>Inputs<label class="section-daw-toggle" title="Show/hide the USB DAW nodes"><span>DAW</span><div class="toggle-track"><div class="toggle-thumb"></div></div></label></h2>\n' + inputs.map((input) => `
            <div class="node node-compact" id="${input.id}">
                <div class="node-header">
                    <div><div class="node-title">${input.title}</div></div>
                </div>
                <div class="endpoint-out" id="pt-${input.id}-out"></div>
            </div>`).join("");
  }
  var UIBuilder = {
    setModel(model) {
      currentModel = model;
    },
    getModel() {
      return currentModel;
    },
    buildAll() {
      createPhysicalInputs();
      createInputChannels();
      createMixBuses();
      createStereoBus();
      createLogicalOutputs();
      createPhysicalOutputs();
    }
  };

  // src/app/bootstrap.ts
  function wrapSectionBodies() {
    document.querySelectorAll(".section").forEach((sec) => {
      const existingBody = sec.querySelector(".section-body");
      if (existingBody) {
        existingBody.remove();
      }
      const h2 = sec.querySelector("h2");
      const children = Array.from(sec.childNodes).filter((n) => n !== h2);
      const body = document.createElement("div");
      body.className = "section-body";
      children.forEach((c) => body.appendChild(c));
      sec.appendChild(body);
      updateFade(body);
    });
  }
  function initAppDom() {
    const savedModel = ConfigStore.get("model");
    if (MODEL_IDS.includes(savedModel) && savedModel !== UIBuilder.getModel()) {
      UIBuilder.setModel(savedModel);
      initConnections(savedModel);
    }
    document.getElementById("model-select").value = UIBuilder.getModel();
    UIBuilder.buildAll();
    wrapSectionBodies();
  }

  // src/app/model-switch.ts
  function switchModel(modelId) {
    ConfigStore.set("model", modelId);
    suppressChangeEffects(1500);
    UIBuilder.setModel(modelId);
    UIBuilder.buildAll();
    wrapSectionBodies();
    sizeFixedColumns();
    adjustSectionPadding();
    initConnections(modelId);
    reinitBroker();
    document.dispatchEvent(new CustomEvent(EVENT_MODEL_SWITCHED));
  }
  function initModelSwitch() {
    document.getElementById("model-select").addEventListener("change", (e) => {
      const select = e.target;
      const selectedOpt = select.options[select.selectedIndex];
      const uid = selectedOpt.dataset.uid;
      if (uid) {
        connectToDevice(uid, select.value);
      } else {
        switchModel(select.value);
      }
    });
  }

  // src/data/device-map.ts
  var PORT_TO_NODE = {
    256: "bus-stereo",
    // Stereo Bus L
    257: "bus-stereo",
    // Stereo Bus R
    258: "bus-stream",
    // Streaming Bus L
    259: "bus-stream",
    // Streaming Bus R
    288: "bus-mix1",
    // MIX 1 L
    289: "bus-mix1",
    // MIX 1 R
    290: "bus-mix2",
    // MIX 2 L
    291: "bus-mix2",
    // MIX 2 R
    336: "bus-mon1",
    // MON 1 L
    337: "bus-mon1",
    // MON 1 R
    338: "bus-mon2",
    // MON 2 L
    339: "bus-mon2",
    // MON 2 R
    0: "in-ch1",
    // 入力チャンネル ダイレクト (スロット軸)
    1: "in-ch2",
    2: "in-ch34",
    3: "in-ch34",
    4: "in-ch56",
    5: "in-ch56",
    6: "in-ch78",
    7: "in-ch78",
    8: "in-ch910",
    9: "in-ch910"
  };
  var INPUT_PORT_TO_NODE = {
    0: "in-port-mic1",
    1: "in-port-mic2",
    2: "in-port-mic3",
    3: "in-port-mic4",
    256: "in-port-aux",
    257: "in-port-aux",
    512: "in-port-usba",
    513: "in-port-usba",
    514: "in-port-usbb",
    515: "in-port-usbb",
    516: "in-port-usbc",
    517: "in-port-usbc",
    544: "in-port-daw12",
    545: "in-port-daw12",
    546: "in-port-daw34",
    547: "in-port-daw34",
    548: "in-port-daw56",
    549: "in-port-daw56",
    550: "in-port-daw78",
    551: "in-port-daw78",
    552: "in-port-daw910",
    553: "in-port-daw910",
    554: "in-port-daw1112",
    555: "in-port-daw1112",
    576: "in-port-usbsub",
    577: "in-port-usbsub",
    608: "in-port-sdplay",
    609: "in-port-sdplay",
    624: "in-port-hdmi",
    625: "in-port-hdmi"
  };
  function getMeterAddressForNode(nodeId) {
    if (nodeId === "bus-stereo") return "125:0";
    if (nodeId === "bus-stream") return "127:0";
    if (nodeId === "bus-mix1") return "126:0";
    if (nodeId === "bus-mix2") return "126:2";
    if (nodeId === "bus-mon1") return "129:0";
    if (nodeId === "bus-mon2") return "129:2";
    if (nodeId === "in-ch1") return "115:0";
    if (nodeId === "in-ch2") return "115:1";
    if (nodeId === "in-ch34") return "120:0";
    if (nodeId === "in-ch56") return "120:2";
    if (nodeId === "in-ch78") return "120:4";
    if (nodeId === "in-ch910") return "120:6";
    return null;
  }
  var MAIN_PORTS = [256, 258, 288, 290, 336, 338];
  var USB_PORTS = [256, 258, 288, 290, 336, 338, 0, 1, 2, 4, 6, 8];
  var INPUT_PORTS = [
    // 入力チャンネルの入力元候補
    0,
    1,
    2,
    3,
    256,
    257,
    512,
    513,
    514,
    515,
    516,
    517,
    544,
    545,
    546,
    547,
    548,
    549,
    550,
    551,
    552,
    553,
    554,
    555,
    576,
    577,
    608,
    609,
    624,
    625
  ];
  var PARAM_MAPPINGS = {};
  for (let i = 0; i < 2; i++) {
    const y = i;
    const pfx = `in-ch${i + 1}`;
    Object.assign(PARAM_MAPPINGS, {
      [`${pfx}-knob-gain`]: { paramId: 1, x: 0, y, type: "gain" },
      // アナログゲイン
      [`${pfx}-knob-ch`]: { paramId: 139, x: 0, y, type: "level_knob" },
      // CH フェーダー
      [`${pfx}-knob-pan`]: { paramId: 141, x: 0, y, type: "pan" },
      [`${pfx}-btn-on`]: { paramId: 140, x: 0, y, type: "bool" },
      // CH ON
      [`${pfx}-btn-tost`]: { paramId: 142, x: 0, y, type: "bool" },
      // TO ST アサイン
      [`${pfx}-knob-mix1`]: { paramId: 146, x: 0, y, type: "level_knob" },
      // MIX1 センド
      [`${pfx}-knob-mix1-pan`]: { paramId: 147, x: 0, y, type: "pan" },
      [`${pfx}-send-mix1-on`]: { paramId: 148, x: 0, y, type: "bool" },
      [`${pfx}-send-mix1-pre`]: { paramId: 151, x: 0, y, type: "bool" },
      // PRE/POST
      [`${pfx}-knob-mix2`]: { paramId: 158, x: 0, y, type: "level_knob" },
      // MIX2 センド
      [`${pfx}-knob-mix2-pan`]: { paramId: 159, x: 0, y, type: "pan" },
      [`${pfx}-send-mix2-on`]: { paramId: 160, x: 0, y, type: "bool" },
      [`${pfx}-send-mix2-pre`]: { paramId: 163, x: 0, y, type: "bool" },
      [`${pfx}-send-fx1-pre`]: { paramId: 193, x: 0, y, type: "bool" },
      // FX センド tap (base+0)
      [`${pfx}-knob-fx1`]: { paramId: 194, x: 0, y, type: "level_knob" },
      // FX1 センド
      [`${pfx}-send-fx1-on`]: { paramId: 196, x: 0, y, type: "bool" },
      [`${pfx}-send-fx2-pre`]: { paramId: 197, x: 0, y, type: "bool" },
      [`${pfx}-knob-fx2`]: { paramId: 198, x: 0, y, type: "level_knob" },
      // FX2 センド
      [`${pfx}-send-fx2-on`]: { paramId: 200, x: 0, y, type: "bool" },
      [`${pfx}-dsp-hpf`]: { paramId: 25, x: 0, y, type: "bool" },
      // DSP ブロック
      [`${pfx}-dsp-gate`]: { paramId: 28, x: 0, y, type: "bool" },
      [`${pfx}-dsp-comp`]: { paramId: 34, x: 0, y, type: "bool" },
      [`${pfx}-dsp-eq`]: { paramId: 44, x: 0, y, type: "bool" },
      [`${pfx}-dsp-insfx`]: { paramId: 135, x: 0, y, type: "insertFx" },
      [`${pfx}-dsp-48v`]: { paramId: 0, x: 0, y, type: "bool" },
      // +48V 表示
      [`${pfx}-ind-src`]: { paramId: 22, x: 0, y, type: "portRef", ports: INPUT_PORTS },
      // 入力元
      [`${pfx}-subtitle`]: { paramId: 18, x: 0, y, type: "string" },
      // チャンネル名
      // CH SETTING カラー (キーはノード要素そのもの — 上辺アクセント色に反映)
      [pfx]: { paramId: 20, x: 0, y, type: "chColor" }
    });
    if (i === 1) PARAM_MAPPINGS["in-ch2-dsp-hiz"] = { paramId: 6, x: 0, y: 1, type: "bool" };
  }
  var stereoChs = ["34", "56", "78", "910"];
  var gainOffsets = [9, 13, 14, 15];
  for (let i = 0; i < 4; i++) {
    const y = i;
    const pfx = `in-ch${stereoChs[i]}`;
    Object.assign(PARAM_MAPPINGS, {
      [`${pfx}-knob-gain`]: { paramId: gainOffsets[i], x: 0, y: 0, type: "dgain" },
      [`${pfx}-knob-ch`]: { paramId: 266, x: 0, y, type: "level_knob" },
      [`${pfx}-knob-pan`]: { paramId: 268, x: 0, y, type: "pan" },
      [`${pfx}-btn-on`]: { paramId: 267, x: 0, y, type: "bool" },
      [`${pfx}-btn-tost`]: { paramId: 269, x: 0, y, type: "bool" },
      [`${pfx}-knob-mix1`]: { paramId: 273, x: 0, y, type: "level_knob" },
      [`${pfx}-knob-mix1-pan`]: { paramId: 274, x: 0, y, type: "pan" },
      [`${pfx}-send-mix1-on`]: { paramId: 275, x: 0, y, type: "bool" },
      [`${pfx}-send-mix1-pre`]: { paramId: 278, x: 0, y, type: "bool" },
      [`${pfx}-knob-mix2`]: { paramId: 285, x: 0, y, type: "level_knob" },
      [`${pfx}-knob-mix2-pan`]: { paramId: 286, x: 0, y, type: "pan" },
      [`${pfx}-send-mix2-on`]: { paramId: 287, x: 0, y, type: "bool" },
      [`${pfx}-send-mix2-pre`]: { paramId: 290, x: 0, y, type: "bool" },
      [`${pfx}-send-fx1-pre`]: { paramId: 320, x: 0, y, type: "bool" },
      [`${pfx}-knob-fx1`]: { paramId: 321, x: 0, y, type: "level_knob" },
      [`${pfx}-send-fx1-on`]: { paramId: 323, x: 0, y, type: "bool" },
      [`${pfx}-send-fx2-pre`]: { paramId: 324, x: 0, y, type: "bool" },
      [`${pfx}-knob-fx2`]: { paramId: 325, x: 0, y, type: "level_knob" },
      [`${pfx}-send-fx2-on`]: { paramId: 327, x: 0, y, type: "bool" },
      [`${pfx}-dsp-eq`]: { paramId: 213, x: 0, y, type: "bool" },
      [`${pfx}-dsp-ducker`]: { paramId: 258, x: 0, y, type: "bool" },
      [`${pfx}-ind-src`]: { paramId: 209, x: 0, y, type: "portRef", ports: INPUT_PORTS },
      [`${pfx}-subtitle`]: { paramId: 206, x: 0, y, type: "string" },
      [pfx]: { paramId: 208, x: 0, y, type: "chColor" }
      // CH SETTING カラー
    });
  }
  Object.assign(PARAM_MAPPINGS, {
    // FX バス (y = 0: FX1 / 1: FX2)
    "bus-fx1-knob-bal": { paramId: 339, x: 0, y: 0, type: "pan" },
    "bus-fx1-fader-rtn": { paramId: 337, x: 0, y: 0, type: "level" },
    "bus-fx1-btn-on": { paramId: 338, x: 0, y: 0, type: "bool" },
    "bus-fx1-btn-tost": { paramId: 340, x: 0, y: 0, type: "bool" },
    "bus-fx1-dsp-revx": { paramId: 338, x: 0, y: 0, type: "bool" },
    "bus-fx1-subtitle": { paramId: 333, x: 0, y: 0, type: "string" },
    "bus-fx2-knob-bal": { paramId: 339, x: 0, y: 1, type: "pan" },
    "bus-fx2-fader-rtn": { paramId: 337, x: 0, y: 1, type: "level" },
    "bus-fx2-btn-on": { paramId: 338, x: 0, y: 1, type: "bool" },
    "bus-fx2-btn-tost": { paramId: 340, x: 0, y: 1, type: "bool" },
    "bus-fx2-dsp-delay": { paramId: 338, x: 0, y: 1, type: "bool" },
    "bus-fx2-subtitle": { paramId: 333, x: 0, y: 1, type: "string" },
    // FX チャンネル → MIX センド (y = FX index)。MIX ごとに 10 パラメータの
    // L/R ブロック (L スロットのみ購読; デバイスが R をリンク)。オフセット:
    // tap +0 / level +1 / BAL +2 / on +3 — docs/device-mapping.md §4.3
    "bus-fx1-send-mix1-pre": { paramId: 342, x: 0, y: 0, type: "bool" },
    "bus-fx1-knob-mix1": { paramId: 343, x: 0, y: 0, type: "level_knob" },
    "bus-fx1-knob-mix1-pan": { paramId: 344, x: 0, y: 0, type: "pan" },
    "bus-fx1-send-mix1-on": { paramId: 345, x: 0, y: 0, type: "bool" },
    "bus-fx1-send-mix2-pre": { paramId: 352, x: 0, y: 0, type: "bool" },
    "bus-fx1-knob-mix2": { paramId: 353, x: 0, y: 0, type: "level_knob" },
    "bus-fx1-knob-mix2-pan": { paramId: 354, x: 0, y: 0, type: "pan" },
    "bus-fx1-send-mix2-on": { paramId: 355, x: 0, y: 0, type: "bool" },
    "bus-fx2-send-mix1-pre": { paramId: 342, x: 0, y: 1, type: "bool" },
    "bus-fx2-knob-mix1": { paramId: 343, x: 0, y: 1, type: "level_knob" },
    "bus-fx2-knob-mix1-pan": { paramId: 344, x: 0, y: 1, type: "pan" },
    "bus-fx2-send-mix1-on": { paramId: 345, x: 0, y: 1, type: "bool" },
    "bus-fx2-send-mix2-pre": { paramId: 352, x: 0, y: 1, type: "bool" },
    "bus-fx2-knob-mix2": { paramId: 353, x: 0, y: 1, type: "level_knob" },
    "bus-fx2-knob-mix2-pan": { paramId: 354, x: 0, y: 1, type: "pan" },
    "bus-fx2-send-mix2-on": { paramId: 355, x: 0, y: 1, type: "bool" },
    // MIX バス (L/R リンクのため y は 0/2。R 側 y+1 は逆引きマップで補完される)
    "bus-mix1-knob-bal": { paramId: 676, x: 0, y: 0, type: "pan" },
    "bus-mix1-fader-mst": { paramId: 674, x: 0, y: 0, type: "level" },
    "bus-mix1-btn-on": { paramId: 675, x: 0, y: 0, type: "bool" },
    "bus-mix1-btn-tost": { paramId: 677, x: 0, y: 0, type: "bool" },
    "bus-mix1-dsp-eq": { paramId: 591, x: 0, y: 0, type: "bool" },
    "bus-mix1-dsp-insfx": { paramId: 671, x: 0, y: 0, type: "insertFx" },
    "bus-mix1-subtitle": { paramId: 584, x: 0, y: 0, type: "string" },
    "bus-mix2-knob-bal": { paramId: 676, x: 0, y: 2, type: "pan" },
    "bus-mix2-fader-mst": { paramId: 674, x: 0, y: 2, type: "level" },
    "bus-mix2-btn-on": { paramId: 675, x: 0, y: 2, type: "bool" },
    "bus-mix2-btn-tost": { paramId: 677, x: 0, y: 2, type: "bool" },
    "bus-mix2-dsp-eq": { paramId: 591, x: 0, y: 2, type: "bool" },
    "bus-mix2-dsp-insfx": { paramId: 671, x: 0, y: 2, type: "insertFx" },
    "bus-mix2-subtitle": { paramId: 584, x: 0, y: 2, type: "string" },
    // モニターバス (y = 0: MON1 / 1: MON2)
    "bus-mon1-btn-on": { paramId: 723, x: 0, y: 0, type: "bool" },
    "bus-mon1-cue-int": { paramId: 721, x: 0, y: 0, type: "bool" },
    "bus-mon1-mono": { paramId: 722, x: 0, y: 0, type: "bool" },
    "bus-mon1-knob-gain": { paramId: 724, x: 0, y: 0, type: "dgain" },
    "bus-mon2-btn-on": { paramId: 723, x: 0, y: 1, type: "bool" },
    "bus-mon2-cue-int": { paramId: 721, x: 0, y: 1, type: "bool" },
    "bus-mon2-mono": { paramId: 722, x: 0, y: 1, type: "bool" },
    "bus-mon2-knob-gain": { paramId: 724, x: 0, y: 1, type: "dgain" },
    // STEREO バス / MAIN OUT (同じパラメータを両ノードの UI が共有する)
    "out-main-btn-on": { paramId: 582, x: 0, y: 0, type: "bool" },
    "out-main-knob-bal": { paramId: 583, x: 0, y: 0, type: "pan" },
    "bus-stereo-fader-out": { paramId: 581, x: 0, y: 0, type: "level" },
    "bus-stereo-btn-on": { paramId: 582, x: 0, y: 0, type: "bool" },
    "bus-stereo-knob-bal": { paramId: 583, x: 0, y: 0, type: "pan" },
    "bus-stereo-dsp-eq": { paramId: 498, x: 0, y: 0, type: "bool" },
    "bus-stereo-dsp-insfx": { paramId: 578, x: 0, y: 0, type: "insertFx" },
    // ヘッドホン (y = 0: PHONES1 / 1: PHONES2)
    "out-ph1-knob-out": { paramId: 725, x: 0, y: 0, type: "phonesLevel" },
    "out-ph2-knob-out": { paramId: 725, x: 0, y: 1, type: "phonesLevel" },
    // 出力パッチ / バス入力ソース (portRef)
    "out-main-ind-patch": { paramId: 730, x: 0, y: 0, type: "portRef", ports: MAIN_PORTS },
    "out-usba-ind-patch": { paramId: 732, x: 0, y: 0, type: "portRef", ports: USB_PORTS },
    "out-usbb-ind-patch": { paramId: 733, x: 0, y: 0, type: "portRef", ports: USB_PORTS },
    "out-usbc-ind-patch": { paramId: 734, x: 0, y: 0, type: "portRef", ports: USB_PORTS },
    "out-usbsub-ind-patch": { paramId: 735, x: 0, y: 0, type: "portRef", ports: USB_PORTS },
    "bus-stream-ind-src": { paramId: 705, x: 0, y: 0, type: "portRef", ports: [256, 288, 290] },
    // STREAMING (bus-stream, y = 0): 名前 / DELAY / フレームレート
    // (docs/device-mapping.md §4.4 — 実機確認済み: 名前 702 / DELAY 707・708 / FPS 830)
    "bus-stream-subtitle": { paramId: 702, x: 0, y: 0, type: "string" },
    "bus-stream-dsp-delay": { paramId: 707, x: 0, y: 0, type: "bool" },
    "bus-stream-knob-delay": { paramId: 708, x: 0, y: 0, type: "delayTime" },
    "bus-stream-frame-rate": { paramId: 830, x: 0, y: 0, type: "frameRate" },
    "bus-mon1-ind-src": { paramId: 719, x: 0, y: 0, type: "portRef", ports: [288, 290] },
    "bus-mon2-ind-src": { paramId: 719, x: 0, y: 1, type: "portRef", ports: [288, 290] },
    // バスの CH SETTING カラー (キーはノード要素そのもの — 上辺アクセント色と
    // 下流結線色に反映。docs/device-mapping.md §4.4)。y は各バスの識別スロット:
    // FX = FX index、MIX = L/R ペアの L (MIX1=0 / MIX2=2、R は逆引き補完)、
    // STEREO = 0、STREAMING = 8スロットミラーの先頭。MONITOR にカラーはない。
    "bus-fx1": { paramId: 335, x: 0, y: 0, type: "chColor" },
    "bus-fx2": { paramId: 335, x: 0, y: 1, type: "chColor" },
    "bus-mix1": { paramId: 586, x: 0, y: 0, type: "chColor" },
    "bus-mix2": { paramId: 586, x: 0, y: 2, type: "chColor" },
    "bus-stereo": { paramId: 496, x: 0, y: 0, type: "chColor" },
    "bus-stream": { paramId: 704, x: 0, y: 0, type: "chColor" },
    // グローバル: サンプルレート (ヘッダーのタイトルバー表示、表示のみ)
    "sample-rate": { paramId: 766, x: 0, y: 0, type: "sampleRate" },
    // オシレーター
    "bus-osc-btn-on": { paramId: 710, x: 0, y: 0, type: "bool" },
    "bus-osc-knob-level": { paramId: 711, x: 0, y: 0, type: "level_knob" },
    "bus-osc-knob-freq": { paramId: 713, x: 0, y: 0, type: "freq" },
    "bus-osc-mode-sine": { paramId: 712, x: 0, y: 0, type: "oscMode", value: 0 },
    "bus-osc-mode-pink": { paramId: 712, x: 0, y: 0, type: "oscMode", value: 1 },
    "bus-osc-mode-burst": { paramId: 712, x: 0, y: 0, type: "oscMode", value: 2 },
    "bus-osc-send-stereo-on": { paramId: 716, x: 0, y: 0, type: "bool_stereo_pair", rightY: 1 },
    "bus-osc-send-mix1-on": { paramId: 717, x: 0, y: 0, type: "bool_stereo_pair", rightY: 1 },
    "bus-osc-send-mix2-on": { paramId: 717, x: 0, y: 2, type: "bool_stereo_pair", rightY: 3 },
    "bus-osc-send-fx1-on": { paramId: 718, x: 0, y: 0, type: "bool" },
    "bus-osc-send-fx2-on": { paramId: 718, x: 0, y: 1, type: "bool" }
  });
  var CH_COLOR_PALETTE = [
    { name: "Blue", hex: "#4a78c0" },
    { name: "Orange", hex: "#e8913a" },
    { name: "Yellow", hex: "#d9b441" },
    { name: "Purple", hex: "#8e6fc0" },
    { name: "Cyan", hex: "#3fa6a0" },
    { name: "Magenta", hex: "#c0628f" },
    { name: "Red", hex: "#d9534f" },
    { name: "Green", hex: "#5c9e64" },
    { name: "Light Green", hex: "#8ec46a" },
    { name: "White", hex: "#d8dce0" }
  ];
  function chColorToHex(index) {
    return CH_COLOR_PALETTE[index]?.hex ?? null;
  }
  var REVERSE_PARAM_MAP = {};
  {
    const addReverse = (key, entry) => {
      if (!REVERSE_PARAM_MAP[key]) REVERSE_PARAM_MAP[key] = [];
      REVERSE_PARAM_MAP[key].push(entry);
    };
    for (const [elId, spec] of Object.entries(PARAM_MAPPINGS)) {
      addReverse(`${spec.paramId}:${spec.x}:${spec.y}`, { elId, type: spec.type });
      if ([674, 675, 676, 591, 671, 586].includes(spec.paramId)) {
        addReverse(`${spec.paramId}:${spec.x}:${spec.y + 1}`, { elId, type: spec.type });
      }
      if ([730, 732, 733, 734, 735].includes(spec.paramId)) {
        addReverse(`${spec.paramId}:${spec.x}:${spec.y + 1}`, { elId, type: spec.type });
      }
      if (spec.type === "bool_stereo_pair") {
        addReverse(`${spec.paramId}:${spec.x}:${spec.rightY}`, { elId, type: spec.type });
      }
      if (spec.type === "dgain" && elId.startsWith("in-ch")) {
        addReverse(`${spec.paramId}:${spec.x}:${spec.y + 1}`, { elId, type: spec.type });
      }
      if (spec.paramId === 34) {
        addReverse(`94:0:${spec.y}`, { elId, type: "bool_ssmcs" });
      }
      if (spec.paramId === 44) {
        addReverse(`106:0:${spec.y}`, { elId, type: "bool_ssmcs" });
      }
    }
  }
  var METER_MAPPINGS = {
    "in-ch1-meter": { meterId: 100, x: 0 },
    // INPUT タップ (全 DSP 前、常時有効)
    "in-ch2-meter": { meterId: 100, x: 1 },
    "in-ch34-meter": { meterId: 101, x: 0 },
    // ステレオ INPUT タップ
    "in-ch34-meter-r": { meterId: 101, x: 1 },
    "in-ch56-meter": { meterId: 101, x: 2 },
    "in-ch56-meter-r": { meterId: 101, x: 3 },
    "in-ch78-meter": { meterId: 101, x: 4 },
    "in-ch78-meter-r": { meterId: 101, x: 5 },
    "in-ch910-meter": { meterId: 101, x: 6 },
    "in-ch910-meter-r": { meterId: 101, x: 7 },
    "bus-mix1-meter": { meterId: 126, x: 0 },
    "bus-mix1-meter-r": { meterId: 126, x: 1 },
    "bus-mix2-meter": { meterId: 126, x: 2 },
    "bus-mix2-meter-r": { meterId: 126, x: 3 },
    "bus-stereo-meter": { meterId: 125, x: 0 },
    "bus-stereo-meter-r": { meterId: 125, x: 1 },
    "bus-fx1-meter": { meterId: 118, x: 0 },
    "bus-fx1-meter-r": { meterId: 118, x: 1 },
    "bus-fx2-meter": { meterId: 118, x: 2 },
    "bus-fx2-meter-r": { meterId: 118, x: 3 },
    // PHONES 1/2 のメーターは専用 meterId 未確認のため未登録。
    // PHONES LEVEL を操作しながら受信メッセージを観測して確認後に追加する。
    "bus-mon1-meter": { meterId: 129, x: 0 },
    // PHONES 1 と共用
    "bus-mon1-meter-r": { meterId: 129, x: 1 },
    "bus-mon2-meter": { meterId: 129, x: 2 },
    // PHONES 2 と共用
    "bus-mon2-meter-r": { meterId: 129, x: 3 },
    "bus-stream-meter": { meterId: 127, x: 0 },
    // 確認済み: meters.ts bus.stream
    "bus-stream-meter-r": { meterId: 127, x: 1 }
  };
  var EXTRA_METERS = [
    "125:0",
    "125:1",
    // STEREO
    "127:0",
    // STREAM
    "126:0",
    "126:1",
    "126:2",
    "126:3",
    // MIX 1/2
    "129:0",
    "129:1",
    "129:2",
    "129:3",
    // MON 1/2
    "115:0",
    "115:1",
    // CH 1/2 (ダイレクト用タップ)
    "120:0",
    "120:1",
    "120:2",
    "120:3",
    "120:4",
    "120:5",
    "120:6",
    "120:7",
    // CH 3/4..9/10
    "131:0",
    "131:1"
  ];
  var REVERSE_METER_MAP = {};
  function rebuildReverseMeterMap() {
    for (const key of Object.keys(REVERSE_METER_MAP)) {
      delete REVERSE_METER_MAP[key];
    }
    for (const [elId, spec] of Object.entries(METER_MAPPINGS)) {
      const key = `${spec.meterId}:${spec.x}`;
      if (!REVERSE_METER_MAP[key]) REVERSE_METER_MAP[key] = [];
      REVERSE_METER_MAP[key].push(elId);
    }
  }
  rebuildReverseMeterMap();

  // src/broker/decode.ts
  function vdToGainAngle(value, isAnalog) {
    const minVal = isAnalog ? -800 : -2400;
    const maxVal = isAnalog ? 7e3 : 2400;
    const pct = (value - minVal) / (maxVal - minVal);
    return -135 + pct * 270;
  }
  function vdToPanAngle(value) {
    const pct = (value - -63) / (63 - -63);
    return -135 + pct * 270;
  }
  function vdToLevel(vd) {
    if (vd <= -32768) return -144;
    return vd / 100;
  }
  function vdToPhones(vd) {
    return vd / 10;
  }
  function formatDb(db) {
    return (db > 0 ? "+" : "") + db.toFixed(2) + " dB";
  }
  function formatFaderValue(val) {
    return val <= -144 ? "-inf dB" : formatDb(val);
  }
  function decodeLevelKnob(value) {
    const db = value <= -32768 ? -Infinity : value / 100;
    return { db, text: db <= -144 ? "-inf" : formatDb(db) };
  }
  function decodePanText(value) {
    const panVal = Math.round(value);
    return panVal === 0 ? "C" : panVal < 0 ? "L" + Math.abs(panVal) : "R" + panVal;
  }
  function decodeFreq(value) {
    const hz = value / 10;
    const text = hz >= 1e3 ? (hz / 1e3).toFixed(2) + " kHz" : hz.toFixed(0) + " Hz";
    const pct = (Math.log10(hz) - Math.log10(20)) / (Math.log10(2e4) - Math.log10(20));
    return { angle: -135 + Math.max(0, Math.min(1, pct)) * 270, text };
  }
  function decodePortRefPortId(value) {
    return value & 2147483647;
  }
  function decodeInsertFxActive(value) {
    return value !== 4294967295 && value !== -1;
  }
  function decodeStringValue(value) {
    let valStr = value;
    if (typeof value === "string") {
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          valStr = JSON.parse(value);
        } catch (e) {
          valStr = value.slice(1, -1);
        }
      }
    }
    return valStr;
  }
  function decodeDelayTime(value) {
    const ms = value / 100;
    const clamped = Math.max(1, Math.min(1e3, ms));
    const pct = Math.log10(clamped) / 3;
    return { ms, text: ms.toFixed(2) + " ms", angle: -135 + pct * 270 };
  }
  var DELAY_FRAME_RATE_LABELS = ["24", "25", "29.97D", "29.97", "30D", "30", "60", "120"];
  function decodeFrameRate(value) {
    return DELAY_FRAME_RATE_LABELS[value] ?? String(value);
  }
  function formatSampleRate(hz) {
    if (!Number.isFinite(hz) || hz <= 0) return "--";
    const khz = hz / 1e3;
    return (Number.isInteger(khz) ? String(khz) : khz.toFixed(1)) + " kHz";
  }
  function decodeMeter(rawValue) {
    if (rawValue === 32767) return { db: Infinity, pct: 100 };
    const db = rawValue / 10;
    let pct = 0;
    if (db > -60) {
      pct = (db - -60) / 70 * 100;
    }
    pct = Math.max(0, Math.min(100, pct));
    return { db, pct };
  }

  // src/demo/demo.ts
  var demoState = { running: false };
  var ACTION_INTERVAL_MS = 3e3;
  var METER_INTERVAL_MS = 150;
  var SENDS = ["mix1", "mix2", "fx1", "fx2"];
  var FADERS = ["bus-mix1-fader-mst", "bus-mix2-fader-mst", "bus-fx1-fader-rtn", "bus-fx2-fader-rtn", "bus-stereo-fader-out"];
  var BASELINE_ON = [
    "in-ch1-btn-on",
    "in-ch2-btn-on",
    "in-ch34-btn-on",
    "in-ch56-btn-on",
    "in-ch78-btn-on",
    "in-ch910-btn-on",
    "in-ch1-btn-tost",
    "in-ch2-btn-tost",
    "in-ch34-btn-tost",
    "in-ch78-btn-tost",
    "in-ch1-send-mix1-on",
    "in-ch1-send-fx1-on",
    "in-ch2-send-mix1-on",
    "in-ch2-send-mix2-on",
    "in-ch34-send-mix2-on",
    "in-ch56-send-fx2-on",
    "in-ch910-send-mix1-on",
    "bus-mix1-btn-on",
    "bus-mix2-btn-on",
    "bus-mix1-btn-tost",
    "bus-mix2-btn-tost",
    "bus-fx1-btn-on",
    "bus-fx2-btn-on",
    "bus-fx1-btn-tost",
    "bus-fx2-btn-tost",
    "bus-mon1-btn-on",
    "bus-mon2-btn-on",
    "bus-stereo-btn-on"
  ];
  var PATCH_TARGETS = {
    "out-main": ["bus-stream", "bus-mix1", "bus-mix2", "bus-stereo", "bus-mon1", "bus-mon2"],
    "out-usba": ["bus-stream", "bus-mix1", "bus-mix2", "bus-stereo", "in-ch1", "in-ch34"],
    "out-usbb": ["bus-stream", "bus-mix1", "bus-mix2", "bus-stereo", "in-ch2"],
    "out-usbc": ["bus-stream", "bus-stereo", "in-ch1"],
    "out-usbsub": ["bus-stream", "bus-stereo", "in-ch910"],
    "bus-stream": ["bus-stereo", "bus-mix1", "bus-mix2"],
    "bus-mon1": ["bus-mix1", "bus-mix2", "bus-stereo"],
    "bus-mon2": ["bus-mix1", "bus-mix2", "bus-stereo"],
    "in-ch1": ["in-port-mic1", "in-port-aux", "in-port-usba"],
    "in-ch34": ["in-port-aux", "in-port-usba", "in-port-daw34"]
  };
  var actionTimer = null;
  var meterTimer = null;
  var demoMeters = [];
  function randomOf(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function setLevelKnob(el, db) {
    el.dataset.value = String(db);
    updateKnobElement(el, dbToKnobAngle(db), (db > 0 ? "+" : "") + db.toFixed(1) + " dB");
  }
  function applyBaseline() {
    suppressChangeEffects(1500);
    BASELINE_ON.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("active");
    });
    INPUT_CHANNEL_IDS.forEach((ch) => {
      ["ch", "mix1", "mix2", "fx1", "fx2"].forEach((kind) => {
        const el = document.getElementById(`${ch}-knob-${kind}`);
        if (el) setLevelKnob(el, 0);
      });
    });
    debouncedDrawLines();
  }
  function toggleButton(id) {
    const el = document.getElementById(id);
    if (!el) return;
    updateToggleElement(el, !el.classList.contains("active"));
  }
  function moveFader() {
    const el = document.getElementById(randomOf(FADERS));
    if (!el) return;
    const v = Math.random() < 0.15 ? -144 : Math.random() * 24 - 18;
    el.value = v.toFixed(1);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function turnKnob() {
    const ch = randomOf(INPUT_CHANNEL_IDS);
    if (Math.random() < 0.5) {
      const el = document.getElementById(`${ch}-knob-pan`);
      if (!el) return;
      const pan = Math.round(Math.random() * 126 - 63);
      updateKnobElement(el, vdToPanAngle(pan), decodePanText(pan));
    } else {
      const el = document.getElementById(`${ch}-knob-${randomOf(SENDS)}`);
      if (!el) return;
      const db = Math.random() < 0.2 ? -72 : Math.random() * 22 - 12;
      setLevelKnob(el, db);
      debouncedDrawLines();
    }
    triggerNodeBlink(ch);
  }
  function switchPatch() {
    const target = randomOf(Object.keys(PATCH_TARGETS));
    currentPatches[target] = randomOf(PATCH_TARGETS[target]);
    updatePatchChips();
    triggerNodeBlink(target);
    debouncedDrawLines();
  }
  function randomAction() {
    const r = Math.random();
    if (r < 0.35) {
      const src = Math.random() < 0.8 ? randomOf(INPUT_CHANNEL_IDS) : randomOf(["bus-fx1", "bus-fx2"]);
      const sends = src.startsWith("bus-fx") ? ["mix1", "mix2"] : SENDS;
      toggleButton(`${src}-send-${randomOf(sends)}-on`);
    } else if (r < 0.5) toggleButton(`${randomOf(INPUT_CHANNEL_IDS)}-btn-tost`);
    else if (r < 0.55) toggleButton("bus-osc-btn-on");
    else if (r < 0.7) moveFader();
    else if (r < 0.85) turnKnob();
    else switchPatch();
  }
  function updateDemoMeters() {
    demoMeters.forEach((el) => {
      if (el.dataset.midiDriven === "true") return;
      const level = Math.random() > 0.1 ? Math.floor(Math.random() * 60) + 20 : Math.floor(Math.random() * 10);
      el.style.setProperty("--level", level + "%");
    });
  }
  function startDemo() {
    if (demoState.running) return;
    deviceSync.disconnect();
    demoState.running = true;
    ConfigStore.set("demoMode", true);
    setSyncStatus("Demo Mode", "var(--accent-yellow)");
    document.getElementById("demo-track").classList.add("on");
    setLinesVisible(true);
    applyBaseline();
    demoMeters = Array.from(document.querySelectorAll(".meter"));
    actionTimer = setInterval(randomAction, ACTION_INTERVAL_MS);
    meterTimer = setInterval(updateDemoMeters, METER_INTERVAL_MS);
  }
  function stopDemo() {
    if (!demoState.running) return;
    demoState.running = false;
    ConfigStore.set("demoMode", false);
    if (actionTimer !== null) clearInterval(actionTimer);
    if (meterTimer !== null) clearInterval(meterTimer);
    suppressChangeEffects(1e3);
    setLinesVisible(false);
    document.querySelectorAll(".meter").forEach((el) => {
      if (el.dataset.midiDriven !== "true") el.style.setProperty("--level", "0%");
    });
    setSyncStatus("Disconnected", "var(--text-muted)");
    document.getElementById("demo-track").classList.remove("on");
  }
  function initDemo() {
    document.getElementById("demo-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      if (demoState.running) stopDemo();
      else startDemo();
    });
    document.getElementById("sync-connect-btn").addEventListener("click", () => stopDemo(), true);
    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
      demoMeters = Array.from(document.querySelectorAll(".meter"));
      if (demoState.running) applyBaseline();
    });
    if (new URLSearchParams(location.search).has("demo") || ConfigStore.get("demoMode") === true) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startDemo);
      } else {
        startDemo();
      }
    }
  }

  // src/broker/apply.ts
  var initialSyncDone = false;
  function setInitialSyncDone(v) {
    initialSyncDone = v;
  }
  var lastApplied = /* @__PURE__ */ new Map();
  function resetParamValueCache() {
    lastApplied.clear();
  }
  function sameValue(a, b) {
    if (a === b) return true;
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }
  function applyGainKnob(el, value, isAnalog) {
    updateKnobElement(el, vdToGainAngle(value, isAnalog), formatDb(value / 100));
  }
  var PARAM_APPLIERS = {
    level: (el, value) => {
      el.value = String(vdToLevel(value));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    level_knob: (el, value) => {
      const { db, text } = decodeLevelKnob(value);
      updateKnobElement(el, dbToKnobAngle(db), text);
      el.dataset.value = String(db);
      debouncedDrawLines();
    },
    phonesLevel: (el, value) => {
      const pct = Math.max(0, Math.min(1, value / 100));
      updateKnobElement(el, -135 + pct * 270, vdToPhones(value).toFixed(1));
    },
    gain: (el, value, match) => applyGainKnob(el, value, match.elId.includes("in-ch1") || match.elId.includes("in-ch2")),
    dgain: (el, value) => applyGainKnob(el, value, false),
    pan: (el, value) => updateKnobElement(el, vdToPanAngle(value), decodePanText(value)),
    bool: (el, value) => updateToggleElement(el, value === 1),
    bool_ssmcs: (el, value) => updateToggleElement(el, value === 0),
    bool_stereo_pair: (el, value) => updateToggleElement(el, value === 1),
    insertFx: (el, value) => updateToggleElement(el, decodeInsertFxActive(value)),
    freq: (el, value) => {
      const { angle, text } = decodeFreq(value);
      updateKnobElement(el, angle, text);
    },
    oscMode: (el, value, match) => updateToggleElement(el, value === PARAM_MAPPINGS[match.elId].value),
    string: (el, value) => {
      const valStr = decodeStringValue(value);
      el.textContent = valStr ? `"${valStr}"` : "";
    },
    delayTime: (el, value) => {
      const { angle, text } = decodeDelayTime(value);
      updateKnobElement(el, angle, text);
    },
    frameRate: (el, value) => {
      el.textContent = decodeFrameRate(value);
    },
    sampleRate: (el, value) => {
      el.textContent = formatSampleRate(value);
    },
    chColor: (el, value) => {
      const hex = chColorToHex(value);
      if (hex) {
        el.dataset.chColor = hex;
        el.style.setProperty("border-top-color", hex, "important");
      } else {
        delete el.dataset.chColor;
        el.style.removeProperty("border-top-color");
      }
      setNodeColorOverride(el.id, hex);
      refreshNodeLineColors(el.id);
    }
  };
  function applyPortRef(match, value) {
    const portId = decodePortRefPortId(value);
    const targetNodeId = match.elId.split("-ind-")[0];
    const isInput = match.elId.startsWith("in-ch");
    const sourceNodeId = isInput ? INPUT_PORT_TO_NODE[portId] : PORT_TO_NODE[portId];
    currentPatches[targetNodeId] = sourceNodeId ?? null;
    updatePatchChips();
    debouncedDrawLines();
  }
  function blinkAndScrollToNode(node) {
    const offPath = !!viewState.activeNodeId && !node.classList.contains("active-node");
    const skipBlink = offPath && viewState.focusEffectsPathOnly;
    const skipScroll = offPath && viewState.focusScrollPathOnly;
    const triggerBlink = () => {
      if (!skipBlink) triggerNodeBlink(node.id);
    };
    if (appState.scrollToChangeEnabled && !skipScroll) {
      const scroll = scrollToNodes([node.id]);
      if (scroll.scrolled > 0) {
        scroll.done.then(triggerBlink);
      } else {
        triggerBlink();
      }
    } else {
      triggerBlink();
    }
  }
  function handleParamUpdate(addr, value) {
    const matches = REVERSE_PARAM_MAP[addr];
    if (!matches) {
      return;
    }
    for (const match of matches) {
      if (match.type === "portRef") applyPortRef(match, value);
      const el = document.getElementById(match.elId);
      if (!el) continue;
      const prev = lastApplied.get(match.elId);
      const changed = !prev || prev.addr !== addr || !sameValue(prev.value, value);
      lastApplied.set(match.elId, { addr, value });
      const node = el.closest(".node");
      if (node && initialSyncDone && changed) blinkAndScrollToNode(node);
      if (match.type !== "portRef") PARAM_APPLIERS[match.type](el, value, match);
    }
  }
  function handleMeterUpdate(addr, rawValue) {
    const elIds = REVERSE_METER_MAP[addr];
    if (elIds) {
      elIds.forEach((elId) => updateMeterElement(elId, rawValue));
    }
    const usbNodes = ["out-usba", "out-usbb", "out-usbc", "out-usbsub"];
    for (const usbNode of usbNodes) {
      const patchedSource = currentPatches[usbNode];
      if (patchedSource) {
        const sourceMeterAddr = getMeterAddressForNode(patchedSource);
        if (sourceMeterAddr === addr) {
          updateMeterElement(`${usbNode}-meter`, rawValue);
        }
      }
    }
  }
  function updateMeterElement(elId, rawValue) {
    const el = document.getElementById(elId);
    if (!el) return;
    const { db, pct } = decodeMeter(rawValue);
    el.style.setProperty("--level", pct + "%");
    if (db > 0) {
      const container2 = el.parentElement;
      let overEl = container2.querySelector(".over-chip");
      if (!overEl) {
        overEl = document.createElement("div");
        overEl.className = "over-chip";
        overEl.textContent = "OVER";
        container2.appendChild(overEl);
      }
      overEl.classList.add("active");
      if (overEl.dataset.timeoutId) {
        clearTimeout(parseInt(overEl.dataset.timeoutId));
      }
      const tid = setTimeout(() => {
        overEl.classList.remove("active");
      }, 3e3);
      overEl.dataset.timeoutId = String(tid);
    }
  }

  // src/broker/dynamic-ids.ts
  function applyCategoryClass(node, nodeId) {
    const cat = getNodeCategory(nodeId);
    if (cat) node.classList.add(cat.className);
  }
  function ensureMeterId(node, nodeId) {
    const meter = node.querySelector(".meter");
    if (meter && !meter.id) {
      meter.id = `${nodeId}-meter`;
    }
  }
  function ensureSubtitle(node, nodeId) {
    let subtitle = node.querySelector(".node-subtitle");
    if (!subtitle && (nodeId.startsWith("in-ch") || nodeId.startsWith("bus-mix") || nodeId.startsWith("bus-fx"))) {
      const header = node.querySelector(".node-header");
      if (header) {
        subtitle = document.createElement("div");
        subtitle.className = "node-subtitle";
        header.appendChild(subtitle);
      }
    }
    if (subtitle && !subtitle.id) {
      subtitle.id = `${nodeId}-subtitle`;
    }
  }
  function renameMixFxKnobToBal(node, nodeId) {
    if (!nodeId.startsWith("bus-mix")) return;
    const knob = node.querySelector(".knob");
    const label = node.querySelector(".knob-label");
    if (knob && label) {
      knob.id = `${nodeId}-knob-bal`;
      knob.className = "knob knob-pan";
      label.textContent = "BAL";
    }
  }
  function slugifyLabel(text) {
    return text.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function assignDspBlockIds(node, nodeId) {
    node.querySelectorAll(".dsp-block").forEach((block) => {
      if (!block.id) {
        block.id = `${nodeId}-dsp-${slugifyLabel(block.textContent)}`;
      }
    });
  }
  function assignIndicatorIds(node, nodeId) {
    node.querySelectorAll(".indicator").forEach((ind) => {
      if (!ind.id) {
        let name = ind.textContent.trim().toLowerCase();
        if (name.startsWith("patch:")) name = "patch";
        else if (name.startsWith("link:")) name = "link";
        else if (name.startsWith("direct:")) name = "direct";
        else name = slugifyLabel(name);
        ind.id = `${nodeId}-ind-${name}`;
      }
    });
  }
  function setupSliders(node, nodeId) {
    node.querySelectorAll('input[type="range"]').forEach((input) => {
      if (!input.id) {
        const labelEl = input.parentElement.querySelector(".fader-label");
        const label = labelEl ? slugifyLabel(labelEl.textContent) : "val";
        input.id = `${nodeId}-fader-${label}`;
      }
      input.setAttribute("step", "0.1");
      let valEl = input.parentElement.querySelector(".fader-val");
      if (!valEl) {
        valEl = document.createElement("div");
        valEl.className = "fader-val";
        input.parentElement.appendChild(valEl);
      }
      const renderValue = () => setValueLabel(valEl, formatFaderValue(parseFloat(input.value)));
      renderValue();
      input.addEventListener("input", () => {
        renderValue();
        debouncedDrawLines();
      });
    });
  }
  function setupKnobs(node, nodeId) {
    node.querySelectorAll(".knob").forEach((knob) => {
      if (!knob.id) {
        const labelEl = knob.parentElement.querySelector(".knob-label");
        const label = labelEl ? slugifyLabel(labelEl.textContent) : "val";
        knob.id = `${nodeId}-knob-${label}`;
      }
      if (!knob.parentElement.querySelector(".knob-val")) {
        const valDiv = document.createElement("div");
        valDiv.className = "knob-val";
        valDiv.textContent = "--";
        knob.parentElement.appendChild(valDiv);
      }
    });
  }
  function makeSendMeta(children) {
    const metaDiv = document.createElement("div");
    metaDiv.className = "send-meta";
    metaDiv.append(...children);
    return metaDiv;
  }
  function makeToggleSpan(className, id, label) {
    const span = document.createElement("span");
    span.className = className;
    span.id = id;
    span.textContent = label;
    return span;
  }
  function injectBusMasterControls(node, nodeId) {
    if (!["bus-mix1", "bus-mix2", "bus-stereo", "bus-fx1", "bus-fx2"].includes(nodeId)) return;
    if (document.getElementById(`${nodeId}-btn-on`)) return;
    const faderCol = node.querySelector(".fader-col");
    if (!faderCol) return;
    const metaDiv = makeSendMeta([makeToggleSpan("send-on", `${nodeId}-btn-on`, "ON")]);
    faderCol.insertBefore(metaDiv, faderCol.firstChild);
  }
  function injectMonitorOnButton(node, nodeId) {
    if (nodeId !== "bus-mon1" && nodeId !== "bus-mon2") return;
    if (document.getElementById(`${nodeId}-btn-on`)) return;
    const meter = node.querySelector(".meter-container");
    if (!meter) return;
    const metaDiv = makeSendMeta([makeToggleSpan("send-on", `${nodeId}-btn-on`, "ON")]);
    meter.insertAdjacentElement("afterend", metaDiv);
  }
  function injectMainOutControls(node, nodeId) {
    if (nodeId !== "out-main") return;
    const faderRow = node.querySelector(".fader-row");
    if (!faderRow || document.getElementById("out-main-btn-on")) return;
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "mainout-ctrls";
    const knobCol = document.createElement("div");
    knobCol.className = "knob-col knob-col--flush";
    const knob = document.createElement("div");
    knob.id = "out-main-knob-bal";
    knob.className = "knob knob-pan";
    knob.style.transform = "rotate(0deg)";
    const label = document.createElement("div");
    label.className = "knob-label";
    label.textContent = "BAL";
    knobCol.appendChild(knob);
    knobCol.appendChild(label);
    controlsDiv.appendChild(knobCol);
    controlsDiv.appendChild(makeToggleSpan("send-on send-on--sm", "out-main-btn-on", "ON"));
    faderRow.parentNode.insertBefore(controlsDiv, faderRow);
  }
  function injectInputSendToggles(node, nodeId) {
    node.querySelectorAll(".faders-group .fader-col").forEach((faderCol) => {
      const rangeInput = faderCol.querySelector('input[type="range"]');
      if (!rangeInput || !rangeInput.id) return;
      if (!nodeId.startsWith("in-ch")) return;
      const matches = rangeInput.id.match(/-fader-(mix1|mix2|fx1|fx2)$/);
      if (!matches) return;
      const type = matches[1];
      if (!faderCol.querySelector(".send-meta")) {
        const toggles = [makeToggleSpan("send-on", `${nodeId}-send-${type}-on`, "ON")];
        if (type.startsWith("mix")) {
          toggles.push(makeToggleSpan("send-pre", `${nodeId}-send-${type}-pre`, "PRE"));
        }
        faderCol.insertBefore(makeSendMeta(toggles), faderCol.firstChild);
      }
    });
  }
  function assignDynamicIds() {
    document.querySelectorAll(".node").forEach((node) => {
      const nodeId = node.id;
      if (!nodeId) return;
      applyCategoryClass(node, nodeId);
      ensureMeterId(node, nodeId);
      ensureSubtitle(node, nodeId);
      renameMixFxKnobToBal(node, nodeId);
      assignDspBlockIds(node, nodeId);
      assignIndicatorIds(node, nodeId);
      setupSliders(node, nodeId);
      setupKnobs(node, nodeId);
      injectBusMasterControls(node, nodeId);
      injectMonitorOnButton(node, nodeId);
      injectMainOutControls(node, nodeId);
      injectInputSendToggles(node, nodeId);
    });
  }

  // src/broker/hooks.ts
  var hooks = null;
  function registerTrafficHooks(h) {
    hooks = h;
  }
  function trafficHooks() {
    return hooks;
  }

  // src/broker/socket.ts
  function resetModelOptions(select) {
    select.innerHTML = MODEL_IDS.map((m) => `<option value="${m}">${m}</option>`).join("");
  }
  var OSC_MODE_VALUES = { sine: 0, pink: 1, burst: 2 };
  var ws = null;
  var devUid = null;
  var isConnected = false;
  var deviceModel = "URX";
  var syncedUid = null;
  var initialSyncTimer = null;
  var syncReleaseTimer = null;
  function clearConnectionTimers() {
    if (initialSyncTimer) {
      clearTimeout(initialSyncTimer);
      initialSyncTimer = null;
    }
    if (syncReleaseTimer) {
      clearTimeout(syncReleaseTimer);
      syncReleaseTimer = null;
    }
  }
  var connectBtn;
  var statusDiv;
  var statusDot;
  function setSyncStatus(text, color) {
    statusDiv.textContent = text;
    statusDiv.style.color = color;
    if (statusDot) statusDot.style.background = color;
  }
  function setDeviceStatus(text, color) {
    if (!demoState.running) setSyncStatus(text, color);
  }
  function reinitBroker() {
    initializeSvgPaths();
    assignDynamicIds();
    sizeFixedColumns();
    debouncedDrawLines();
  }
  function connect() {
    if (demoState.running) return;
    if (ws) {
      const old = ws;
      ws = null;
      old.close();
    }
    clearConnectionTimers();
    const sock = new WebSocket("ws://127.0.0.1:51780/casket");
    ws = sock;
    sock.onopen = () => {
      if (sock !== ws) return;
      if (demoState.running) {
        disconnect();
        return;
      }
      console.log("[Device Center] Connected");
      setSyncStatus("Device Connected", "var(--accent-green)");
      setInitialSyncDone(false);
      initialSyncTimer = setTimeout(() => {
        initialSyncTimer = null;
        setInitialSyncDone(true);
      }, 1500);
      sendJson({ jsonrpc: "1.0", method: "getDeviceList" });
    };
    sock.onmessage = (event) => {
      if (sock !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        const hooks2 = trafficHooks();
        if (hooks2) hooks2.rx(msg);
        handleMessage(msg);
      } catch (err) {
        console.error("Error parsing WS frame:", err);
      }
    };
    sock.onerror = (err) => {
      if (sock !== ws) return;
      console.error("WebSocket connection error:", err);
      setDeviceStatus("Connection Error", "var(--accent-red, #f85149)");
      disconnect();
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      ws = null;
      disconnectCleanup();
    };
  }
  function disconnect() {
    if (ws) {
      if (devUid && isConnected) {
        unsubscribeAll();
      }
      const sock = ws;
      ws = null;
      sock.close();
    }
    disconnectCleanup();
  }
  function disconnectCleanup() {
    isConnected = false;
    devUid = null;
    syncedUid = null;
    clearConnectionTimers();
    setSyncingInitial(false);
    resetParamValueCache();
    connectBtn.textContent = "Connect";
    connectBtn.style.background = "var(--accent-blue, #58a6ff)";
    if (!demoState.running) {
      setSyncStatus("Disconnected", "var(--text-muted)");
      setLinesVisible(false);
    }
    const select = document.getElementById("model-select");
    if (select) {
      const currentVal = select.value;
      resetModelOptions(select);
      select.value = currentVal;
    }
    document.querySelectorAll(".meter").forEach((m) => {
      delete m.dataset.midiDriven;
    });
    const rateEl = document.getElementById("sample-rate");
    if (rateEl) rateEl.textContent = "--";
    const fwEl = document.getElementById("firmware-version");
    if (fwEl) fwEl.textContent = "--";
    for (const set of Object.values(devSubs)) set.clear();
    notifySubsChanged();
    debouncedDrawLines();
  }
  function connectToDevice(uid, model) {
    devUid = uid;
    deviceModel = model;
    syncedUid = null;
    switchModel(model);
    requestVD("get", "/vd/synchronize");
  }
  function sendJson(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      const hooks2 = trafficHooks();
      if (hooks2) hooks2.tx(obj);
    }
  }
  function handleDeviceList(list) {
    const select = document.getElementById("model-select");
    if (select) {
      if (list.length === 0) {
        resetModelOptions(select);
        select.value = deviceModel;
      } else {
        select.innerHTML = "";
        list.forEach((dev) => {
          const opt = document.createElement("option");
          opt.value = dev.model || "URX44V";
          opt.dataset.uid = dev.dev_uid;
          const shortUid = String(dev.dev_uid).replace(/[{}]/g, "").substring(0, 8);
          opt.textContent = `${dev.model || "URX"} (${shortUid})`;
          select.appendChild(opt);
        });
      }
    }
    if (list.length === 0) {
      setDeviceStatus("No Device Connected", "var(--accent-red, #f85149)");
      disconnect();
      return;
    }
    const device = list[0];
    devUid = device.dev_uid;
    deviceModel = device.model || "URX";
    if (select) {
      select.value = deviceModel;
    }
    syncedUid = null;
    switchModel(deviceModel);
    requestVD("get", "/vd/synchronize");
  }
  function handleDeviceInfo(data) {
    const list = Array.isArray(data.firm_list) ? data.firm_list : [];
    const system = list.find((f) => String(f?.firm_name ?? "").toLowerCase() === "system");
    const version = system ? String(system.firm_version ?? "") : "";
    const fwEl = document.getElementById("firmware-version");
    if (fwEl) fwEl.textContent = version ? `FW ${version}` : "--";
  }
  function handleSyncStatus(data) {
    if (data.sync_status !== "online") {
      setDeviceStatus(`Device Offline (${data.sync_status || "offline"})`, "var(--accent-red, #f85149)");
      disconnect();
      return;
    }
    if (isConnected && syncedUid === devUid) return;
    syncedUid = devUid;
    isConnected = true;
    setSyncingInitial(true);
    suppressChangeEffects(2e3);
    ConfigStore.set("autoConnect", true);
    connectBtn.textContent = "Disconnect";
    connectBtn.style.background = "var(--accent-red, #f85149)";
    setSyncStatus("Connected", "var(--accent-green, #3fb950)");
    setLinesVisible(true);
    const allMeters = [
      "in-ch1-meter",
      "in-ch2-meter",
      "in-ch34-meter",
      "in-ch56-meter",
      "in-ch78-meter",
      "in-ch910-meter",
      "bus-mix1-meter",
      "bus-mix2-meter",
      "bus-fx1-meter",
      "bus-fx2-meter",
      "out-main-meter",
      "out-ph1-meter",
      "out-ph2-meter",
      "out-usba-meter",
      "out-usbb-meter",
      "out-usbc-meter",
      "out-usbsub-meter"
    ];
    for (const elId of allMeters) {
      const el = document.getElementById(elId);
      if (el) el.dataset.midiDriven = "true";
    }
    subscribeAll();
    fetchInitialState();
    requestVD("get", "/vd/device");
    if (syncReleaseTimer) clearTimeout(syncReleaseTimer);
    syncReleaseTimer = setTimeout(() => {
      syncReleaseTimer = null;
      setSyncingInitial(false);
      debouncedDrawLines();
    }, 400);
  }
  function handleMessage(msg) {
    if (msg.method === "getDeviceList" || msg.result?.params?.list) {
      handleDeviceList(msg.params?.list || msg.result?.params?.list || []);
      return;
    }
    const vdp = msg.params?.vdp || msg.result?.vdp;
    if (!vdp) return;
    const uri = vdp.uri || "";
    const data = vdp.data || {};
    const path = uri.split("?")[0];
    if (path === "/vd/device") {
      handleDeviceInfo(data);
      return;
    }
    if (path === "/vd/synchronize") {
      handleSyncStatus(data);
      return;
    }
    if (vdp.method === "notify" && uri === "/vd/synchronize" && data.sync_status !== "online") {
      setDeviceStatus("Device Lost", "var(--accent-red, #f85149)");
      disconnect();
      return;
    }
    const value = data.current_value;
    if (value === void 0) return;
    if (uri.startsWith("/vd/parameters/")) {
      const addr = uri.replace("/vd/parameters/", "").split("?")[0];
      handleParamUpdate(addr, value);
    } else if (uri.startsWith("/vd/meters/")) {
      const addr = uri.replace("/vd/meters/", "").split("?")[0];
      handleMeterUpdate(addr, value);
    }
  }
  function requestVD(method, uri, data = null) {
    if (!devUid) return;
    const req = {
      jsonrpc: "1.0",
      method: "requestVD",
      params: {
        dev_uid: devUid,
        vdp: { method, uri }
      }
    };
    if (data) {
      req.params.vdp.data = data;
    }
    sendJson(req);
  }
  function sendSetParameter(addr, value) {
    sendJson({
      jsonrpc: "1.0",
      method: "setParameter",
      params: {
        vdp: {
          uri: `/vd/parameters/${addr}`,
          data: { current_value: value }
        }
      }
    });
  }
  function forEachParamKey(callback) {
    const seen = /* @__PURE__ */ new Set();
    for (const spec of Object.values(PARAM_MAPPINGS)) {
      const key = `${spec.paramId}:${spec.x}:${spec.y}`;
      if (!seen.has(key)) {
        seen.add(key);
        callback(key);
      }
    }
  }
  function fetchInitialState() {
    forEachParamKey((key) => requestVD("get", `/vd/parameters/${key}`));
  }
  function forEachSubscriptionKey(callback) {
    forEachParamKey((key) => callback("parameters", key));
    for (const spec of Object.values(METER_MAPPINGS)) {
      callback("meters", `${spec.meterId}:${spec.x}`);
    }
    for (const key of EXTRA_METERS) {
      callback("meters", key);
    }
  }
  var devSubs = { parameters: /* @__PURE__ */ new Set(), meters: /* @__PURE__ */ new Set() };
  function notifySubsChanged() {
    const hooks2 = trafficHooks();
    if (hooks2 && hooks2.subs) hooks2.subs(devSubs);
  }
  function subscribeAll() {
    forEachSubscriptionKey((kind, key) => {
      requestVD("post", `/vd/${kind}/${key}?operation=regist`);
      devSubs[kind].add(key);
    });
    notifySubsChanged();
  }
  function unsubscribeAll() {
    forEachSubscriptionKey((kind, key) => {
      requestVD("post", `/vd/${kind}/${key}?operation=unregist`);
      devSubs[kind].delete(key);
    });
    notifySubsChanged();
  }
  function unsubscribeAllTracked() {
    for (const [kind, set] of Object.entries(devSubs)) {
      for (const key of set) {
        requestVD("post", `/vd/${kind}/${key}?operation=unregist`);
      }
      set.clear();
    }
  }
  var deviceSync = {
    isConnected: () => isConnected,
    disconnect: () => disconnect(),
    getSubscriptions: () => devSubs,
    // Dev-mode "Clear All": unregister everything currently tracked and
    // leave nothing subscribed
    clearAllSubscriptions: () => {
      if (!devUid) return false;
      unsubscribeAllTracked();
      notifySubsChanged();
      return true;
    },
    // Dev-mode "Restore Default": unregister everything currently tracked,
    // then re-register the mapped defaults — the state a fresh connection
    // starts with.
    restoreDefaultSubscriptions: () => {
      if (!devUid) return false;
      unsubscribeAllTracked();
      subscribeAll();
      return true;
    },
    // Manual (un)subscribe for the dev-mode SUBSCRIBE panel; accepts a
    // single key or an array (bulk range registration). The kind may be
    // ANY VD resource ('parameters' / 'meters' / 'version' / ...) — the
    // URI is /vd/{kind}/{key} either way. Returns false while no device
    // connection exists (nothing is sent then).
    subscribe: (kind, keys, on) => {
      const k = kind === "param" ? "parameters" : kind === "meter" ? "meters" : kind;
      if (!devUid) return false;
      if (!devSubs[k]) devSubs[k] = /* @__PURE__ */ new Set();
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        requestVD("post", `/vd/${k}/${key}?operation=${on ? "regist" : "unregist"}`);
        if (on) devSubs[k].add(key);
        else devSubs[k].delete(key);
      });
      notifySubsChanged();
      return true;
    }
  };
  function init() {
    initializeSvgPaths();
    assignDynamicIds();
    sizeFixedColumns();
    debouncedDrawLines();
    connectBtn = document.getElementById("sync-connect-btn");
    statusDiv = document.getElementById("sync-status");
    statusDot = document.getElementById("sync-status-dot");
    connectBtn.addEventListener("click", () => {
      if (isConnected) {
        ConfigStore.set("autoConnect", false);
        disconnect();
      } else {
        connect();
      }
    });
    if (ConfigStore.get("autoConnect") === true) {
      connect();
    }
    document.body.addEventListener("click", (e) => {
      const el = e.target.closest(".send-on, .send-pre, .dsp-block");
      if (!el || !el.id) return;
      e.stopPropagation();
      if (el.id.startsWith("bus-osc-mode-")) {
        const mode = el.id.replace("bus-osc-mode-", "");
        const val = OSC_MODE_VALUES[mode] ?? 0;
        document.querySelectorAll('#bus-osc [id^="bus-osc-mode-"]').forEach((btn) => {
          btn.classList.toggle("active", btn.id === el.id);
        });
        if (isConnected && ws && ws.readyState === WebSocket.OPEN) {
          sendSetParameter("712:0:0", val);
        }
        debouncedDrawLines();
        return;
      }
      el.classList.toggle("active");
      debouncedDrawLines();
      const spec = PARAM_MAPPINGS[el.id];
      if (spec && isConnected && ws && ws.readyState === WebSocket.OPEN) {
        const newValue = el.classList.contains("active");
        let vdVal = 0;
        if (spec.type === "bool") {
          vdVal = newValue ? 1 : 0;
        } else if (spec.type === "bool_ssmcs") {
          vdVal = newValue ? 0 : 1;
        } else if (spec.type === "insertFx") {
          vdVal = newValue ? 0 : 4294967295;
        } else if (spec.type === "bool_stereo_pair") {
          vdVal = newValue ? 1 : 0;
          sendSetParameter(`${spec.paramId}:${spec.x}:${spec.y}`, vdVal);
          sendSetParameter(`${spec.paramId}:${spec.x}:${spec.rightY}`, vdVal);
          return;
        }
        sendSetParameter(`${spec.paramId}:${spec.x}:${spec.y}`, vdVal);
      }
    });
  }
  function initBroker() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // src/data/meter-taps.ts
  var monoTaps = (i) => [
    { key: "input", label: "INPUT", l: [100, i] },
    { key: "pregate", label: "PRE GATE", l: [106, i] },
    { key: "precomp", label: "PRE COMP", l: [108, i] },
    { key: "preeq", label: "PRE EQ", l: [111, i] },
    { key: "preinsfx", label: "PRE INS FX", l: [112, i] },
    { key: "prefader", label: "PRE FADER", l: [113, i] },
    { key: "post", label: "POST", l: [115, i] }
  ];
  var stereoTaps = (p) => [
    { key: "input", label: "INPUT", l: [101, 2 * p], r: [101, 2 * p + 1] },
    { key: "prefader", label: "PRE FADER", l: [114, 2 * p], r: [114, 2 * p + 1] },
    { key: "preducker", label: "PRE DUCKER", l: [116, 2 * p], r: [116, 2 * p + 1] },
    { key: "post", label: "POST", l: [120, 2 * p], r: [120, 2 * p + 1] }
  ];
  var busTaps = (sum, postEq, postFader, postInsfx, x) => [
    { key: "preeq", label: "PRE EQ", l: [sum, x], r: [sum, x + 1] },
    { key: "prefader", label: "PRE FADER", l: [postEq, x], r: [postEq, x + 1] },
    { key: "preinsfx", label: "PRE INS FX", l: [postFader, x], r: [postFader, x + 1] },
    { key: "post", label: "POST", l: [postInsfx, x], r: [postInsfx, x + 1] }
  ];
  var fxTaps = (i) => [
    { key: "prefader", label: "PRE FADER", l: [131, i] },
    { key: "post", label: "POST", l: [118, 2 * i], r: [118, 2 * i + 1] }
  ];
  var NODE_METER_TAPS = {
    "in-ch1": monoTaps(0),
    "in-ch2": monoTaps(1),
    "in-ch34": stereoTaps(0),
    "in-ch56": stereoTaps(1),
    "in-ch78": stereoTaps(2),
    "in-ch910": stereoTaps(3),
    "bus-stereo": busTaps(104, 121, 123, 125, 0),
    "bus-mix1": busTaps(105, 122, 124, 126, 0),
    "bus-mix2": busTaps(105, 122, 124, 126, 2),
    "bus-fx1": fxTaps(0),
    "bus-fx2": fxTaps(1),
    "bus-stream": [{ key: "out", label: "OUT", l: [127, 0], r: [127, 1] }],
    "bus-mon1": [{ key: "out", label: "OUT", l: [129, 0], r: [129, 1] }],
    "bus-mon2": [{ key: "out", label: "OUT", l: [129, 2], r: [129, 3] }]
  };
  function defaultTapKey(nodeId) {
    if (nodeId.startsWith("in-ch")) return "input";
    const taps = NODE_METER_TAPS[nodeId];
    return taps && taps.some((t2) => t2.key === "post") ? "post" : "out";
  }
  var state = {};
  function currentTap(nodeId) {
    const taps = NODE_METER_TAPS[nodeId];
    if (!taps || taps.length === 0) return null;
    const key = state[nodeId] ?? defaultTapKey(nodeId);
    return taps.find((t2) => t2.key === key) ?? taps[0];
  }
  function applyTap(nodeId) {
    const tap = currentTap(nodeId);
    if (!tap) return;
    if (METER_MAPPINGS[`${nodeId}-meter`]) {
      METER_MAPPINGS[`${nodeId}-meter`] = { meterId: tap.l[0], x: tap.l[1] };
    }
    if (METER_MAPPINGS[`${nodeId}-meter-r`]) {
      const r = tap.r ?? tap.l;
      METER_MAPPINGS[`${nodeId}-meter-r`] = { meterId: r[0], x: r[1] };
    }
  }
  function updateChip(nodeId) {
    const chip = document.querySelector(`#${nodeId} .meter-tap-chip`);
    const tap = currentTap(nodeId);
    if (!chip || !tap) return;
    chip.textContent = tap.label;
    const taps = NODE_METER_TAPS[nodeId];
    if (taps.length > 1) {
      setTooltip(
        chip,
        "Meter tap: {label} (click to cycle: {cycle})",
        { label: tap.label, cycle: taps.map((t2) => t2.label).join(" \u2192 ") }
      );
    } else {
      setTooltip(chip, "Meter tap: {label}", { label: tap.label });
    }
    chip.classList.toggle("meter-tap-chip--fixed", taps.length <= 1);
  }
  function refreshChips() {
    Object.keys(NODE_METER_TAPS).forEach(updateChip);
  }
  function tapAddrs(tap) {
    return [tap.l, tap.r].filter((a) => !!a).map(([id, x]) => `${id}:${x}`);
  }
  function cycleMeterTap(nodeId) {
    const taps = NODE_METER_TAPS[nodeId];
    if (!taps || taps.length < 2) return;
    const cur = currentTap(nodeId);
    const next = taps[(taps.findIndex((t2) => t2.key === cur.key) + 1) % taps.length];
    state[nodeId] = next.key;
    ConfigStore.set("meterTaps", state);
    applyTap(nodeId);
    rebuildReverseMeterMap();
    updateChip(nodeId);
    [`${nodeId}-meter`, `${nodeId}-meter-r`].forEach((id) => {
      document.getElementById(id)?.style.setProperty("--level", "0%");
    });
    const nextAddrs = tapAddrs(next);
    const stillNeeded = /* @__PURE__ */ new Set([
      ...Object.values(METER_MAPPINGS).map((m) => `${m.meterId}:${m.x}`),
      // every node's current tap
      ...EXTRA_METERS
    ]);
    const stale = tapAddrs(cur).filter((a) => !stillNeeded.has(a) && !nextAddrs.includes(a));
    if (stale.length) deviceSync.subscribe("meters", stale, false);
    deviceSync.subscribe("meters", nextAddrs, true);
    sizeFixedColumns();
  }
  function initMeterTaps() {
    const saved = ConfigStore.get("meterTaps");
    if (saved && typeof saved === "object") {
      for (const [nodeId, key] of Object.entries(saved)) {
        if (typeof key === "string" && NODE_METER_TAPS[nodeId]?.some((t2) => t2.key === key)) {
          state[nodeId] = key;
        }
      }
    }
    Object.keys(NODE_METER_TAPS).forEach(applyTap);
    rebuildReverseMeterMap();
    refreshChips();
    document.addEventListener(EVENT_MODEL_SWITCHED, refreshChips);
  }

  // src/app/animations.ts
  var COLLAPSE_ANIM_MS = 600;
  var WIDTH_ANIM_MS = 600;
  var NODE_GAP = 15;
  function commitPinsTransitionFree(els) {
    for (const el of els) void el.offsetWidth;
  }
  function makeGenerationGuard() {
    const gens = /* @__PURE__ */ new Map();
    return (key) => {
      const gen = (gens.get(key) || 0) + 1;
      gens.set(key, gen);
      return () => gens.get(key) === gen;
    };
  }
  function zeroContributionMargin(node) {
    const cs = getComputedStyle(node);
    const minBox = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    return -(minBox + NODE_GAP) + "px";
  }
  function lockNodeToZero(node) {
    node.style.overflow = "hidden";
    node.style.height = "0px";
    node.style.marginBottom = zeroContributionMargin(node);
  }
  function clearGapAnim(node) {
    node.classList.remove("daw-gap-anim");
    node.style.height = "";
    node.style.marginBottom = "";
    node.style.overflow = "";
  }
  function captureBodyScrolls() {
    const bodies = Array.from(document.querySelectorAll(".section-body"));
    const saved = bodies.map((b) => b.scrollTop);
    return () => bodies.forEach((b, i) => {
      if (b.scrollTop !== saved[i]) b.scrollTop = saved[i];
    });
  }
  var collapseRedrawUntil = 0;
  var collapseRedrawActive = false;
  var collapseRedrawStart = 0;
  var collapseScrollFrom = /* @__PURE__ */ new Map();
  function scheduleCollapseRedraw(ms) {
    collapseRedrawUntil = Math.max(collapseRedrawUntil, performance.now() + ms);
    if (collapseRedrawActive) return;
    collapseRedrawActive = true;
    collapseRedrawStart = performance.now();
    collapseScrollFrom.clear();
    document.querySelectorAll(".section-body").forEach((body) => {
      body.scrollTo({ top: body.scrollTop });
      collapseScrollFrom.set(body, body.scrollTop);
    });
    (function tick() {
      const span = Math.max(1, collapseRedrawUntil - collapseRedrawStart);
      const p = Math.min(1, (performance.now() - collapseRedrawStart) / span);
      document.querySelectorAll(".section-body").forEach((body) => {
        layoutSectionBody(body, true, { from: collapseScrollFrom.get(body) || 0, p });
      });
      redrawLineGeometry();
      if (performance.now() < collapseRedrawUntil) {
        requestAnimationFrame(tick);
      } else {
        collapseRedrawActive = false;
        collapseScrollFrom.clear();
        adjustSectionPadding();
      }
    })();
  }
  var nodeHeightAnimTimers = /* @__PURE__ */ new WeakMap();
  function runHeightPhase(changes) {
    const restoreScrolls = captureBodyScrolls();
    changes.forEach((c) => {
      const timer = nodeHeightAnimTimers.get(c.node);
      if (timer) clearTimeout(timer);
      c.startHeight = c.node.offsetHeight;
    });
    changes.forEach((c) => {
      c.node.classList.remove("node-h-anim");
      c.node.style.height = "";
      c.node.classList.toggle("collapse", c.on);
    });
    changes.forEach((c) => {
      c.endHeight = c.node.offsetHeight;
    });
    changes.forEach((c) => {
      if (c.startHeight === c.endHeight) return;
      c.node.style.height = c.startHeight + "px";
    });
    commitPinsTransitionFree(changes.filter((c) => c.startHeight !== c.endHeight).map((c) => c.node));
    restoreScrolls();
    changes.forEach((c) => {
      if (c.startHeight === c.endHeight) return;
      c.node.classList.add("node-h-anim");
      c.node.style.height = c.endHeight + "px";
      const body = c.node.querySelector(".node-body");
      if (body && typeof body.animate === "function") {
        body.animate(
          [{ opacity: 0.1 }, { opacity: 1 }],
          { duration: COLLAPSE_ANIM_MS, easing: "ease-out" }
        );
      }
      nodeHeightAnimTimers.set(c.node, setTimeout(() => {
        c.node.classList.remove("node-h-anim");
        c.node.style.height = "";
        nodeHeightAnimTimers.delete(c.node);
      }, COLLAPSE_ANIM_MS + 60));
    });
    scheduleCollapseRedraw(COLLAPSE_ANIM_MS + 50);
  }
  var widthAnimCleanup = null;
  function cancelColumnWidthAnim() {
    if (widthAnimCleanup) widthAnimCleanup();
  }
  function animateColumnWidths(prepareFinal, revertVisual) {
    const sections = Array.from(document.querySelectorAll("#main-container > .section"));
    const startW = sections.map((s) => s.getBoundingClientRect().width);
    if (widthAnimCleanup) widthAnimCleanup(true);
    sections.forEach((s) => {
      s.classList.remove("col-w-anim");
      s.style.width = "";
      s.style.boxSizing = "";
      s.style.flex = "";
      s.style.minWidth = "";
    });
    const restoreScrolls = captureBodyScrolls();
    prepareFinal();
    const endW = sections.map((s) => s.getBoundingClientRect().width);
    if (revertVisual) revertVisual();
    restoreScrolls();
    if (sections.every((_s, i) => Math.abs(startW[i] - endW[i]) < 1)) {
      return;
    }
    sections.forEach((s, i) => {
      s.style.width = startW[i] + "px";
      s.style.boxSizing = "border-box";
      s.style.flex = "0 0 auto";
      s.style.minWidth = "0";
    });
    commitPinsTransitionFree(sections);
    sections.forEach((s, i) => {
      s.classList.add("col-w-anim");
      s.style.width = endW[i] + "px";
    });
    scheduleCollapseRedraw(WIDTH_ANIM_MS + 50);
    const timer = setTimeout(() => finish(false), WIDTH_ANIM_MS + 60);
    widthAnimCleanup = finish;
    function finish(soft) {
      clearTimeout(timer);
      widthAnimCleanup = null;
      if (soft) return;
      sections.forEach((s) => {
        s.classList.remove("col-w-anim");
        s.style.width = "";
        s.style.boxSizing = "";
        s.style.flex = "";
        s.style.minWidth = "";
      });
    }
  }

  // src/app/collapse.ts
  var COLLAPSE_SECTION_IDS = ["col-inputs", "col-fx", "col-mix", "col-stereo", "col-logical"];
  var collapseNodes = /* @__PURE__ */ new Set();
  function injectCollapseButtons() {
    COLLAPSE_SECTION_IDS.forEach((sectionId) => {
      document.querySelectorAll(`#${sectionId} .node`).forEach((node) => {
        if (node.querySelector(".node-collapse-btn")) return;
        const btn = document.createElement("div");
        btn.className = "node-collapse-btn";
        setTooltip(btn, "Toggle collapsed/full view");
        node.appendChild(btn);
      });
    });
  }
  function updateAllCollapsedClasses() {
    COLLAPSE_SECTION_IDS.forEach((sectionId) => {
      const section = document.getElementById(sectionId);
      if (!section) return;
      const nodes = section.querySelectorAll(".node");
      let all = nodes.length > 0;
      nodes.forEach((n) => {
        if (!collapseNodes.has(n.id)) all = false;
      });
      section.classList.toggle("all-collapsed", all);
    });
  }
  function applyFinalCollapseClasses(changes) {
    updateAllCollapsedClasses();
    if (changes.some((c) => !c.on)) sizeFixedColumns();
  }
  function applyCollapseState(animate) {
    ConfigStore.set("collapsedNodes", [...collapseNodes]);
    const changes = [];
    COLLAPSE_SECTION_IDS.forEach((sectionId) => {
      document.querySelectorAll(`#${sectionId} .node`).forEach((node) => {
        const on = collapseNodes.has(node.id);
        if (node.classList.contains("collapse") !== on) changes.push({ node, on });
      });
    });
    if (!animate || changes.length === 0) {
      cancelColumnWidthAnim();
      changes.forEach((c) => {
        c.node.classList.remove("node-h-anim");
        c.node.style.height = "";
        c.node.classList.toggle("collapse", c.on);
      });
      applyFinalCollapseClasses(changes);
      scheduleCollapseRedraw(0);
      return;
    }
    animateColumnWidths(
      () => {
        changes.forEach((c) => c.node.classList.toggle("collapse", c.on));
        applyFinalCollapseClasses(changes);
      },
      () => {
        changes.forEach((c) => c.node.classList.toggle("collapse", !c.on));
      }
    );
    runHeightPhase(changes);
  }
  function setSectionCollapse(sectionId, on) {
    document.querySelectorAll(`#${sectionId} .node`).forEach((node) => {
      if (on) collapseNodes.add(node.id);
      else collapseNodes.delete(node.id);
    });
  }
  function initCollapse() {
    const saved = ConfigStore.get("collapsedNodes");
    if (Array.isArray(saved)) saved.forEach((id) => {
      if (typeof id === "string") collapseNodes.add(id);
    });
    injectCollapseButtons();
    applyCollapseState(false);
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".section-collapse-btn, .section-expand-btn");
      if (!btn) return;
      const section = btn.closest(".section");
      setSectionCollapse(section.id, btn.classList.contains("section-collapse-btn"));
      applyCollapseState(true);
    });
    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
      injectCollapseButtons();
      applyCollapseState(false);
    });
    document.getElementById("btn-collapse-all").addEventListener("click", (e) => {
      e.stopPropagation();
      COLLAPSE_SECTION_IDS.forEach((id) => setSectionCollapse(id, true));
      applyCollapseState(true);
    });
    document.getElementById("btn-expand-all").addEventListener("click", (e) => {
      e.stopPropagation();
      COLLAPSE_SECTION_IDS.forEach((id) => setSectionCollapse(id, false));
      applyCollapseState(true);
    });
  }

  // src/app/selection.ts
  function applySelectionChange() {
    updateHighlights();
    if (viewState.focusNodesPathOnly) adjustSectionPadding();
    autoScrollToActiveNodes();
  }
  function clearSelection() {
    if (!viewState.activeNodeId) return;
    viewState.activeNodeId = null;
    applySelectionChange();
  }
  function initSelection() {
    document.getElementById("main-container").addEventListener("click", (e) => {
      const target = e.target;
      const collapseBtn = target.closest(".node-collapse-btn");
      if (collapseBtn) {
        e.stopPropagation();
        const node2 = collapseBtn.closest(".node");
        if (collapseNodes.has(node2.id)) collapseNodes.delete(node2.id);
        else collapseNodes.add(node2.id);
        applyCollapseState(true);
        return;
      }
      const tapChip = target.closest(".meter-tap-chip");
      if (tapChip) {
        e.stopPropagation();
        const node2 = tapChip.closest(".node");
        if (node2) cycleMeterTap(node2.id);
        return;
      }
      const node = target.closest(".node");
      if (node) {
        e.stopPropagation();
        viewState.activeNodeId = viewState.activeNodeId === node.id ? null : node.id;
        applySelectionChange();
      }
    });
    document.body.addEventListener("click", (e) => {
      const target = e.target;
      if (target.closest("header") && !target.closest("#focus-view-chip")) return;
      if (target.closest(".section > h2")) return;
      clearSelection();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        clearSelection();
      }
    });
  }

  // src/app/header.ts
  function wireHeaderToggle(toggleId, trackId, get, set, persistKey, onChange) {
    const saved = ConfigStore.get(persistKey);
    if (typeof saved === "boolean" && saved !== get()) set(saved);
    const track = document.getElementById(trackId);
    track.classList.toggle("on", get());
    document.getElementById(toggleId).addEventListener("click", () => {
      set(!get());
      ConfigStore.set(persistKey, get());
      track.classList.toggle("on", get());
      if (onChange) onChange();
    });
  }
  function initHeaderToggles() {
    wireHeaderToggle(
      "scroll-to-selection-toggle",
      "scroll-to-selection-track",
      () => appState.scrollToSelectionEnabled,
      (v) => {
        appState.scrollToSelectionEnabled = v;
      },
      "scrollToSelection"
    );
    wireHeaderToggle(
      "hide-muted-toggle",
      "hide-muted-track",
      () => viewState.hideMuted,
      (v) => {
        viewState.hideMuted = v;
      },
      "hideMuted",
      () => drawLines()
    );
    wireHeaderToggle(
      "focus-nodes-toggle",
      "focus-nodes-track",
      () => viewState.focusNodesPathOnly,
      (v) => {
        viewState.focusNodesPathOnly = v;
      },
      "focusNodesPathOnly",
      () => {
        updateHighlights();
        if (viewState.activeNodeId) adjustSectionPadding();
      }
    );
    wireHeaderToggle(
      "focus-effects-toggle",
      "focus-effects-track",
      () => viewState.focusEffectsPathOnly,
      (v) => {
        viewState.focusEffectsPathOnly = v;
      },
      "focusEffectsPathOnly"
    );
    wireHeaderToggle(
      "focus-scroll-toggle",
      "focus-scroll-track",
      () => viewState.focusScrollPathOnly,
      (v) => {
        viewState.focusScrollPathOnly = v;
      },
      "focusScrollPathOnly"
    );
  }
  function initScrollToChangeToggle() {
    wireHeaderToggle(
      "scroll-to-change-toggle",
      "scroll-to-change-track",
      () => appState.scrollToChangeEnabled,
      (v) => {
        appState.scrollToChangeEnabled = v;
      },
      "scrollToChange"
    );
  }
  function initFontSize() {
    const FONT_LEVEL_MIN = 1;
    const FONT_LEVEL_MAX = 5;
    let fontLevel = FONT_LEVEL_MIN;
    function applyFontLevel() {
      document.documentElement.style.setProperty("--font-boost", fontLevel - 1 + "px");
      document.getElementById("font-size-level").textContent = `${fontLevel}/${FONT_LEVEL_MAX}`;
      document.getElementById("btn-font-minus").disabled = fontLevel <= FONT_LEVEL_MIN;
      document.getElementById("btn-font-plus").disabled = fontLevel >= FONT_LEVEL_MAX;
      sizeFixedColumns();
    }
    function stepFontLevel(delta) {
      const next = Math.min(FONT_LEVEL_MAX, Math.max(FONT_LEVEL_MIN, fontLevel + delta));
      if (next === fontLevel) return;
      fontLevel = next;
      ConfigStore.set("fontSize", fontLevel);
      applyFontLevel();
      adjustSectionPadding();
    }
    const saved = ConfigStore.get("fontSize");
    if (Number.isInteger(saved) && saved >= FONT_LEVEL_MIN && saved <= FONT_LEVEL_MAX) fontLevel = saved;
    applyFontLevel();
    document.getElementById("btn-font-minus").addEventListener("click", () => stepFontLevel(-1));
    document.getElementById("btn-font-plus").addEventListener("click", () => stepFontLevel(1));
  }
  function initHeaderHamburger() {
    const headerEl = document.getElementById("app-header");
    const mini = document.getElementById("header-mini");
    let headerAnimTimer = null;
    function placeMiniElements(collapsed) {
      const select = document.getElementById("model-select");
      const dot = document.getElementById("sync-status-dot");
      const status = document.getElementById("sync-status");
      const rate = document.getElementById("sample-rate");
      const firmware = document.getElementById("firmware-version");
      if (collapsed) {
        mini.append(dot, status, rate, select, firmware);
      } else {
        const connectBtn2 = document.getElementById("sync-connect-btn");
        document.getElementById("device-model-row").append(select, firmware);
        connectBtn2.parentElement.insertBefore(rate, connectBtn2);
        rate.parentElement.insertBefore(status, rate);
        status.parentElement.insertBefore(dot, status);
      }
    }
    function applyHeaderCollapsed(on, animate) {
      const h0 = headerEl.offsetHeight;
      headerEl.classList.toggle("header-collapsed", on);
      placeMiniElements(on);
      adjustSectionPadding();
      if (!animate) return;
      const h1 = headerEl.offsetHeight;
      if (h0 === h1) return;
      if (headerAnimTimer !== null) clearTimeout(headerAnimTimer);
      headerEl.classList.remove("header-h-anim");
      headerEl.style.boxSizing = "border-box";
      headerEl.style.overflow = "hidden";
      headerEl.style.height = h0 + "px";
      void headerEl.offsetHeight;
      headerEl.classList.add("header-h-anim");
      headerEl.style.height = h1 + "px";
      headerAnimTimer = setTimeout(() => {
        headerEl.classList.remove("header-h-anim");
        headerEl.style.height = "";
        headerEl.style.overflow = "";
        headerEl.style.boxSizing = "";
        adjustSectionPadding();
      }, 1060);
    }
    const saved = ConfigStore.get("headerCollapsed");
    let headerCollapsed = typeof saved === "boolean" ? saved : true;
    applyHeaderCollapsed(headerCollapsed, false);
    document.getElementById("header-menu-btn").addEventListener("click", () => {
      headerCollapsed = !headerCollapsed;
      ConfigStore.set("headerCollapsed", headerCollapsed);
      applyHeaderCollapsed(headerCollapsed, true);
    });
  }
  function initConfigButtons() {
    document.getElementById("btn-config-export").addEventListener("click", () => {
      const blob = new Blob([ConfigStore.exportText()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `uspv-config-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    document.getElementById("btn-config-load").addEventListener("click", () => {
      document.getElementById("config-file-input").click();
    });
    document.getElementById("config-file-input").addEventListener("change", (e) => {
      const input = e.target;
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          ConfigStore.importText(reader.result);
          location.reload();
        } catch (err) {
          alert(t("Could not load the settings file:") + "\n" + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  // src/app/update-chip.ts
  function initUpdateChip() {
    const bridge = window.uspvUpdate;
    if (!bridge) return;
    const chip = document.getElementById("update-chip");
    let current = null;
    function render(info) {
      current = info;
      const ready = info.state === "downloaded";
      chip.textContent = ready ? `Update v${info.version} ready` : `Update v${info.version}`;
      chip.classList.toggle("ready", ready);
      setTooltip(chip, ready ? "Update downloaded \u2014 click to restart and apply it now" : "A new version is available \u2014 click to open the download page");
      chip.hidden = false;
      adjustSectionPadding();
    }
    chip.addEventListener("click", () => {
      if (!current) return;
      if (current.state === "downloaded") bridge.restartAndInstall();
      else bridge.openReleasesPage();
    });
    bridge.subscribe(render);
  }

  // src/app/daw-toggle.ts
  var dawVisible = { "col-physical-inputs": true, "col-physical": true };
  var DAW_FADE_MS = 600;
  var dawToggleTimers = /* @__PURE__ */ new Map();
  var takeDawGeneration = makeGenerationGuard();
  function applyDawToggles() {
    Object.entries(dawVisible).forEach(([sectionId, visible]) => {
      const section = document.getElementById(sectionId);
      if (!section) return;
      section.classList.toggle("hide-daw", !visible);
      const track = section.querySelector(".section-daw-toggle .toggle-track");
      if (track) track.classList.toggle("on", visible);
    });
  }
  function dawNodesOf(section) {
    return Array.from(section.querySelectorAll('.node[id^="out-daw"], .node[id^="in-port-daw"]'));
  }
  function dawLineGroups(section) {
    const ids = new Set(dawNodesOf(section).map((n) => n.id));
    const groups = [];
    connections.forEach((conn, idx) => {
      if (ids.has(conn.fromNode) || ids.has(conn.toNode)) {
        const g = document.getElementById(`conn-group-${idx}`);
        if (g) groups.push(g);
      }
    });
    return groups;
  }
  function animateDawToggle(section, visible) {
    const alive = takeDawGeneration(section.id);
    const track = section.querySelector(".section-daw-toggle .toggle-track");
    if (track) track.classList.toggle("on", visible);
    const body = section.querySelector(".section-body");
    const daws = dawNodesOf(section);
    const lineGroups = dawLineGroups(section);
    clearTimeout(dawToggleTimers.get(section.id));
    daws.forEach((n) => {
      if (n.getAnimations) n.getAnimations().forEach((a) => a.cancel());
      clearGapAnim(n);
      n.style.opacity = "";
    });
    const resetLineFades = () => lineGroups.forEach((g) => {
      if (g.getAnimations) g.getAnimations().forEach((a) => a.cancel());
      g.style.filter = "";
    });
    resetLineFades();
    if (!body || daws.length === 0 || typeof daws[0].animate !== "function") {
      section.classList.toggle("hide-daw", !visible);
      adjustSectionPadding();
      return;
    }
    const TOTAL_MS = DAW_FADE_MS + WIDTH_ANIM_MS + 120;
    suppressChangeEffects(TOTAL_MS + 200);
    scheduleCollapseRedraw(TOTAL_MS);
    if (!visible) {
      daws.forEach((n) => {
        n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DAW_FADE_MS, easing: "ease", fill: "forwards" });
      });
      lineGroups.forEach((g) => {
        g.style.filter = "opacity(0)";
        g.animate([{ filter: "opacity(1)" }, { filter: "opacity(0)" }], { duration: DAW_FADE_MS, easing: "ease" });
      });
      dawToggleTimers.set(section.id, setTimeout(() => {
        if (!alive()) return;
        daws.forEach((n) => {
          n.getAnimations().forEach((a) => a.cancel());
          n.style.opacity = "0";
        });
        animateColumnWidths(
          () => section.classList.add("hide-daw"),
          () => section.classList.remove("hide-daw")
        );
        const startH = daws.map((n) => n.offsetHeight);
        daws.forEach((n, i) => {
          n.style.overflow = "hidden";
          n.style.height = startH[i] + "px";
          n.style.marginBottom = "0px";
        });
        daws.forEach((n) => void n.offsetHeight);
        daws.forEach((n) => {
          n.classList.add("daw-gap-anim");
          n.style.height = "0px";
          n.style.marginBottom = zeroContributionMargin(n);
        });
        dawToggleTimers.set(section.id, setTimeout(() => {
          if (!alive()) return;
          section.classList.add("hide-daw");
          daws.forEach((n) => {
            clearGapAnim(n);
            n.style.opacity = "";
          });
          resetLineFades();
          drawLines();
        }, WIDTH_ANIM_MS + 60));
      }, DAW_FADE_MS));
    } else {
      lineGroups.forEach((g) => {
        g.style.filter = "opacity(0)";
      });
      const restoreScrolls = captureBodyScrolls();
      section.classList.remove("hide-daw");
      const natH = daws.map((n) => n.offsetHeight);
      daws.forEach((n) => {
        n.style.opacity = "0";
        lockNodeToZero(n);
      });
      daws.forEach((n) => void n.offsetHeight);
      restoreScrolls();
      daws.forEach((n, i) => {
        n.classList.add("daw-gap-anim");
        n.style.height = natH[i] + "px";
        n.style.marginBottom = "0px";
      });
      animateColumnWidths(() => {
      }, null);
      dawToggleTimers.set(section.id, setTimeout(() => {
        if (!alive()) return;
        daws.forEach((n) => {
          clearGapAnim(n);
          const anim = n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DAW_FADE_MS, easing: "ease" });
          anim.onfinish = () => {
            n.style.opacity = "";
          };
        });
        lineGroups.forEach((g) => {
          const anim = g.animate([{ filter: "opacity(0)" }, { filter: "opacity(1)" }], { duration: DAW_FADE_MS, easing: "ease" });
          anim.onfinish = () => {
            g.style.filter = "";
            anim.cancel();
          };
        });
        dawToggleTimers.set(section.id, setTimeout(() => {
          if (!alive()) return;
          resetLineFades();
          debouncedDrawLines();
        }, DAW_FADE_MS + 60));
      }, WIDTH_ANIM_MS + 60));
    }
  }
  function initDawToggles() {
    const saved = ConfigStore.get("dawVisible");
    if (saved && typeof saved === "object") {
      Object.keys(dawVisible).forEach((k) => {
        if (typeof saved[k] === "boolean") dawVisible[k] = saved[k];
      });
    }
    applyDawToggles();
    document.addEventListener("click", (e) => {
      const toggle = e.target.closest(".section-daw-toggle");
      if (!toggle) return;
      const section = toggle.closest(".section");
      dawVisible[section.id] = !dawVisible[section.id];
      ConfigStore.set("dawVisible", dawVisible);
      animateDawToggle(section, dawVisible[section.id]);
    });
    document.addEventListener(EVENT_MODEL_SWITCHED, applyDawToggles);
  }

  // src/devmode/pick-card.ts
  var CANDIDATE_SELECTOR = [
    ".knob",
    'input[type="range"]',
    ".send-on",
    ".send-pre",
    ".dsp-block",
    ".meter",
    ".node-subtitle",
    ".src-chip",
    ".indicator"
  ].join(", ");
  var DERIVED_IDS = /* @__PURE__ */ new Set(["out-ph1-ind-src", "out-ph2-ind-src"]);
  function existingMappingLabel(elId) {
    if (PARAM_MAPPINGS[elId]) return `PARAM_MAPPINGS ${JSON.stringify(PARAM_MAPPINGS[elId])}`;
    if (METER_MAPPINGS[elId]) return `METER_MAPPINGS ${JSON.stringify(METER_MAPPINGS[elId])}`;
    if (DERIVED_IDS.has(elId)) return "(derived display: mirrors the MONITOR source chip)";
    return null;
  }
  function describeEl(el) {
    const node = el.closest(".node");
    const label = (el.textContent || "").trim().slice(0, 24);
    const type = el.type;
    return {
      el,
      elId: el.id || "",
      nodeId: node ? node.id : "-",
      desc: `<${el.tagName.toLowerCase()}${type ? ` type="${type}"` : ""} class="${el.className.replace(/ dev-\S+/g, "")}">` + (label ? ` "${label}"` : ""),
      existing: existingMappingLabel(el.id)
    };
  }
  function renderPickCard(container2, opts) {
    const pickBtnHtml = `<button class="dev-btn dev-pick-btn${opts.picking ? " active" : ""}" id="${opts.pickId}" title="${opts.pickTitle}">${opts.picking ? "Click a control\u2026" : "Pick"}</button><button class="dev-btn dev-pick-cancel" title="${t("Cancel picking (Esc)")}">&#10005;</button>`;
    const actions = opts.actionsHtml ?? pickBtnHtml + (opts.extraActions || "");
    if (opts.info) {
      const info = opts.info;
      const mapVal = info.existing ? `<span class="dev-chip dev-chip-mapped">MAPPED</span> <span class="dev-target-mapspec mono"></span>` : `<span class="dev-chip dev-chip-unmapped">UNMAPPED</span>`;
      container2.innerHTML = `<div class="dev-target-info"><div class="dev-target-id"><span class="dev-target-mark${opts.live ? " live" : ""}">${opts.live ? "&#9679;" : "&#9632;"}</span> ${info.elId || "(no id)"}</div><div class="dev-target-row"><span class="lbl">node</span><span class="val mono">${info.nodeId}</span></div><div class="dev-target-row"><span class="lbl">dom</span><span class="val mono dev-target-dom"></span></div><div class="dev-target-row"><span class="lbl">map</span><span class="val">${mapVal}</span></div>` + (opts.extraRows || "") + `</div><div class="dev-target-actions">${actions}</div>`;
      container2.querySelector(".dev-target-dom").textContent = info.desc;
      const spec = container2.querySelector(".dev-target-mapspec");
      if (spec) spec.textContent = info.existing;
    } else {
      container2.innerHTML = `<div class="dev-target-info">Target:</div><div class="dev-target-actions">${actions}</div>`;
    }
  }

  // src/devmode/report.ts
  function buildMarkdownReport(opts) {
    const head = [
      opts.title,
      "",
      ...opts.intro,
      "",
      `- Model: ${opts.model} / captured at: ${(/* @__PURE__ */ new Date()).toLocaleString()}`,
      ""
    ].join("\n");
    if (!opts.sections.length) return head + opts.emptyMessage + "\n";
    return head + opts.sections.join("\n\n") + "\n";
  }
  function copyToClipboard(text, btn) {
    const label = btn.textContent;
    const done = () => {
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = label;
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    }
  }
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function setReportText(el, text) {
    if (el.value === text) return;
    const st = el.scrollTop;
    el.value = text;
    el.scrollTop = st;
  }
  function wireReportButtons(copyBtnId, dlBtnId, textareaId, fileSlug) {
    const textarea = document.getElementById(textareaId);
    const stamp = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    document.getElementById(copyBtnId).addEventListener("click", (e) => copyToClipboard(textarea.value, e.currentTarget));
    document.getElementById(dlBtnId).addEventListener("click", () => downloadText(`urx-dev-${fileSlug}-report-${stamp()}.md`, textarea.value));
  }

  // src/devmode/capture.ts
  var MAX_VALUES_PER_ADDR = 8;
  function initCaptureMode(deps) {
    const capStatusEl = document.getElementById("dev-capture-status");
    const capTargetEl = document.getElementById("dev-capture-target");
    const capAddrsEl = document.getElementById("dev-capture-addrs");
    const capListEl = document.getElementById("dev-capture-list");
    const resultsCountEl = document.getElementById("dev-results-count");
    let current = null;
    let lastTarget = null;
    const captures = [];
    function start(el) {
      finish();
      const d = describeEl(el);
      current = {
        elId: d.elId || "(no id)",
        nodeId: d.nodeId,
        el,
        desc: d.desc,
        existing: d.existing,
        startedAt: /* @__PURE__ */ new Date(),
        addrs: /* @__PURE__ */ new Map()
        // addr -> {kind, count, values[]}
      };
      lastTarget = current;
      el.classList.add("dev-capturing");
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      render();
    }
    function recordIfCapturing(p) {
      if (!current) return;
      let rec = current.addrs.get(p.addr);
      if (!rec) {
        rec = { kind: p.kind, count: 0, values: [] };
        current.addrs.set(p.addr, rec);
      }
      rec.count++;
      if (rec.values.length < MAX_VALUES_PER_ADDR) rec.values.push(p.value);
      queueRender();
    }
    let renderQueued = false;
    function queueRender() {
      if (renderQueued) return;
      renderQueued = true;
      setTimeout(() => {
        renderQueued = false;
        render();
      }, 150);
    }
    function finish() {
      if (!current) return;
      current.el.classList.remove("dev-capturing");
      current.endedAt = /* @__PURE__ */ new Date();
      delete current.el;
      captures.push(current);
      current = null;
      lastTarget = null;
      render();
    }
    function cancel() {
      if (!current) return;
      current.el.classList.remove("dev-capturing");
      current = null;
      lastTarget = null;
      render();
    }
    function bestUnassigned(c) {
      let best = null;
      for (const [addr, rec] of c.addrs) {
        const assigned = rec.kind === "param" ? (REVERSE_PARAM_MAP[addr] || []).length : (REVERSE_METER_MAP[addr] || []).length;
        if (!assigned && (!best || rec.count > best.rec.count)) best = { addr, rec };
      }
      return best;
    }
    function renderAddrs() {
      capAddrsEl.innerHTML = "";
      const tgt = current || lastTarget;
      if (!tgt || tgt.addrs.size === 0) return;
      const best = bestUnassigned(tgt);
      for (const [addr, rec] of tgt.addrs) {
        const assigned = rec.kind === "param" ? (REVERSE_PARAM_MAP[addr] || []).map((m) => m.elId) : REVERSE_METER_MAP[addr] || [];
        const isBest = !!best && best.addr === addr;
        const row = document.createElement("div");
        row.className = "dev-addr" + (isBest ? " cand" : "");
        const seq = rec.values.map((v) => JSON.stringify(v)).join(", ") + (rec.count > rec.values.length ? `, \u2026(${t("total {n}", { n: String(rec.count) })})` : ` (${rec.count})`);
        row.textContent = `${isBest ? "\u2605 " : ""}${rec.kind === "param" ? "parameters" : "meters"}/${addr}  ${seq}` + (assigned.length ? ` \u2014 ${t("existing:")} ${assigned.join(", ")}` : "");
        row.title = isBest ? t("Most frequent unassigned = mapping candidate") : "";
        capAddrsEl.appendChild(row);
      }
    }
    function render() {
      const picking = deps.isPicking();
      if (picking) {
        capStatusEl.className = "active";
        capStatusEl.innerHTML = '<span class="dev-i18n-en">Click the target control on the board (other clicks are disabled; Esc cancels).</span><span class="dev-i18n-ja">\u5BFE\u8C61\u306E\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u4ED6\u306E\u30AF\u30EA\u30C3\u30AF\u306F\u7121\u52B9 / Esc\u3067\u89E3\u9664\uFF09\u3002</span>';
      } else if (current) {
        capStatusEl.className = "active";
        capStatusEl.innerHTML = `<span class="dev-i18n-en">&#9679; Capturing: ${current.elId} \u2014 operate it on the hardware (${current.addrs.size} addr).</span><span class="dev-i18n-ja">&#9679; \u30AD\u30E3\u30D7\u30C1\u30E3\u4E2D: ${current.elId} \u2014 \u5B9F\u6A5F\u3067\u8A72\u5F53\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u64CD\u4F5C\uFF08${current.addrs.size} addr\u3002Done/Enter\uFF1D\u5B8C\u4E86\u3001&#10005;/Esc\uFF1D\u30AD\u30E3\u30F3\u30BB\u30EB\uFF09\u3002</span>`;
      } else {
        capStatusEl.className = "";
        capStatusEl.innerHTML = '<span class="dev-i18n-en">Press <b>Pick</b> \u2014 unmapped controls start blinking red; click one to capture.</span><span class="dev-i18n-ja">Pick \u3092\u62BC\u3059\u3068\u672A\u30DE\u30C3\u30D4\u30F3\u30B0\u306E\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u304C\u8D64\u70B9\u6EC5\u3057\u307E\u3059\u3002\u5BFE\u8C61\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u8ABF\u67FB\u958B\u59CB\u3002</span>';
      }
      const n = lastTarget ? [...lastTarget.addrs.values()].reduce((s, r) => s + r.count, 0) : 0;
      renderPickCard(capTargetEl, {
        pickId: "dev-capture-pick",
        pickTitle: t("Click a control on the board to choose the capture target (other clicks are disabled while picking)"),
        info: lastTarget,
        picking,
        live: !!lastTarget && lastTarget === current,
        extraRows: n ? `<div class="dev-target-row"><span class="lbl">rx</span><span class="val">${lastTarget.addrs.size} addr / ${n} notifications</span></div>` : "",
        actionsHtml: lastTarget === current && current ? `<button class="dev-btn" id="dev-capture-cancel" title="${t("Cancel without recording (Esc)")}">&#10005;</button><button class="dev-btn" id="dev-capture-done" title="${t("Finish and record this capture (Enter)")}">Done</button>` : void 0
      });
      renderAddrs();
      resultsCountEl.textContent = captures.length ? " " + t("{n} items", { n: String(captures.length) }) : "";
      capListEl.innerHTML = "";
      captures.forEach((c, i) => {
        const total = [...c.addrs.values()].reduce((s, r) => s + r.count, 0);
        const best = bestUnassigned(c);
        const item = document.createElement("div");
        item.className = "dev-cap-item";
        const head = document.createElement("div");
        head.className = "dev-cap-head";
        head.innerHTML = `<span class="dev-cap-id">${i + 1}. ${c.elId}</span><button class="dev-cap-del" data-i="${i}" title="${t("Delete this record")}">&#10005;</button>`;
        const rows = document.createElement("div");
        rows.innerHTML = `<div class="dev-target-row"><span class="lbl">rx</span><span class="val">` + (c.addrs.size ? `${c.addrs.size} addr / ${total} notifications` : '<span class="dev-cap-none">none</span>') + `</span></div>` + (best ? `<div class="dev-target-row"><span class="lbl">cand</span><span class="val mono">${best.addr}</span></div>` : "");
        item.append(head, rows);
        capListEl.appendChild(item);
      });
      deps.refreshReports();
    }
    function guessType(rec) {
      if (rec.kind === "meter") return null;
      return rec.values.every((v) => v === 0 || v === 1) ? "bool" : "?";
    }
    function captureSection(c, i) {
      const lines = [];
      lines.push(`## ${i + 1}. Element \`${c.elId}\` (node: ${c.nodeId})`);
      lines.push(`- DOM: ${c.desc}`);
      lines.push(`- Existing mapping: ${c.existing || "none (UI only)"}`);
      if (c.addrs.size === 0) {
        lines.push("- Observed notifications: none \u2014 operating the hardware produced nothing (possibly unsubscribed, or the parameter is not exposed)");
        return lines.join("\n");
      }
      lines.push("- Notifications received during the capture (by address):");
      let best = null;
      for (const [addr, rec] of c.addrs) {
        const assigned = rec.kind === "param" ? (REVERSE_PARAM_MAP[addr] || []).map((m) => m.elId) : REVERSE_METER_MAP[addr] || [];
        const seq = rec.values.map((v) => JSON.stringify(v)).join(", ") + (rec.count > rec.values.length ? `, \u2026 (${rec.count} total)` : ` (${rec.count}x)`);
        lines.push(`  - \`/vd/${rec.kind === "param" ? "parameters" : "meters"}/${addr}\` values: ${seq} \u2014 existing assignment: ${assigned.length ? assigned.map((a) => `\`${a}\``).join(", ") : "none"}`);
        if (!assigned.length && (!best || rec.count > best.rec.count)) best = { addr, rec };
      }
      if (best) {
        const parts = best.addr.split(":").map(Number);
        const entry = best.rec.kind === "param" ? `PARAM_MAPPINGS: \`'${c.elId}': { paramId: ${parts[0]}, x: ${parts[1]}, y: ${parts[2]}, type: '${guessType(best.rec)}' }\`` : `METER_MAPPINGS: \`'${c.elId}': { meterId: ${parts[0]}, x: ${parts[1]} }\``;
        lines.push(`- Candidate from the unassigned addresses: ${entry} (judge the type from the value sequence)`);
      }
      return lines.join("\n");
    }
    function buildReport() {
      const all = captures.concat(current ? [current] : []);
      return buildMarkdownReport({
        title: "# URX Signal Path Visualizer \u2014 mapping fix request (DEVELOPER TOOL / CAPTURE)",
        intro: [
          "Each element below was captured while operating the matching control on the",
          "real device. Judge the mapping from the observed addresses / values and",
          "update PARAM_MAPPINGS / METER_MAPPINGS in src/data/device-map.ts.",
          "",
          "- Address format: parameter `{paramId}:{x}:{y}` / meter `{meterId}:{x}`",
          '- "existing assignment: none" = new-mapping candidate'
        ],
        model: document.getElementById("model-select").value,
        emptyMessage: "(no captures)",
        sections: all.map(captureSection)
      });
    }
    capTargetEl.addEventListener("click", (e) => {
      const target = e.target;
      if (target.closest("#dev-capture-done")) finish();
      else if (target.closest("#dev-capture-cancel")) cancel();
      else if (target.closest("#dev-capture-pick")) deps.togglePicking();
    });
    capListEl.addEventListener("click", (e) => {
      const del = e.target.closest(".dev-cap-del");
      if (!del) return;
      const [removed] = captures.splice(Number(del.dataset.i), 1);
      if (lastTarget === removed) lastTarget = null;
      render();
    });
    document.getElementById("dev-capture-clear").addEventListener("click", () => {
      finish();
      captures.length = 0;
      lastTarget = null;
      render();
    });
    return {
      start,
      finish,
      cancel,
      isRunning: () => !!current,
      recordIfCapturing,
      render,
      buildReport
    };
  }

  // src/devmode/addr-utils.ts
  function addrCompare(a, b) {
    const pa = a.split(":").map(Number);
    const pb = b.split(":").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  function collapseRanges(addrs) {
    const groups = /* @__PURE__ */ new Map();
    addrs.forEach((a) => {
      const parts = a.split(":");
      const last = Number(parts.pop());
      const prefix = parts.join(":");
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix).push(last);
    });
    const lines = [];
    [...groups.keys()].sort(addrCompare).forEach((prefix) => {
      const vals = groups.get(prefix).sort((a, b) => a - b);
      let start = vals[0];
      let prev = vals[0];
      for (let i = 1; i <= vals.length; i++) {
        const v = vals[i];
        if (v === prev + 1) {
          prev = v;
          continue;
        }
        const seg = start === prev ? `${start}` : `${start}-${prev}`;
        lines.push(prefix ? `${prefix}:${seg}` : seg);
        start = prev = v;
      }
    });
    return lines;
  }
  function subsListText(params, meters) {
    return [
      ...collapseRanges(params).map((l) => `parameters ${l}`),
      ...collapseRanges(meters).map((l) => `meters ${l}`)
    ].join("\n");
  }

  // src/devmode/console-log.ts
  function parseVdp(msg) {
    const vdp = msg.params && msg.params.vdp || msg.result && msg.result.vdp;
    if (!vdp || !vdp.uri) return null;
    const m = vdp.uri.split("?")[0].match(/^\/vd\/(parameters|meters)\/(.+)$/);
    if (!m) return null;
    return {
      kind: m[1] === "parameters" ? "param" : "meter",
      addr: m[2],
      value: vdp.data ? vdp.data.current_value : void 0
    };
  }
  function summarizeMsg(msg, p) {
    if (p) return `${p.kind === "param" ? "parameters" : "meters"}/${p.addr} = ${JSON.stringify(p.value)}`;
    if (msg.method) return msg.method + (msg.params ? " " + JSON.stringify(msg.params) : "");
    return JSON.stringify(msg);
  }
  var MAX_LOG_LINES = 400;
  function initDevConsole(onObservedChanged) {
    const logEl = document.getElementById("dev-log");
    const logCountEl = document.getElementById("dev-log-count");
    let logLines = 0;
    let pendingLines = [];
    let flushQueued = false;
    function flushLog() {
      flushQueued = false;
      if (pendingLines.length === 0) return;
      const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
      const frag = document.createDocumentFragment();
      pendingLines.forEach((line) => frag.appendChild(line));
      pendingLines = [];
      logEl.appendChild(frag);
      while (logEl.childElementCount > MAX_LOG_LINES) logEl.firstElementChild.remove();
      logCountEl.textContent = `${logLines} msg`;
      if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
    }
    function appendLog(dir, text) {
      const d = /* @__PURE__ */ new Date();
      const stamp = d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
      const line = document.createElement("div");
      line.className = `dev-log-line ${dir}`;
      line.innerHTML = `<span class="t">${stamp}</span><span class="dir">${dir.toUpperCase()}</span>`;
      line.appendChild(document.createTextNode(text));
      pendingLines.push(line);
      logLines++;
      if (pendingLines.length > MAX_LOG_LINES) pendingLines.splice(0, pendingLines.length - MAX_LOG_LINES);
      if (!flushQueued) {
        flushQueued = true;
        requestAnimationFrame(flushLog);
      }
    }
    const wireLogToggle = (trackId, toggleId, key, defaultOn, apply) => {
      let on = defaultOn ? ConfigStore.get(key) !== false : ConfigStore.get(key) === true;
      const track = document.getElementById(trackId);
      const sync = () => {
        track.classList.toggle("on", on);
        apply(on);
      };
      sync();
      document.getElementById(toggleId).addEventListener("click", () => {
        on = !on;
        ConfigStore.set(key, on);
        sync();
      });
      return () => on;
    };
    wireLogToggle(
      "dev-log-rx-track",
      "dev-log-rx-toggle",
      "devLogRx",
      true,
      (on) => logEl.classList.toggle("hide-rx", !on)
    );
    wireLogToggle(
      "dev-log-tx-track",
      "dev-log-tx-toggle",
      "devLogTx",
      true,
      (on) => logEl.classList.toggle("hide-tx", !on)
    );
    const showMeters = wireLogToggle(
      "dev-log-meters-track",
      "dev-log-meters-toggle",
      "devLogMeters",
      false,
      () => {
      }
    );
    wireLogToggle(
      "dev-log-wrap-track",
      "dev-log-wrap-toggle",
      "devLogWrap",
      false,
      (on) => logEl.classList.toggle("wrap", on)
    );
    const observed = { param: /* @__PURE__ */ new Set(), meter: /* @__PURE__ */ new Set() };
    let observedDirty = false;
    function recordObserved(p) {
      if (observed[p.kind].has(p.addr)) return;
      observed[p.kind].add(p.addr);
      if (!observedDirty) {
        observedDirty = true;
        setTimeout(() => {
          observedDirty = false;
          renderObserved();
        }, 300);
      }
    }
    function observedText() {
      return subsListText([...observed.param], [...observed.meter]);
    }
    function unmappedObservedText() {
      return subsListText(
        [...observed.param].filter((a) => !REVERSE_PARAM_MAP[a]),
        [...observed.meter].filter((a) => !REVERSE_METER_MAP[a])
      );
    }
    function renderObserved() {
      const np = observed.param.size;
      const nm = observed.meter.size;
      document.getElementById("dev-observed-count").textContent = np + nm ? ` parameters ${np} / meters ${nm}` : "";
      document.getElementById("dev-observed-list").textContent = observedText();
      const up = [...observed.param].filter((a) => !REVERSE_PARAM_MAP[a]).length;
      const um = [...observed.meter].filter((a) => !REVERSE_METER_MAP[a]).length;
      document.getElementById("dev-unmapped-obs-count").textContent = up + um ? ` parameters ${up} / meters ${um}` : "";
      document.getElementById("dev-unmapped-obs-list").textContent = unmappedObservedText();
      onObservedChanged();
    }
    function unmappedAddrRows() {
      return [
        ...[...observed.param].filter((a) => !REVERSE_PARAM_MAP[a]).sort(addrCompare).map((addr) => ({ kind: "param", addr })),
        ...[...observed.meter].filter((a) => !REVERSE_METER_MAP[a]).sort(addrCompare).map((addr) => ({ kind: "meter", addr }))
      ];
    }
    document.getElementById("dev-log-clear").addEventListener("click", () => {
      pendingLines = [];
      logEl.innerHTML = "";
      logLines = 0;
      logCountEl.textContent = "";
      observed.param.clear();
      observed.meter.clear();
      renderObserved();
    });
    document.getElementById("dev-observed-copy").addEventListener("click", (e) => copyToClipboard(observedText(), e.currentTarget));
    document.getElementById("dev-unmapped-obs-copy").addEventListener("click", (e) => copyToClipboard(unmappedObservedText(), e.currentTarget));
    return { appendLog, showMeters, recordObserved, renderObserved, unmappedAddrRows };
  }

  // src/devmode/flags.ts
  var FLAG_CLASS = { ghost: "dev-flag-ghost", mislink: "dev-flag-mislink" };
  function initFlagsMode(deps) {
    const flagLists = { ghost: [], mislink: [] };
    function add(kind, el) {
      const list = flagLists[kind];
      if (list.some((f) => f.el === el)) return;
      list.push({ ...describeEl(el), note: "" });
      el.classList.add(FLAG_CLASS[kind]);
      render(kind);
    }
    function remove(kind, idx) {
      const [f] = flagLists[kind].splice(idx, 1);
      if (f && f.el) f.el.classList.remove(FLAG_CLASS[kind]);
      render(kind);
    }
    function clear(kind) {
      flagLists[kind].forEach((f) => {
        if (f.el) f.el.classList.remove(FLAG_CLASS[kind]);
      });
      flagLists[kind].length = 0;
      render(kind);
    }
    function render(kind) {
      const list = flagLists[kind];
      renderPickCard(document.getElementById(`dev-${kind}-target`), {
        pickId: `dev-${kind}-pick`,
        pickTitle: kind === "ghost" ? t("Pick controls that do not exist on the device (repeat OK / Esc to finish)") : t("Pick controls whose link is wrong (repeat OK / Esc to finish)"),
        info: list.length ? list[list.length - 1] : null,
        picking: deps.isPicking()
      });
      document.getElementById(`dev-${kind}-count`).textContent = list.length ? " " + t("{n} items", { n: String(list.length) }) : "";
      const listEl = document.getElementById(`dev-${kind}-list`);
      listEl.innerHTML = "";
      list.forEach((f, i) => {
        const item = document.createElement("div");
        item.className = "dev-flag-item";
        const head = document.createElement("div");
        head.className = "dev-flag-head";
        head.innerHTML = `<b>${i + 1}. ${f.elId || "(no id)"}</b><button class="dev-flag-del" data-kind="${kind}" data-i="${i}" title="${t("Remove this mark")}">&#10005;</button>`;
        const meta = document.createElement("div");
        meta.className = "dev-flag-meta";
        meta.textContent = `node: ${f.nodeId}${f.existing ? " / " + f.existing : " / " + t("unmapped")}`;
        item.append(head, meta);
        if (kind === "mislink") {
          const note = document.createElement("input");
          note.className = "dev-flag-note";
          note.placeholder = t("What should it be? (note)");
          note.value = f.note;
          note.addEventListener("input", () => {
            f.note = note.value;
            deps.refreshReports();
          });
          item.appendChild(note);
        }
        listEl.appendChild(item);
      });
      deps.refreshReports();
    }
    function renderAll() {
      render("ghost");
      render("mislink");
    }
    function setHighlights(on) {
      Object.entries(flagLists).forEach(([kind, list]) => {
        list.forEach((f) => {
          if (f.el) f.el.classList.toggle(FLAG_CLASS[kind], on);
        });
      });
    }
    function reattach() {
      Object.entries(flagLists).forEach(([kind, list]) => {
        list.forEach((f) => {
          f.el = f.elId ? document.getElementById(f.elId) : null;
          if (f.el) f.el.classList.add(FLAG_CLASS[kind]);
        });
        render(kind);
      });
    }
    function buildReport(kind) {
      const list = flagLists[kind];
      return buildMarkdownReport({
        title: kind === "ghost" ? "# URX Signal Path Visualizer \u2014 phantom-control report (DEVELOPER TOOL / GHOST)" : "# URX Signal Path Visualizer \u2014 wrong-link report (DEVELOPER TOOL / MISLINK)",
        intro: kind === "ghost" ? [
          "The controls below are shown in the UI but do not exist on the real",
          "device. Consider removing them from src/ui/ui-builder.ts and src/data/device-map.ts."
        ] : [
          "The controls below have a wrong mapping / link \u2014 see each item's note.",
          "Fix src/data/device-map.ts or src/ui/ui-builder.ts accordingly."
        ],
        model: document.getElementById("model-select").value,
        emptyMessage: "(no marks)",
        sections: list.map((f, i) => {
          const lines = [`## ${i + 1}. Element \`${f.elId || "(no id)"}\` (node: ${f.nodeId})`];
          lines.push(`- DOM: ${f.desc}`);
          lines.push(`- Existing mapping: ${f.existing || "none (UI only)"}`);
          if (kind === "mislink") lines.push(`- Note: ${f.note || "(empty)"}`);
          return lines.join("\n");
        })
      });
    }
    ["ghost", "mislink"].forEach((kind) => {
      document.getElementById(`dev-${kind}-list`).addEventListener("click", (e) => {
        const del = e.target.closest(".dev-flag-del");
        if (del) remove(kind, Number(del.dataset.i));
      });
      document.getElementById(`dev-${kind}-target`).addEventListener("click", (e) => {
        if (e.target.closest(`#dev-${kind}-pick`)) deps.togglePicking();
      });
      document.getElementById(`dev-${kind}-clear`).addEventListener("click", () => clear(kind));
    });
    return { add, renderAll, setHighlights, reattach, buildReport };
  }

  // src/devmode/panel-html.ts
  var DEV_PANEL_HTML = `
        <div id="dev-panel" class="mode-capture" style="display: none;">
            <div id="dev-panel-header">
                <span class="dev-title">DEVELOPER TOOL</span>
                <!-- EN/JA language toggle (src/app/i18n.ts): the main UI is
                     all-English, so the switch lives with the dev tooling.
                     Shows the ACTIVE language; clicking switches. -->
                <button class="dev-btn" id="lang-toggle" title="Switch language">EN</button>
                <button class="dev-btn" id="dev-panel-min" style="margin-left: auto;" title="Minimize/restore the panel">&#8213;</button>
            </div>
            <div id="dev-panel-body">
                <!-- Right area: CONSOLE / SUBSCRIPTIONS as tabs (same
                     tab-connects-to-frame look as the mode tabs left).
                     CONSOLE is the default. -->
                <div id="dev-right-wrap">
                <div class="dev-modes" id="dev-right-tabs">
                    <button class="dev-right-tab active" data-panel="console"
                        title="Device Center WebSocket RX/TX traffic">CONSOLE</button>
                    <button class="dev-right-tab" data-panel="subs"
                        title="Device Center subscriptions and manual subscribe">SUBSCRIPTIONS</button>
                </div>
                <div id="dev-right">
                <div id="dev-subs" style="display: none;">
                    <div id="dev-subs-body">
                    <div class="dev-subs-box" id="dev-subs-status">
                        <div class="dev-console-headrow">
                            <span class="dev-col-head dev-console-head">SUBSCRIBED</span>
                            <span id="dev-subs-count"></span>
                        </div>
                        <div class="dev-step-hint"><span class="dev-i18n-en">Current Device Center subscriptions \u2014 only these arrive as notifications. &#10005; unsubscribes.</span><span class="dev-i18n-ja">Device Center \u3078\u8CFC\u8AAD\u4E2D\u306E\u30A2\u30C9\u30EC\u30B9\uFF08\u901A\u77E5\u306F\u3053\u308C\u3089\u306E\u307F\u5C4A\u304F\uFF09\u3002&#10005;\u3067\u8CFC\u8AAD\u89E3\u9664\u3002</span></div>
                        <div id="dev-subs-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-subs-default-btn"
                                title="Remove all manual/range subscriptions and restore the default mapped set (only while connected)">Restore Default</button>
                            <button class="dev-btn" id="dev-subs-clear-btn"
                                title="Unsubscribe everything (only while connected)">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-subs-box" id="dev-subs-addbox">
                        <div class="dev-console-headrow">
                            <span class="dev-col-head dev-console-head">ADD SUBSCRIPTION</span>
                        </div>
                        <div class="dev-step-hint"><span class="dev-i18n-en">Single address or bulk range (each part may be n-m, only while connected). 3 parts = parameters, 2 parts = meters. <b>Enter</b> adds:</span><span class="dev-i18n-ja">\u500B\u5225\u30A2\u30C9\u30EC\u30B9\u307E\u305F\u306F\u7BC4\u56F2\u4E00\u62EC\uFF08\u5404\u8981\u7D20 n-m \u53EF\u30FB\u63A5\u7D9A\u4E2D\u306E\u307F\uFF09\u30023\u8981\u7D20=parameters\u30012\u8981\u7D20=meters\u3002<b>Enter</b>\u3067\u3082\u8FFD\u52A0:</span></div>
                        <pre class="dev-subs-example">parameters 0-10:0:0-10
meters 0:1</pre>
                        <div class="dev-subs-add">
                            <input id="dev-subs-addr" placeholder="id:x:y (parameters) / id:x (meters)" spellcheck="false"
                                title="Address or range to subscribe. Auto-detected by part count (3 = parameters / 2 = meters). Enter adds">
                            <button class="dev-btn" id="dev-subs-add-btn"
                                title="Subscribe the entered address (ranges expand to a bulk add; only while connected)">Add</button>
                        </div>
                    </div>
                    </div>
                </div>

                <div id="dev-console">
                    <div id="dev-console-body">
                        <div id="dev-timeline" class="dev-console-col dev-console-col-first">
                            <div class="dev-console-headrow">
                                <span class="dev-col-head dev-console-head">TIMELINE</span>
                                <label class="header-toggle" id="dev-log-rx-toggle"
                                    title="Show received (RX) lines">
                                    <span>RX</span>
                                    <div class="toggle-track" id="dev-log-rx-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <label class="header-toggle" id="dev-log-tx-toggle"
                                    title="Show sent (TX) lines">
                                    <span>TX</span>
                                    <div class="toggle-track" id="dev-log-tx-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <label class="header-toggle" id="dev-log-meters-toggle"
                                    title="Include meter notifications in the log/captures (very high volume)">
                                    <span>Meters</span>
                                    <div class="toggle-track" id="dev-log-meters-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <label class="header-toggle" id="dev-log-wrap-toggle"
                                    title="Wrap long lines (horizontal scroll when off)">
                                    <span>Wrap</span>
                                    <div class="toggle-track" id="dev-log-wrap-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <span id="dev-log-count"></span>
                                <button class="dev-btn" id="dev-log-clear" title="Clear the log and the observed address lists">Clear</button>
                            </div>
                            <div id="dev-log"></div>
                        </div>
                        <!-- Every address actually received, deduped,
                             consecutive values collapsed to n-m -->
                        <div id="dev-observed" class="dev-console-col">
                            <div class="dev-console-headrow">
                                <span class="dev-col-head dev-console-head">OBSERVED</span>
                                <span id="dev-observed-count"></span>
                                <button class="dev-btn" id="dev-observed-copy"
                                    title="Copy the observed address list to the clipboard">Copy</button>
                            </div>
                            <div class="dev-step-hint"><span class="dev-i18n-en"><b>RX only</b> \u2014 addresses actually received (consecutive values collapsed as n-m). TX is not counted.</span><span class="dev-i18n-ja"><b>RX\u306E\u307F</b> \u2014 \u5B9F\u969B\u306B\u53D7\u4FE1\u3057\u305F\u30A2\u30C9\u30EC\u30B9\u306E\u4E00\u89A7\uFF08\u9023\u7D9A\u3059\u308B\u5024\u306F n-m \u306B\u96C6\u7D04\u3002\u9001\u4FE1 TX \u306F\u542B\u307E\u306A\u3044\uFF09\u3002</span></div>
                            <div id="dev-observed-list" class="dev-console-col-list"></div>
                        </div>
                        <!-- Of those, the addresses with NO current mapping -->
                        <div id="dev-unmapped-obs" class="dev-console-col">
                            <div class="dev-console-headrow">
                                <span class="dev-col-head dev-console-head">UNMAPPED</span>
                                <span id="dev-unmapped-obs-count"></span>
                                <button class="dev-btn" id="dev-unmapped-obs-copy"
                                    title="Copy the unmapped observed addresses to the clipboard">Copy</button>
                            </div>
                            <div class="dev-step-hint"><span class="dev-i18n-en"><b>RX only</b> \u2014 received addresses that have no mapping yet.</span><span class="dev-i18n-ja"><b>RX\u306E\u307F</b> \u2014 \u53D7\u4FE1\u3057\u305F\u3046\u3061\u3001\u73FE\u72B6\u30DE\u30C3\u30D4\u30F3\u30B0\u3055\u308C\u3066\u3044\u306A\u3044\u30A2\u30C9\u30EC\u30B9\u3002</span></div>
                            <div id="dev-unmapped-obs-list" class="dev-console-col-list"></div>
                        </div>
                    </div>
                </div>
                </div>
                </div>

                <!-- Tab strip sits directly on top of the steps frame, so
                     the active tab visually connects with its content -->
                <div id="dev-steps-wrap">
                <div class="dev-modes">
                    <button class="dev-mode-tab active" data-mode="capture"
                        title="Investigate unmapped controls by operating the hardware">CAPTURE</button>
                    <button class="dev-mode-tab" data-mode="ghost"
                        title="Flag controls shown in the UI that do not exist on the real device">GHOST</button>
                    <button class="dev-mode-tab" data-mode="mislink"
                        title="Flag controls whose link/mapping is wrong">MISLINK</button>
                    <button class="dev-mode-tab" data-mode="trymap"
                        title="Temporarily link an unmapped address to a UI control and verify live">TRYMAP</button>
                </div>
                <div id="dev-steps">
                <!-- CAPTURE mode: GUIDE (descriptions, left) | operation
                     columns \u2460 TARGET & CAPTURE \u2192 \u2461 RESULTS \u2192 \u2462 REPORT -->
                <div id="dev-mode-capture" class="dev-mode-cols">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Investigate unmapped controls with the real device.</div>
                        <div class="dev-guide-desc-jp">\u672A\u30DE\u30C3\u30D4\u30F3\u30B0\u306E\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u5B9F\u6A5F\u3067\u8ABF\u67FB\u3057\u307E\u3059\u3002</div>
                        <div class="dev-step">&#9312; <b>Select</b> \u2014 press <b>Pick</b>: unmapped controls blink red. Click one (non-blinking mapped controls work too). The target glows red and scrolls into view.</div>
                        <div class="dev-step-jp">&#9312; <b>\u9078\u629E</b> \u2014 Pick \u3092\u62BC\u3059\u3068\u672A\u30DE\u30C3\u30D4\u30F3\u30B0\u304C\u8D64\u67A0\u3067\u70B9\u6EC5\u30021\u3064\u30AF\u30EA\u30C3\u30AF\u3067\u5BFE\u8C61\u306B\uFF08\u70B9\u6EC5\u306A\u3057\u306E\u30DE\u30C3\u30D4\u30F3\u30B0\u6E08\u307F\u3082\u9078\u629E\u53EF\uFF09\u3002\u5BFE\u8C61\u306F\u8D64\u30B0\u30ED\u30FC\u3067\u660E\u6EC5\u3057\u3001\u81EA\u52D5\u30B9\u30AF\u30ED\u30FC\u30EB\u3067\u8868\u793A\u3002</div>
                        <div class="dev-step">&#9312; <b>Capture</b> \u2014 operate that control on the hardware; responding addresses appear live (&#9733; = best unassigned candidate). <b>Done</b> (Enter) records, <b>&#10005;</b> (Esc) cancels.</div>
                        <div class="dev-step-jp">&#9312; <b>\u8A18\u9332</b> \u2014 \u5B9F\u6A5F\u3067\u8A72\u5F53\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u64CD\u4F5C\u3059\u308B\u3068\u53CD\u5FDC\u30A2\u30C9\u30EC\u30B9\u304C\u30E9\u30A4\u30D6\u8868\u793A\uFF08&#9733;\uFF1D\u672A\u5272\u5F53\u306E\u6709\u529B\u5019\u88DC\uFF09\u3002Done\uFF08Enter\uFF09\u3067\u8A18\u9332\u3001&#10005;\uFF08Esc\uFF09\u3067\u30AD\u30E3\u30F3\u30BB\u30EB\u3002</div>
                        <div class="dev-step">&#9313; <b>Review</b> \u2014 recorded captures are listed; &#10005; deletes one.</div>
                        <div class="dev-step-jp">&#9313; <b>\u78BA\u8A8D</b> \u2014 \u8A18\u9332\u6E08\u307F\u30AD\u30E3\u30D7\u30C1\u30E3\u306E\u4E00\u89A7\u3002&#10005;\u3067\u524A\u9664\u3002</div>
                        <div class="dev-step">&#9314; <b>Report</b> \u2014 the fix request updates live; <b>Copy</b> or <b>Download</b>.</div>
                        <div class="dev-step-jp">&#9314; <b>\u30EC\u30DD\u30FC\u30C8</b> \u2014 \u4FEE\u6B63\u4F9D\u983C\u30EC\u30DD\u30FC\u30C8\u306F\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u66F4\u65B0\u3002Copy \u307E\u305F\u306F Download\u3002</div>
                        <div class="dev-step" style="margin-top: 8px;">&#8251; Red highlights (blink = unmapped / glow = target) appear only while this tab is active.</div>
                        <div class="dev-step-jp" style="margin-top: 8px;">\u203B \u8D64\u306E\u5F37\u8ABF\u8868\u793A\uFF08\u70B9\u6EC5\uFF1D\u672A\u30DE\u30C3\u30D4\u30F3\u30B0\uFF0F\u30B0\u30ED\u30FC\uFF1D\u9078\u629E\u4E2D\u306E\u5BFE\u8C61\uFF09\u306F CAPTURE \u30BF\u30D6\u9078\u629E\u4E2D\u306E\u307F\u3002</div>
                        </div>
                    </div>
                    <div class="dev-step-col" id="dev-capture">
                        <div class="dev-col-head">&#9312; TARGET &amp; CAPTURE</div>
                        <div id="dev-capture-live">
                            <!-- Target card first; while capturing, the \u2715
                                 (cancel) / Done buttons appear stacked at
                                 the card's right -->
                            <div id="dev-capture-target"></div>
                            <div id="dev-capture-status"></div>
                            <div id="dev-capture-addrs"></div>
                        </div>
                    </div>
                    <div class="dev-step-col" id="dev-results">
                        <div class="dev-col-head">&#9313; RESULTS<span id="dev-results-count"></span></div>
                        <div id="dev-capture-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-capture-clear" title="Discard all captures">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-step-col dev-report-col" id="dev-report">
                        <div class="dev-col-head">&#9314; REPORT</div>
                        <textarea id="dev-report-text" class="dev-report-text" readonly spellcheck="false"></textarea>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-report-copy" title="Copy to clipboard">Copy</button>
                            <button class="dev-btn" id="dev-report-dl" title="Save as a text file">Download</button>
                        </div>
                        <div class="dev-report-note"><span class="dev-i18n-en">Please share this report with the author.</span><span class="dev-i18n-ja">\u3053\u306E\u30EC\u30DD\u30FC\u30C8\u3092\u4F5C\u8005\u306B\u5171\u6709\u3057\u3066\u304F\u3060\u3055\u3044\u3002</span></div>
                    </div>
                </div>

                <!-- GHOST mode: GUIDE | \u2460 PICK \u2192 \u2461 MARKED \u2192 \u2462 REPORT -->
                <div id="dev-mode-ghost" class="dev-mode-cols" style="display: none;">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Flag controls shown in the UI that do NOT exist on the real device (deletion candidates).</div>
                        <div class="dev-guide-desc-jp">\u753B\u9762\u306B\u3042\u308B\u304C\u5B9F\u6A5F\u306B\u306F\u5B58\u5728\u3057\u306A\u3044\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\uFF08\u524A\u9664\u5019\u88DC\uFF09\u3092\u8A18\u9332\u3057\u307E\u3059\u3002</div>
                        <div class="dev-step">&#9312; <b>Mark</b> \u2014 press <b>Pick</b> and click each phantom control (multiple OK, <b>Esc</b> to finish). Marks show as purple outlines.</div>
                        <div class="dev-step-jp">&#9312; <b>\u30DE\u30FC\u30AF</b> \u2014 Pick \u3092\u62BC\u3057\u3001\u5B9F\u6A5F\u306B\u7121\u3044\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u9806\u306B\u30AF\u30EA\u30C3\u30AF\uFF08\u8907\u6570\u53EF\u30FBEsc\u3067\u7D42\u4E86\uFF09\u3002\u30DE\u30FC\u30AF\u306F\u7D2B\u67A0\u3067\u8868\u793A\u3002</div>
                        <div class="dev-step">&#9313; <b>Review</b> \u2014 marked controls are listed; &#10005; removes one.</div>
                        <div class="dev-step-jp">&#9313; <b>\u78BA\u8A8D</b> \u2014 \u30DE\u30FC\u30AF\u4E00\u89A7\u3002&#10005;\u3067\u524A\u9664\u3002</div>
                        <div class="dev-step">&#9314; <b>Report</b> \u2014 the deletion request updates live; <b>Copy</b> or <b>Download</b>.</div>
                        <div class="dev-step-jp">&#9314; <b>\u30EC\u30DD\u30FC\u30C8</b> \u2014 \u524A\u9664\u4F9D\u983C\u30EC\u30DD\u30FC\u30C8\u306F\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u66F4\u65B0\u3002Copy \u307E\u305F\u306F Download\u3002</div>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9312; PICK</div>
                        <!-- Same target card as CAPTURE: Pick inside the card,
                             info shows the last marked control -->
                        <div id="dev-ghost-target" class="dev-target-card"></div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9313; MARKED<span id="dev-ghost-count"></span></div>
                        <div id="dev-ghost-list" class="dev-flag-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-ghost-clear" title="Discard all marks">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-step-col dev-report-col">
                        <div class="dev-col-head">&#9314; REPORT</div>
                        <textarea id="dev-ghost-text" class="dev-report-text" readonly spellcheck="false"></textarea>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-ghost-copy" title="Copy to clipboard">Copy</button>
                            <button class="dev-btn" id="dev-ghost-dl" title="Save as a text file">Download</button>
                        </div>
                        <div class="dev-report-note"><span class="dev-i18n-en">Please share this report with the author.</span><span class="dev-i18n-ja">\u3053\u306E\u30EC\u30DD\u30FC\u30C8\u3092\u4F5C\u8005\u306B\u5171\u6709\u3057\u3066\u304F\u3060\u3055\u3044\u3002</span></div>
                    </div>
                </div>

                <!-- MISLINK mode: GUIDE | \u2460 PICK \u2192 \u2461 MARK & NOTE \u2192 \u2462 REPORT -->
                <div id="dev-mode-mislink" class="dev-mode-cols" style="display: none;">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Flag controls whose mapping / link is wrong, and note what it should be.</div>
                        <div class="dev-guide-desc-jp">\u30EA\u30F3\u30AF\uFF0F\u30DE\u30C3\u30D4\u30F3\u30B0\u304C\u8AA4\u3063\u3066\u3044\u308B\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u8A18\u9332\u3057\u3001\u6B63\u3057\u3044\u5185\u5BB9\u3092\u30E1\u30E2\u3057\u307E\u3059\u3002</div>
                        <div class="dev-step">&#9312; <b>Mark</b> \u2014 press <b>Pick</b> and click each wrong control (multiple OK, <b>Esc</b> to finish). Marks show as yellow outlines.</div>
                        <div class="dev-step-jp">&#9312; <b>\u30DE\u30FC\u30AF</b> \u2014 Pick \u3092\u62BC\u3057\u3001\u30EA\u30F3\u30AF\u304C\u8AA4\u3063\u3066\u3044\u308B\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u9806\u306B\u30AF\u30EA\u30C3\u30AF\uFF08\u8907\u6570\u53EF\u30FBEsc\u3067\u7D42\u4E86\uFF09\u3002\u30DE\u30FC\u30AF\u306F\u9EC4\u67A0\u3067\u8868\u793A\u3002</div>
                        <div class="dev-step">&#9313; <b>Note</b> \u2014 in each marked item, type what the correct mapping should be. &#10005; removes one.</div>
                        <div class="dev-step-jp">&#9313; <b>\u30E1\u30E2</b> \u2014 \u5404\u9805\u76EE\u306B\u300C\u6B63\u3057\u304F\u306F\u3069\u3046\u3042\u308B\u3079\u304D\u304B\u300D\u3092\u8A18\u5165\u3002&#10005;\u3067\u524A\u9664\u3002</div>
                        <div class="dev-step">&#9314; <b>Report</b> \u2014 the fix request updates live; <b>Copy</b> or <b>Download</b>.</div>
                        <div class="dev-step-jp">&#9314; <b>\u30EC\u30DD\u30FC\u30C8</b> \u2014 \u4FEE\u6B63\u4F9D\u983C\u30EC\u30DD\u30FC\u30C8\u306F\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u66F4\u65B0\u3002Copy \u307E\u305F\u306F Download\u3002</div>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9312; PICK</div>
                        <!-- Same target card as CAPTURE: Pick inside the card,
                             info shows the last marked control -->
                        <div id="dev-mislink-target" class="dev-target-card"></div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9313; MARK &amp; NOTE<span id="dev-mislink-count"></span></div>
                        <div id="dev-mislink-list" class="dev-flag-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-mislink-clear" title="Discard all marks">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-step-col dev-report-col">
                        <div class="dev-col-head">&#9314; REPORT</div>
                        <textarea id="dev-mislink-text" class="dev-report-text" readonly spellcheck="false"></textarea>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-mislink-copy" title="Copy to clipboard">Copy</button>
                            <button class="dev-btn" id="dev-mislink-dl" title="Save as a text file">Download</button>
                        </div>
                        <div class="dev-report-note"><span class="dev-i18n-en">Please share this report with the author.</span><span class="dev-i18n-ja">\u3053\u306E\u30EC\u30DD\u30FC\u30C8\u3092\u4F5C\u8005\u306B\u5171\u6709\u3057\u3066\u304F\u3060\u3055\u3044\u3002</span></div>
                    </div>
                </div>

                <!-- TRYMAP mode: GUIDE | \u2460 TARGET \u2192 \u2461 ADDRESS \u2192 \u2462 LINKED.
                     Temporary runtime links: entries are pushed into the
                     reverse maps so incoming notifications drive the picked
                     control live; nothing is persisted. -->
                <div id="dev-mode-trymap" class="dev-mode-cols" style="display: none;">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Temporarily link an address from CONSOLE's UNMAPPED list to a UI control and verify it live (this session only \u2014 nothing is saved).</div>
                        <div class="dev-guide-desc-jp">CONSOLE \u306E UNMAPPED \u3067\u691C\u77E5\u3057\u305F\u30A2\u30C9\u30EC\u30B9\u3092 UI \u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3078\u4E00\u6642\u7684\u306B\u30DE\u30C3\u30D7\u3057\u3001\u52D5\u4F5C\u78BA\u8A8D\u3057\u307E\u3059\uFF08\u30BB\u30C3\u30B7\u30E7\u30F3\u9650\u308A\u30FB\u4FDD\u5B58\u3055\u308C\u307E\u305B\u3093\uFF09\u3002</div>
                        <div class="dev-step">&#9312; <b>Target</b> \u2014 press <b>Pick</b> and click the UI control to drive (mapped controls can be picked too).</div>
                        <div class="dev-step-jp">&#9312; <b>\u5BFE\u8C61</b> \u2014 Pick \u3092\u62BC\u3057\u3066\u76E4\u9762\u306E\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u3092\u30AF\u30EA\u30C3\u30AF\uFF08\u30DE\u30C3\u30D4\u30F3\u30B0\u6E08\u307F\u3082\u9078\u629E\u53EF\uFF09\u3002</div>
                        <div class="dev-step">&#9313; <b>Address</b> \u2014 click an address in the list (live view of CONSOLE's UNMAPPED); for parameters choose the value type, then press <b>Link</b>. The control shows a blue dashed outline.</div>
                        <div class="dev-step-jp">&#9313; <b>\u30A2\u30C9\u30EC\u30B9</b> \u2014 \u4E00\u89A7\uFF08CONSOLE \u306E UNMAPPED \u3068\u9023\u52D5\uFF09\u304B\u3089\u30A2\u30C9\u30EC\u30B9\u3092\u9078\u3073\u3001parameters \u306F\u5024\u30BF\u30A4\u30D7\u3092\u9078\u629E\u3057\u3066 <b>Link</b>\u3002\u5BFE\u8C61\u306F\u9752\u306E\u7834\u7DDA\u67A0\u3067\u8868\u793A\u3002</div>
                        <div class="dev-step">&#9314; <b>Verify</b> \u2014 operate the hardware: notifications on the linked address now drive the control. &#10005; unlinks; linked addresses reappear in UNMAPPED after unlinking.</div>
                        <div class="dev-step-jp">&#9314; <b>\u78BA\u8A8D</b> \u2014 \u5B9F\u6A5F\u3092\u64CD\u4F5C\u3059\u308B\u3068\u8A72\u5F53\u30A2\u30C9\u30EC\u30B9\u306E\u901A\u77E5\u304C\u30B3\u30F3\u30C8\u30ED\u30FC\u30EB\u306B\u53CD\u6620\u3055\u308C\u307E\u3059\u3002&#10005;\u3067\u89E3\u9664\uFF08\u89E3\u9664\u5F8C\u306F UNMAPPED \u306B\u518D\u8868\u793A\uFF09\u3002</div>
                        <div class="dev-step">&#8251; Meter links drop when that node's meter tap is cycled (the meter reverse map is rebuilt).</div>
                        <div class="dev-step-jp">\u203B \u30E1\u30FC\u30BF\u30FC\u306E\u4E00\u6642\u30EA\u30F3\u30AF\u306F\u3001\u30E1\u30FC\u30BF\u30FC\u30BF\u30C3\u30D7\u3092\u5207\u308A\u66FF\u3048\u308B\u3068\u89E3\u9664\u3055\u308C\u307E\u3059\uFF08\u9006\u5F15\u304D\u30DE\u30C3\u30D7\u518D\u69CB\u7BC9\u306E\u305F\u3081\uFF09\u3002</div>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9312; TARGET</div>
                        <!-- Same target card as CAPTURE: Pick inside the card,
                             the picked target shows with \u2715 (deselect) -->
                        <div id="dev-trymap-target" class="dev-target-card"></div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9313; ADDRESS<span id="dev-trymap-addr-count"></span></div>
                        <div id="dev-trymap-addr-list"></div>
                        <div class="dev-trymap-controls">
                            <select id="dev-trymap-type"
                                title="Value type used to decode parameter notifications">
                                <option value="bool">bool</option>
                                <option value="level">level</option>
                                <option value="level_knob">level_knob</option>
                                <option value="pan">pan</option>
                                <option value="gain">gain</option>
                                <option value="dgain">dgain</option>
                                <option value="phonesLevel">phonesLevel</option>
                                <option value="freq">freq</option>
                                <option value="delayTime">delayTime</option>
                                <option value="string">string</option>
                            </select>
                            <button class="dev-btn" id="dev-trymap-apply"
                                title="Create the temporary link (this session only)">Link</button>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9314; LINKED<span id="dev-trymap-count"></span></div>
                        <div id="dev-trymap-list" class="dev-flag-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-trymap-clear" title="Remove all temporary links">Clear All</button>
                        </div>
                    </div>
                </div>
                </div>
                </div>
            </div>
        </div>`;

  // src/devmode/subs-panel.ts
  var MAX_BULK_SUBS = 512;
  function expandAddrRange(kind, text) {
    const parts = text.split(":");
    const expected = kind === "parameters" ? 3 : kind === "meters" ? 2 : null;
    if (expected !== null && parts.length !== expected) return null;
    const ranges = [];
    for (const p of parts) {
      const m = p.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) return null;
      const from = Number(m[1]);
      const to = m[2] !== void 0 ? Number(m[2]) : from;
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
      if (to < from) return null;
      ranges.push([from, to]);
    }
    const total = ranges.reduce((n, [f, t2]) => n * (t2 - f + 1), 1);
    if (total > MAX_BULK_SUBS) return null;
    let keys = [""];
    ranges.forEach(([from, to], i) => {
      const next = [];
      for (const prefix of keys) {
        for (let v = from; v <= to; v++) {
          next.push(i === 0 ? String(v) : `${prefix}:${v}`);
          if (next.length > MAX_BULK_SUBS) return null;
        }
      }
      keys = next;
    });
    return keys;
  }
  function initSubsPanel() {
    const subsListEl = document.getElementById("dev-subs-list");
    const subsCountEl = document.getElementById("dev-subs-count");
    let subsState = { parameters: /* @__PURE__ */ new Set(), meters: /* @__PURE__ */ new Set() };
    function sortedKinds(obj) {
      return Object.keys(obj).sort((a, b) => {
        const rank = (k) => k === "parameters" ? 0 : k === "meters" ? 1 : 2;
        return rank(a) - rank(b) || a.localeCompare(b);
      });
    }
    function renderSubs(subs) {
      if (subs) subsState = subs;
      const counts = sortedKinds(subsState).filter((k) => subsState[k].size).map((k) => `${k} ${subsState[k].size}`);
      subsCountEl.textContent = counts.length ? ` ${counts.join(" / ")}` : " (not connected)";
      subsListEl.innerHTML = "";
      sortedKinds(subsState).forEach((kind) => {
        [...subsState[kind]].sort(addrCompare).forEach((key) => {
          const row = document.createElement("div");
          row.className = "dev-subs-item";
          row.innerHTML = `<span>${kind} ${key}</span><button class="dev-flag-del" data-kind="${kind}" data-key="${key}" title="${t("Unsubscribe")}">&#10005;</button>`;
          subsListEl.appendChild(row);
        });
      });
    }
    subsListEl.addEventListener("click", (e) => {
      const del = e.target.closest(".dev-flag-del");
      if (del) deviceSync.subscribe(del.dataset.kind, del.dataset.key, false);
    });
    function flashSubsError() {
      const input = document.getElementById("dev-subs-addr");
      input.classList.add("dev-input-error");
      setTimeout(() => input.classList.remove("dev-input-error"), 1200);
    }
    function addSubscriptionFromInput() {
      const input = document.getElementById("dev-subs-addr");
      const text = input.value.trim();
      let kind = null;
      let addr = text;
      const prefixed = text.match(/^([A-Za-z_][\w-]*)\s+(\S+)$/);
      if (prefixed) {
        kind = prefixed[1].toLowerCase();
        if (kind === "param") kind = "parameters";
        if (kind === "meter") kind = "meters";
        addr = prefixed[2];
      } else {
        const nParts = text.split(":").length;
        kind = nParts === 3 ? "parameters" : nParts === 2 ? "meters" : null;
      }
      const keys = kind && expandAddrRange(kind, addr);
      if (!keys) return flashSubsError();
      if (!deviceSync.subscribe(kind, keys, true)) return flashSubsError();
      input.value = "";
    }
    document.getElementById("dev-subs-add-btn").addEventListener("click", addSubscriptionFromInput);
    document.getElementById("dev-subs-addr").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        addSubscriptionFromInput();
      }
    });
    document.getElementById("dev-subs-default-btn").addEventListener("click", () => {
      if (!deviceSync.restoreDefaultSubscriptions()) flashSubsError();
    });
    document.getElementById("dev-subs-clear-btn").addEventListener("click", () => {
      if (!deviceSync.clearAllSubscriptions()) flashSubsError();
    });
    return { renderSubs };
  }

  // src/devmode/trymap.ts
  function initTrymapMode(deps) {
    const tempLinks = [];
    let target = null;
    let selectedAddr = null;
    const targetEl = document.getElementById("dev-trymap-target");
    const addrListEl = document.getElementById("dev-trymap-addr-list");
    const listEl = document.getElementById("dev-trymap-list");
    const typeEl = document.getElementById("dev-trymap-type");
    const applyBtn = document.getElementById("dev-trymap-apply");
    function setTarget(el) {
      target?.el?.classList.remove("dev-trymap-targeting");
      target = describeEl(el);
      el.classList.add("dev-trymap-targeting");
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      render();
    }
    function clearTarget() {
      target?.el?.classList.remove("dev-trymap-targeting");
      target = null;
    }
    function applyTempLink() {
      if (!target || !selectedAddr) return;
      const { kind, addr } = selectedAddr;
      const type = typeEl.value;
      if (kind === "param") {
        if (!REVERSE_PARAM_MAP[addr]) REVERSE_PARAM_MAP[addr] = [];
        REVERSE_PARAM_MAP[addr].push({ elId: target.elId, type });
      } else {
        if (!REVERSE_METER_MAP[addr]) REVERSE_METER_MAP[addr] = [];
        REVERSE_METER_MAP[addr].push(target.elId);
      }
      tempLinks.push({
        el: target.el,
        elId: target.elId,
        nodeId: target.nodeId,
        kind,
        addr,
        type
      });
      target.el?.classList.add("dev-flag-trymap");
      clearTarget();
      selectedAddr = null;
      render();
      deps.refreshObserved();
    }
    function removeTempLink(idx) {
      const [link] = tempLinks.splice(idx, 1);
      if (!link) return;
      if (link.kind === "param") {
        const entries = REVERSE_PARAM_MAP[link.addr];
        if (entries) {
          const i = entries.findIndex((e) => e.elId === link.elId && e.type === link.type);
          if (i >= 0) entries.splice(i, 1);
          if (entries.length === 0) delete REVERSE_PARAM_MAP[link.addr];
        }
      } else {
        const elIds = REVERSE_METER_MAP[link.addr];
        if (elIds) {
          const i = elIds.indexOf(link.elId);
          if (i >= 0) elIds.splice(i, 1);
          if (elIds.length === 0) delete REVERSE_METER_MAP[link.addr];
        }
      }
      if (link.el && !tempLinks.some((l) => l.el === link.el)) {
        link.el.classList.remove("dev-flag-trymap");
      }
      render();
      deps.refreshObserved();
    }
    function render() {
      renderPickCard(targetEl, {
        pickId: "dev-trymap-pick",
        pickTitle: t("Pick the UI control to drive"),
        info: target,
        picking: deps.isPicking(),
        extraActions: target ? `<button class="dev-btn" id="dev-trymap-deselect" title="${t("Deselect the target (Esc)")}">&#10005;</button>` : "",
        live: true
      });
      const rows = deps.unmappedAddrRows();
      document.getElementById("dev-trymap-addr-count").textContent = rows.length ? ` ${rows.length}` : "";
      addrListEl.innerHTML = "";
      rows.forEach((r) => {
        const row = document.createElement("div");
        const selected = !!selectedAddr && selectedAddr.addr === r.addr && selectedAddr.kind === r.kind;
        row.className = "dev-trymap-addr" + (selected ? " selected" : "");
        row.textContent = `${r.kind === "param" ? "parameters" : "meters"} ${r.addr}`;
        row.addEventListener("click", () => {
          selectedAddr = r;
          render();
        });
        addrListEl.appendChild(row);
      });
      typeEl.disabled = !!selectedAddr && selectedAddr.kind === "meter";
      applyBtn.disabled = !target || !selectedAddr;
      document.getElementById("dev-trymap-count").textContent = tempLinks.length ? " " + t("{n} items", { n: String(tempLinks.length) }) : "";
      listEl.innerHTML = "";
      tempLinks.forEach((l, i) => {
        const item = document.createElement("div");
        item.className = "dev-flag-item";
        const head = document.createElement("div");
        head.className = "dev-flag-head";
        head.innerHTML = `<b>${l.elId}</b><button class="dev-flag-del" data-i="${i}" title="${t("Unlink")}">&#10005;</button>`;
        const meta = document.createElement("div");
        meta.className = "dev-flag-meta";
        meta.textContent = `${l.kind === "param" ? "parameters" : "meters"} ${l.addr}` + (l.kind === "param" ? ` (${l.type})` : "");
        item.append(head, meta);
        listEl.appendChild(item);
      });
    }
    function setHighlights(on) {
      tempLinks.forEach((l) => {
        if (l.el) l.el.classList.toggle("dev-flag-trymap", on);
      });
    }
    function reattach(devMode) {
      clearTarget();
      tempLinks.forEach((l) => {
        l.el = document.getElementById(l.elId);
        if (l.el && devMode) l.el.classList.add("dev-flag-trymap");
      });
      render();
    }
    listEl.addEventListener("click", (e) => {
      const del = e.target.closest(".dev-flag-del");
      if (del) removeTempLink(Number(del.dataset.i));
    });
    targetEl.addEventListener("click", (e) => {
      const clicked = e.target;
      if (clicked.closest("#dev-trymap-pick")) {
        deps.togglePicking();
      } else if (clicked.closest("#dev-trymap-deselect")) {
        clearTarget();
        render();
      }
    });
    applyBtn.addEventListener("click", applyTempLink);
    document.getElementById("dev-trymap-clear").addEventListener("click", () => {
      while (tempLinks.length) removeTempLink(0);
    });
    return {
      setTarget,
      clearTarget,
      hasTarget: () => !!target,
      render,
      setHighlights,
      reattach
    };
  }

  // src/devmode/devmode.ts
  function initDevmode() {
    let devMode = false;
    let showUnmapped = false;
    document.body.insertAdjacentHTML("beforeend", DEV_PANEL_HTML);
    refreshTooltips();
    const panel = document.getElementById("dev-panel");
    let picking = false;
    function setPicking(on) {
      picking = on;
      document.body.classList.toggle("dev-picking", on);
      document.querySelectorAll(".dev-pick-btn").forEach((b) => {
        b.classList.toggle("active", on);
        if (on) {
          if (!b.dataset.label) b.dataset.label = b.textContent;
          b.textContent = "Click a control\u2026";
        } else if (b.dataset.label) {
          b.textContent = b.dataset.label;
        }
      });
      capture.render();
    }
    const pickDeps = {
      isPicking: () => picking,
      togglePicking: () => setPicking(!picking),
      refreshReports: () => refreshReports()
    };
    const capture = initCaptureMode(pickDeps);
    const flags = initFlagsMode(pickDeps);
    const devConsole = initDevConsole(() => trymap.render());
    const trymap = initTrymapMode({
      ...pickDeps,
      unmappedAddrRows: () => devConsole.unmappedAddrRows(),
      refreshObserved: () => devConsole.renderObserved()
    });
    const subsPanel = initSubsPanel();
    function refreshReports() {
      setReportText(document.getElementById("dev-report-text"), capture.buildReport());
      setReportText(document.getElementById("dev-ghost-text"), flags.buildReport("ghost"));
      setReportText(document.getElementById("dev-mislink-text"), flags.buildReport("mislink"));
    }
    let subMode = "capture";
    document.body.classList.add("dev-submode-capture");
    function setSubMode(mode) {
      if (subMode === mode) return;
      setPicking(false);
      if (subMode === "capture") capture.finish();
      subMode = mode;
      document.body.classList.toggle("dev-submode-capture", mode === "capture");
      document.body.classList.toggle("dev-submode-trymap", mode === "trymap");
      panel.classList.remove("mode-capture", "mode-ghost", "mode-mislink", "mode-trymap");
      panel.classList.add(`mode-${mode}`);
      document.querySelectorAll(".dev-mode-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
      ["capture", "ghost", "mislink", "trymap"].forEach((m) => {
        document.getElementById(`dev-mode-${m}`).style.display = m === mode ? "" : "none";
      });
      scanUnmapped();
    }
    function isMapped(el) {
      if (!el.id) return false;
      return !!(PARAM_MAPPINGS[el.id] || METER_MAPPINGS[el.id] || DERIVED_IDS.has(el.id));
    }
    function unmappedWanted() {
      if (showUnmapped) return true;
      return devMode && (subMode === "capture" || subMode === "trymap");
    }
    function scanUnmapped() {
      const container2 = document.getElementById("main-container");
      container2.querySelectorAll(".dev-unmapped").forEach((el) => el.classList.remove("dev-unmapped"));
      if (!unmappedWanted()) return;
      container2.querySelectorAll(CANDIDATE_SELECTOR).forEach((el) => {
        if (!isMapped(el)) el.classList.add("dev-unmapped");
      });
    }
    registerTrafficHooks({
      rx: (msg) => {
        if (!devMode) return;
        const p = parseVdp(msg);
        if (p) devConsole.recordObserved(p);
        if (p && p.kind === "meter" && !devConsole.showMeters()) return;
        devConsole.appendLog("rx", summarizeMsg(msg, p));
        if (p) capture.recordIfCapturing(p);
      },
      tx: (msg) => {
        if (!devMode) return;
        devConsole.appendLog("tx", summarizeMsg(msg, parseVdp(msg)));
      },
      subs: (subs) => subsPanel.renderSubs(subs)
    });
    function swallowWhilePicking(e) {
      if (!devMode || !picking) return false;
      if (e.target.closest("#dev-panel")) return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
    function pickAt(e) {
      const el = e.target.closest(CANDIDATE_SELECTOR);
      if (!(el && document.getElementById("main-container").contains(el))) return;
      if (subMode === "capture") {
        capture.start(el);
        setPicking(false);
      } else if (subMode === "trymap") {
        if (!el.id) return;
        trymap.setTarget(el);
        setPicking(false);
      } else {
        flags.add(subMode, el);
      }
    }
    let swallowNextClick = false;
    document.addEventListener("pointerdown", (e) => {
      if (!swallowWhilePicking(e)) return;
      swallowNextClick = true;
      setTimeout(() => {
        swallowNextClick = false;
      }, 400);
      pickAt(e);
    }, true);
    document.addEventListener("mousedown", swallowWhilePicking, true);
    document.addEventListener("click", (e) => {
      if (e.target.closest(".dev-pick-cancel")) setPicking(false);
    });
    document.addEventListener("click", (e) => {
      if (swallowNextClick) {
        swallowNextClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (swallowWhilePicking(e)) pickAt(e);
    }, true);
    document.addEventListener("keydown", (e) => {
      if (!devMode) return;
      if (e.key === "Enter" && e.target.closest && e.target.closest("input, textarea, select")) return;
      if (e.key === "Enter" && capture.isRunning() && !picking) {
        e.stopPropagation();
        capture.finish();
        return;
      }
      if (e.key !== "Escape") return;
      if (picking) {
        e.stopPropagation();
        setPicking(false);
      } else if (capture.isRunning()) {
        e.stopPropagation();
        capture.cancel();
      } else if (subMode === "trymap" && trymap.hasTarget()) {
        e.stopPropagation();
        trymap.clearTarget();
        trymap.render();
      }
    }, true);
    function setDevMode(on) {
      devMode = on;
      document.getElementById("dev-track").classList.toggle("on", on);
      panel.style.display = on ? "flex" : "none";
      if (!on) {
        setPicking(false);
        capture.finish();
        trymap.clearTarget();
        trymap.render();
      }
      scanUnmapped();
      flags.setHighlights(on);
      trymap.setHighlights(on);
      capture.render();
      subsPanel.renderSubs(deviceSync.getSubscriptions());
      ConfigStore.set("devMode", on);
      drawLines();
    }
    function setShowUnmapped(on) {
      showUnmapped = on;
      document.getElementById("unmapped-track").classList.toggle("on", on);
      document.body.classList.toggle("show-unmapped", on);
      scanUnmapped();
      ConfigStore.set("showUnmapped", on);
    }
    document.getElementById("dev-toggle").addEventListener("click", () => setDevMode(!devMode));
    document.getElementById("unmapped-toggle").addEventListener("click", () => setShowUnmapped(!showUnmapped));
    document.getElementById("dev-panel-min").addEventListener("click", () => {
      panel.classList.toggle("minimized");
      drawLines();
    });
    document.querySelectorAll(".dev-mode-tab").forEach((tab) => {
      tab.addEventListener("click", () => setSubMode(tab.dataset.mode));
    });
    document.querySelectorAll(".dev-right-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const panelName = tab.dataset.panel;
        document.querySelectorAll(".dev-right-tab").forEach((other) => other.classList.toggle("active", other.dataset.panel === panelName));
        document.getElementById("dev-console").style.display = panelName === "console" ? "" : "none";
        document.getElementById("dev-subs").style.display = panelName === "subs" ? "" : "none";
      });
    });
    wireReportButtons("dev-report-copy", "dev-report-dl", "dev-report-text", "capture");
    wireReportButtons("dev-ghost-copy", "dev-ghost-dl", "dev-ghost-text", "ghost");
    wireReportButtons("dev-mislink-copy", "dev-mislink-dl", "dev-mislink-text", "mislink");
    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
      setPicking(false);
      capture.finish();
      scanUnmapped();
      flags.reattach();
      trymap.reattach(devMode);
    });
    document.addEventListener(EVENT_LANG_CHANGED, () => {
      flags.renderAll();
      subsPanel.renderSubs(null);
      capture.render();
      trymap.render();
    });
    flags.renderAll();
    trymap.render();
    if (ConfigStore.get("showUnmapped") === true) setShowUnmapped(true);
    if (ConfigStore.get("devMode") === true) setDevMode(true);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => scanUnmapped());
    }
  }

  // src/debug.ts
  function installDebugNamespace() {
    window.urx = {
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
      connections
    };
  }

  // src/main.ts
  initConfigStore();
  initConnections("URX44V");
  initAppDom();
  initMeterTaps();
  initModelSwitch();
  initSelection();
  initHeaderToggles();
  initDawToggles();
  initCollapse();
  initScrollToChangeToggle();
  initFontSize();
  initHeaderHamburger();
  initConfigButtons();
  initI18n();
  initUpdateChip();
  initLayoutListeners();
  finalizeInitialLayout();
  initBroker();
  initDemo();
  initDevmode();
  installDebugNamespace();
})();
//# sourceMappingURL=bundle.js.map

// DOM generation for the seven board columns. Templates are giant HTML
// strings assigned via innerHTML — cohesive by design, kept together.

let currentModel = 'URX44V';

// Mini icon buttons in the bus section headers: the bar icon collapses
// every node of the section to title + horizontal meter, the square
// icon restores them (icons are drawn in CSS via ::before).
// Wired by delegation in the app layer, mirroring the DAW toggles.
const COLLAPSE_TOGGLE = '<span class="section-view-btns">'
    + '<button class="section-btn section-collapse-btn" title="Collapse all nodes in this section"></button>'
    + '<button class="section-btn section-expand-btn" title="Restore all nodes in this section to full view"></button></span>';

function createInputChannels(): void {
    const col = document.getElementById('col-inputs');
    if (!col) return;

    const channels = [
        { id: 'in-ch1', title: 'CH 1', subtitle: 'Mic', preamp: ['+48V', 'Ø', 'HPF', '', 'AUTO', 'SAFE'], dsp: ['GATE', 'COMP', 'EQ', 'INS FX'] },
        { id: 'in-ch2', title: 'CH 2', subtitle: 'Guitar', preamp: ['+48V', 'Ø', 'HPF', 'Hi-Z', 'AUTO', 'SAFE'], dsp: ['GATE', 'COMP', 'EQ', 'INS FX'] },
        { id: 'in-ch34', title: 'CH 3/4', subtitle: 'Keys L/R', preamp: ['Ø', '', 'AUTO', 'SAFE'], dsp: ['EQ', 'DUCKER'] },
        { id: 'in-ch56', title: 'CH 5/6', subtitle: 'Synth', preamp: ['Ø', '', 'AUTO', 'SAFE'], dsp: ['EQ', 'DUCKER'] },
        { id: 'in-ch78', title: 'CH 7/8', subtitle: 'Backing Track', preamp: ['Ø', '', 'AUTO', 'SAFE'], dsp: ['EQ', 'DUCKER'] },
        { id: 'in-ch910', title: 'CH 9/10', subtitle: 'iPad', preamp: ['Ø', '', 'AUTO', 'SAFE'], dsp: ['EQ', 'DUCKER'] }
    ];

    let html = `<h2>Channel${COLLAPSE_TOGGLE}</h2>\n`;

    channels.forEach(ch => {
        const preampHtml = ch.preamp.map(p => p ? `<div class="dsp-block${(p === '+48V' || p === 'Hi-Z' || p === 'HPF') ? ' active' : ''}">${p}</div>` : `<div></div>`).join('');
        const dspHtml = ch.dsp.map(d => `<div class="dsp-block${d !== 'INS FX' ? ' active' : ''}">${d}</div>`).join('');
        const isStereo = ch.id !== 'in-ch1' && ch.id !== 'in-ch2';

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
                        <div class="knob-label">${isStereo ? 'D.GAIN' : 'GAIN'}</div>
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
                        <div class="meter-container${isStereo ? ' stereo' : ''}">
                            <div class="meter${isStereo ? ' meter-l' : ''}" id="${ch.id}-meter"></div>
                            ${isStereo ? `<div class="meter meter-r" id="${ch.id}-meter-r"></div>` : ''}
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

    // Append OSCILLATOR node next to inputs
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

function createMixBuses(): void {
    const colFx = document.getElementById('col-fx');
    if (colFx) {
        // Sends per REQUIREMENTS §4.8: ST column = TO ST assign + BAL,
        // MIX columns = ON / PRE / BAL / LEVEL. The MIX send controls are
        // device-mapped (params 342-355, docs/device-mapping.md §4.3); the
        // ON / 0 dB defaults below only cover the time before the first sync.
        colFx.innerHTML = `<h2>FX<br>Buses${COLLAPSE_TOGGLE}</h2>\n` + [1, 2].map(i => `
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
                            <div class="dsp-block active">${i === 1 ? 'REV-X' : 'DELAY'}</div>
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
            </div>`).join('');
    }

    const colMix = document.getElementById('col-mix');
    if (colMix) {
        colMix.innerHTML = `<h2>MIX<br>Buses${COLLAPSE_TOGGLE}</h2>\n` + [1, 2].map(i => `
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
                        <!-- ST send: assign ON only (REQUIREMENTS §4.8) -->
                        <div class="knob-label">ST</div>
                        <div class="send-on" id="bus-mix${i}-btn-tost">ON</div>
                    </div>
                </div>
                <div class="endpoint-out" id="pt-bus-mix${i}-out"></div>
            </div>`).join('');
    }
}

function createStereoBus(): void {
    const colStereo = document.getElementById('col-stereo');
    if (colStereo) {
        colStereo.innerHTML = `<h2>STEREO<br>BUS${COLLAPSE_TOGGLE}</h2>\n` + `
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

function createLogicalOutputs(): void {
    const col = document.getElementById('col-logical');
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

` + [1, 2].map(i => `
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
            </div>`).join('');
}

function createPhysicalOutputs(): void {
    const col = document.getElementById('col-physical');
    if (!col) return;

    const dawCount = currentModel === 'URX22' ? 10 : 12;
    const dawOuts = Array.from({ length: dawCount }, (_, i) => `
            <div class="node node-compact" id="out-daw${i + 1}">
                <div class="endpoint-in" id="pt-out-daw${i + 1}-in"></div>
                <div class="node-header">
                    <div><div class="node-title"><span class="title-break">USB</span> DAW ${i + 1}</div></div>
                </div>
            </div>`).join('');

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
                         name — the FOCUS VIEW chip shows only "PHONES 1" -->
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

function createPhysicalInputs(): void {
    const col = document.getElementById('col-physical-inputs');
    if (!col) return;

    const inputs = [
        { id: 'in-port-mic1', title: 'MIC/LINE 1' },
        { id: 'in-port-mic2', title: 'MIC/LINE 2' }
    ];

    if (currentModel !== 'URX22') {
        inputs.push({ id: 'in-port-mic3', title: 'MIC/LINE 3' });
        inputs.push({ id: 'in-port-mic4', title: 'MIC/LINE 4' });
    }

    inputs.push({ id: 'in-port-aux', title: 'AUX' });
    inputs.push({ id: 'in-port-usba', title: '<span class="title-break">USB</span> MAIN A' });
    inputs.push({ id: 'in-port-usbb', title: '<span class="title-break">USB</span> MAIN B' });
    inputs.push({ id: 'in-port-usbc', title: '<span class="title-break">USB</span> MAIN C' });
    inputs.push({ id: 'in-port-daw12', title: '<span class="title-break">USB</span> DAW 1/2' });
    inputs.push({ id: 'in-port-daw34', title: '<span class="title-break">USB</span> DAW 3/4' });
    inputs.push({ id: 'in-port-daw56', title: '<span class="title-break">USB</span> DAW 5/6' });
    inputs.push({ id: 'in-port-daw78', title: '<span class="title-break">USB</span> DAW 7/8' });
    inputs.push({ id: 'in-port-daw910', title: '<span class="title-break">USB</span> DAW 9/10' });

    if (currentModel !== 'URX22') {
        inputs.push({ id: 'in-port-daw1112', title: '<span class="title-break">USB</span> DAW 11/12' });
    }

    inputs.push({ id: 'in-port-usbsub', title: '<span class="title-break">USB</span> SUB' });

    if (currentModel !== 'URX22') {
        inputs.push({ id: 'in-port-sdplay', title: 'SD PLAY' });
    }

    if (currentModel === 'URX44V') {
        inputs.push({ id: 'in-port-hdmi', title: 'HDMI' });
    }

    col.innerHTML = '<h2>Physical<br>Inputs<label class="section-daw-toggle" title="Show/hide the USB DAW nodes"><span>DAW</span><div class="toggle-track"><div class="toggle-thumb"></div></div></label></h2>\n' + inputs.map(input => `
            <div class="node node-compact" id="${input.id}">
                <div class="node-header">
                    <div><div class="node-title">${input.title}</div></div>
                </div>
                <div class="endpoint-out" id="pt-${input.id}-out"></div>
            </div>`).join('');
}

export const UIBuilder = {
    setModel(model: string): void {
        currentModel = model;
    },
    getModel(): string {
        return currentModel;
    },
    buildAll(): void {
        createPhysicalInputs();
        createInputChannels();
        createMixBuses();
        createStereoBus();
        createLogicalOutputs();
        createPhysicalOutputs();
    },
};

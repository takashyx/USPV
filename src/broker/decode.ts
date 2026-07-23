// Pure value decoders for device notifications (browser-free, unit-tested).
// The encodings are documented in src/data/device-map.ts §パラメータ型.

// PREAMP analog/digital GAIN angle (-135°..+135°)
export function vdToGainAngle(value: number, isAnalog: boolean): number {
    const minVal = isAnalog ? -800 : -2400;
    const maxVal = isAnalog ? 7000 : 2400;
    const pct = (value - minVal) / (maxVal - minVal);
    return -135 + pct * 270;
}

// PAN angle: -63(L) .. 0(C) .. +63(R) -> -135°..+135°
export function vdToPanAngle(value: number): number {
    const pct = (value - (-63)) / (63 - (-63));
    return -135 + pct * 270;
}

// Fader level scale (dB×100; -32768 = -∞ -> clamp to -144)
export function vdToLevel(vd: number): number {
    if (vd <= -32768) return -144;
    return vd / 100;
}

// Phones scale (0..100 -> 0.0..10.0)
export function vdToPhones(vd: number): number {
    return vd / 10;
}

// Signed dB label ("+3.00 dB" / "-12.50 dB") — shared by the fader,
// level-knob and gain displays
export function formatDb(db: number): string {
    return (db > 0 ? '+' : '') + db.toFixed(2) + ' dB';
}

// Fader value label (range sliders; -144 floor shows -inf)
export function formatFaderValue(val: number): string {
    return val <= -144 ? '-inf dB' : formatDb(val);
}

// level_knob: dB×100, -32768 = -∞; dataset.value keeps the raw dB
export function decodeLevelKnob(value: number): { db: number; text: string } {
    const db = value <= -32768 ? -Infinity : value / 100;
    return { db, text: db <= -144 ? '-inf' : formatDb(db) };
}

// pan: rounded, C / Ln / Rn label
export function decodePanText(value: number): string {
    const panVal = Math.round(value);
    return panVal === 0 ? 'C' : (panVal < 0 ? 'L' + Math.abs(panVal) : 'R' + panVal);
}

// freq: Hz×10, 20 Hz .. 20 kHz log scale
export function decodeFreq(value: number): { angle: number; text: string } {
    const hz = value / 10;
    const text = hz >= 1000 ? (hz / 1000).toFixed(2) + ' kHz' : hz.toFixed(0) + ' Hz';
    const pct = (Math.log10(hz) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20));
    return { angle: -135 + Math.max(0, Math.min(1, pct)) * 270, text };
}

// portRef: the low 31 bits carry the port id
export function decodePortRefPortId(value: number): number {
    return value & 0x7FFFFFFF;
}

// insertFx: 0xffffffff / -1 = OFF, anything else = ON
export function decodeInsertFxActive(value: number): boolean {
    return value !== 0xffffffff && value !== -1;
}

// string: channel names may arrive as JSON-quoted strings
export function decodeStringValue(value: unknown): unknown {
    let valStr = value;
    if (typeof value === 'string') {
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

// STREAMING DELAY time (param 708): broker value is ms×100 (centi-ms),
// 100..100000 = 1.00..1000.00 ms. Knob angle runs the 3-decade range on a
// log scale (1 ms = -135°, 1000 ms = +135°).
export function decodeDelayTime(value: number): { ms: number; text: string; angle: number } {
    const ms = value / 100;
    const clamped = Math.max(1, Math.min(1000, ms));
    const pct = Math.log10(clamped) / 3;
    return { ms, text: ms.toFixed(2) + ' ms', angle: -135 + pct * 270 };
}

// STREAMING DELAY frame rate (param 830): index into the device's dropdown
// order (labels are the literal LCD strings; D = drop frame). The frame rate
// only changes how the delay time is shown in frames on the device LCD.
export const DELAY_FRAME_RATE_LABELS: readonly string[] =
    ['24', '25', '29.97D', '29.97', '30D', '30', '60', '120'];

export function decodeFrameRate(value: number): string {
    return DELAY_FRAME_RATE_LABELS[value] ?? String(value);
}

// Sample rate (param 766): raw Hz. Shown like the device LCD (44.1 kHz /
// 48 kHz / 96 kHz / 192 kHz). Display-only in the viewer — writing 766
// re-clocks the hardware.
export function formatSampleRate(hz: number): string {
    if (!Number.isFinite(hz) || hz <= 0) return '--';
    const khz = hz / 1000;
    return (Number.isInteger(khz) ? String(khz) : khz.toFixed(1)) + ' kHz';
}

// Meter value: dBFS×10. 32767 is the OVER (clip) sentinel — NOT -∞ (confirmed
// against the urx-router device catalog, docs/device-mapping.md §2); it pegs
// the bar at 100% and, being > 0 dB, lights the OVER chip. The no-signal
// resting value is -1280 (below the -60 dB floor). Display range -60..+10 dB.
export function decodeMeter(rawValue: number): { db: number; pct: number } {
    if (rawValue === 32767) return { db: Infinity, pct: 100 };
    const db = rawValue / 10;

    // Scale: -60dB to +10dB (total 70dB range)
    // 0dB is at 60/70 = ~85.7% (matches the yellow/red transition)
    let pct = 0;
    if (db > -60) {
        pct = ((db - (-60)) / 70) * 100;
    }
    pct = Math.max(0, Math.min(100, pct));
    return { db, pct };
}

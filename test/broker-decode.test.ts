import { describe, expect, it } from 'vitest';
import {
    decodeDelayTime,
    decodeFrameRate,
    decodeFreq,
    decodeInsertFxActive,
    decodeLevelKnob,
    decodeMeter,
    decodePanText,
    decodePortRefPortId,
    decodeStringValue,
    formatFaderValue,
    formatSampleRate,
    vdToGainAngle,
    vdToLevel,
    vdToPanAngle,
    vdToPhones,
} from '../src/broker/decode';
import { PORT_TO_NODE } from '../src/data/device-map';

describe('broker decoders', () => {
    it('level: dB×100 with -32768 clamped to -144', () => {
        expect(vdToLevel(-6000)).toBe(-60);
        expect(vdToLevel(0)).toBe(0);
        expect(vdToLevel(1000)).toBe(10);
        expect(vdToLevel(-32768)).toBe(-144);
    });

    it('level_knob: dB×100, -32768 = -inf, dataset keeps raw dB', () => {
        expect(decodeLevelKnob(0)).toEqual({ db: 0, text: '0.00 dB' });
        expect(decodeLevelKnob(350)).toEqual({ db: 3.5, text: '+3.50 dB' });
        expect(decodeLevelKnob(-32768)).toEqual({ db: -Infinity, text: '-inf' });
        expect(decodeLevelKnob(-14400)).toEqual({ db: -144, text: '-inf' });
    });

    it('fader value label shows -inf at the -144 floor', () => {
        expect(formatFaderValue(-144)).toBe('-inf dB');
        expect(formatFaderValue(-60)).toBe('-60.00 dB');
        expect(formatFaderValue(2.5)).toBe('+2.50 dB');
    });

    it('meter: dBFS×10, 32767 = OVER (clip), -60..+10 dB -> 0..100%', () => {
        expect(decodeMeter(-600)).toEqual({ db: -60, pct: 0 });
        expect(decodeMeter(0).pct).toBeCloseTo((60 / 70) * 100, 5);
        expect(decodeMeter(100).pct).toBe(100);
        // OVER sentinel: pegs the bar and reads as clipping (db > 0)
        expect(decodeMeter(32767)).toEqual({ db: Infinity, pct: 100 });
        expect(decodeMeter(-1280).pct).toBe(0); // no-signal resting value
        expect(decodeMeter(-1000).pct).toBe(0); // below range clamps to 0
    });

    it('portRef: low 31 bits carry the port id and resolve via PORT_TO_NODE', () => {
        expect(decodePortRefPortId(288)).toBe(288);
        expect(decodePortRefPortId((288 | 0x80000000) >>> 0)).toBe(288);
        expect(PORT_TO_NODE[decodePortRefPortId(256)]).toBe('bus-stereo');
        expect(PORT_TO_NODE[decodePortRefPortId(9999)]).toBeUndefined();
    });

    it('insertFx: 0xffffffff / -1 mean OFF', () => {
        expect(decodeInsertFxActive(0xffffffff)).toBe(false);
        expect(decodeInsertFxActive(-1)).toBe(false);
        expect(decodeInsertFxActive(0)).toBe(true);
        expect(decodeInsertFxActive(42)).toBe(true);
    });

    it('freq: Hz×10, log scale hits the -135°/+135° endpoints at 20 Hz / 20 kHz', () => {
        expect(decodeFreq(200)).toEqual({ angle: -135, text: '20 Hz' });
        expect(decodeFreq(200000).angle).toBeCloseTo(135, 5);
        expect(decodeFreq(200000).text).toBe('20.00 kHz');
        expect(decodeFreq(10000).text).toBe('1.00 kHz');
        expect(decodeFreq(4400).text).toBe('440 Hz');
    });

    it('phones: 0..100 -> 0.0..10.0', () => {
        expect(vdToPhones(0)).toBe(0);
        expect(vdToPhones(100)).toBe(10);
        expect(vdToPhones(55)).toBeCloseTo(5.5, 5);
    });

    it('pan: -63..0..+63 maps to L/C/R text and -135°..+135°', () => {
        expect(decodePanText(0)).toBe('C');
        expect(decodePanText(-63)).toBe('L63');
        expect(decodePanText(63)).toBe('R63');
        expect(vdToPanAngle(-63)).toBe(-135);
        expect(vdToPanAngle(0)).toBe(0);
        expect(vdToPanAngle(63)).toBe(135);
    });

    it('gain angle: analog -800..7000, digital -2400..2400', () => {
        expect(vdToGainAngle(-800, true)).toBe(-135);
        expect(vdToGainAngle(7000, true)).toBe(135);
        expect(vdToGainAngle(-2400, false)).toBe(-135);
        expect(vdToGainAngle(2400, false)).toBe(135);
        expect(vdToGainAngle(0, false)).toBe(0);
    });

    it('delayTime: ms×100 with a log-scale knob over 1..1000 ms', () => {
        expect(decodeDelayTime(100)).toEqual({ ms: 1, text: '1.00 ms', angle: -135 });
        expect(decodeDelayTime(100000).ms).toBe(1000);
        expect(decodeDelayTime(100000).text).toBe('1000.00 ms');
        expect(decodeDelayTime(100000).angle).toBeCloseTo(135, 5);
        expect(decodeDelayTime(10000).angle).toBeCloseTo(45, 5); // 100 ms = 2/3 of 3 decades
    });

    it('frameRate: dropdown-order index to the LCD label', () => {
        expect(decodeFrameRate(0)).toBe('24');
        expect(decodeFrameRate(2)).toBe('29.97D');
        expect(decodeFrameRate(5)).toBe('30');
        expect(decodeFrameRate(7)).toBe('120');
        expect(decodeFrameRate(9)).toBe('9'); // unknown index falls back to the raw value
    });

    it('sampleRate: raw Hz to the LCD-style kHz label', () => {
        expect(formatSampleRate(44100)).toBe('44.1 kHz');
        expect(formatSampleRate(48000)).toBe('48 kHz');
        expect(formatSampleRate(96000)).toBe('96 kHz');
        expect(formatSampleRate(192000)).toBe('192 kHz');
        expect(formatSampleRate(0)).toBe('--');
        expect(formatSampleRate(NaN)).toBe('--');
    });

    it('string: JSON-quoted names are unquoted, broken quoting falls back to slicing', () => {
        expect(decodeStringValue('"Vocal"')).toBe('Vocal');
        expect(decodeStringValue('plain')).toBe('plain');
        expect(decodeStringValue('"bad\\"')).toBe('bad\\');
        expect(decodeStringValue(42)).toBe(42);
    });
});

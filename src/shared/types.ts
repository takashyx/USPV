// Shared domain types for the URX viewer. Types only — no runtime code.

export type DeviceModel = 'URX44V' | 'URX44' | 'URX22';

// Routing-line render state (REQUIREMENTS §2.1.2)
export type ConnectionState = 'inactive' | 'muted' | 'flow';

// One routing line between two node endpoints. `color` is assigned by
// initializeSvgPaths() from the source node's category accent.
export interface Connection {
    from: string;      // endpoint dot id: pt-<node>-out
    fromNode: string;
    to: string;        // endpoint dot id: pt-<node>-in
    toNode: string;
    color?: string;
}

// Destination node id -> currently selected source node id (null = none).
export type PatchMap = Record<string, string | null>;

// Parameter value encodings (device-map.ts doc header has the full table)
export type ParamType =
    | 'level' | 'level_knob' | 'pan' | 'gain' | 'dgain' | 'phonesLevel'
    | 'bool' | 'bool_ssmcs' | 'bool_stereo_pair' | 'insertFx' | 'freq'
    | 'oscMode' | 'portRef' | 'string'
    | 'delayTime' | 'frameRate' | 'chColor' | 'sampleRate';

// UI element id -> device parameter address ({paramId}:{x}:{y})
export interface ParamMapping {
    paramId: number;
    x: number;
    y: number;
    type: ParamType;
    ports?: number[];  // portRef: selectable port ids
    value?: number;    // oscMode: waveform value this element represents
    rightY?: number;   // bool_stereo_pair: y of the R side
}

// UI meter element id -> meter address ({meterId}:{x})
export interface MeterMapping {
    meterId: number;
    x: number;
}

// Reverse lookup entry: notification address -> target UI element
export interface ReverseParamEntry {
    elId: string;
    type: ParamType;
}

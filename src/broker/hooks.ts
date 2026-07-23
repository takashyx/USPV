// Dev-tooling traffic hooks: the dev console registers callbacks here to
// observe RX/TX frames and subscription changes.

export interface TrafficHooks {
    rx(msg: unknown): void;
    tx(obj: unknown): void;
    subs?(subs: Record<string, Set<string>>): void;
}

let hooks: TrafficHooks | null = null;

export function registerTrafficHooks(h: TrafficHooks): void {
    hooks = h;
}

export function trafficHooks(): TrafficHooks | null {
    return hooks;
}

// Lazily cached references to the two static layout elements the view layer
// draws into. Both live directly in index.html (never rebuilt by
// UIBuilder), so caching the first lookup is safe for the page's lifetime.

let _svgLayer: HTMLElement | null = null;
let _container: HTMLElement | null = null;

export function svgLayer(): HTMLElement {
    if (!_svgLayer) _svgLayer = document.getElementById('svg-layer')!;
    return _svgLayer;
}

export function container(): HTMLElement {
    if (!_container) _container = document.getElementById('main-container')!;
    return _container;
}

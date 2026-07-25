// Rasterizes build/icon.svg into the two app icon PNGs electron-builder
// consumes. Run with `npm run icons` (needs the dev dependency Electron, which
// brings its own Chromium — no other rasterizer required).
//
//   build/icon.png      Windows/Linux. Keeps the alpha channel, so the rounded
//                       tile drawn in the SVG survives with a transparent
//                       margin around it. Windows blits the bitmap as-is.
//   build/icon-mac.png  macOS. Full bleed and forced fully opaque. macOS 26
//                       reads the outermost pixels: alpha >= 253 is clipped to
//                       the system squircle, alpha <= 252 is shrunk and inset
//                       into a light grey plate, which reads as a white frame
//                       around the icon. See the comment in build/icon.svg.
//
// Pass `win` or `mac` to render a single variant; the default is both.
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SIZE = 1024;
const root = join(__dirname, '..');
const source = readFileSync(join(root, 'build', 'icon.svg'), 'utf8');

const VARIANTS = {
    // `opaque` drives both the window background and the alpha flattening;
    // `rootClass` selects the variant inside the SVG (see its <style> block).
    win: { out: 'icon.png', rootClass: '', opaque: false },
    mac: { out: 'icon-mac.png', rootClass: 'mac', opaque: true },
};

// The SVG is inlined into a page rather than loaded directly so the document
// has no margin and no scrollbars to bleed into the capture.
function pageFor(rootClass) {
    const svg = rootClass ? source.replace('<svg ', `<svg class="${rootClass}" `) : source;
    const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}
svg{display:block;width:${SIZE}px;height:${SIZE}px}</style>
${svg}`;
    return 'data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64');
}

// Drops the alpha channel by forcing every byte to 255. The macOS artwork is
// opaque by construction, so this only guarantees that antialiasing along the
// canvas edge cannot leave a sub-253 pixel behind and re-trigger the frame.
function flatten(image) {
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap(); // BGRA
    for (let i = 3; i < bitmap.length; i += 4) bitmap[i] = 255;
    return nativeImage.createFromBitmap(bitmap, { width, height });
}

async function render(name) {
    const { out, rootClass, opaque } = VARIANTS[name];
    const win = new BrowserWindow({
        width: SIZE,
        height: SIZE,
        useContentSize: true,
        show: false,
        frame: false,
        transparent: !opaque,
        backgroundColor: opaque ? '#0b0d12' : '#00000000',
        webPreferences: { offscreen: true, zoomFactor: 1 },
    });
    try {
        // Offscreen windows only produce a frame once they paint, so wait for
        // the first one instead of capturing a blank surface.
        const painted = new Promise(resolve => win.webContents.once('paint', () => resolve()));
        await win.loadURL(pageFor(rootClass));
        await painted;

        let image = await win.webContents.capturePage();
        // A HiDPI host captures at the display scale factor; supersample down.
        const { width } = image.getSize();
        if (width !== SIZE) image = image.resize({ width: SIZE, height: SIZE, quality: 'best' });
        if (opaque) image = flatten(image);

        writeFileSync(join(root, 'build', out), image.toPNG());
        console.log(`rendered build/${out} (${SIZE}x${SIZE}, captured at ${width}px)`);
    } finally {
        win.destroy();
    }
}

// Electron falls back to being a plain Node runtime when ELECTRON_RUN_AS_NODE
// is set (some editors and CI wrappers export it), and then there is no
// `app` to wait on. Say so instead of dying on an undefined property.
if (app == null) {
    console.error('No Electron app object. Run via `npm run icons`, with ELECTRON_RUN_AS_NODE unset.');
    process.exit(1);
}

app.whenReady().then(async () => {
    const requested = process.argv.slice(2).filter(a => a in VARIANTS);
    const names = requested.length ? requested : Object.keys(VARIANTS);
    try {
        for (const name of names) await render(name);
        app.exit(0);
    } catch (error) {
        console.error(error);
        app.exit(1);
    }
});

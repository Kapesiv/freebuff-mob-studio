/**
 * Varmentaja: nopea mobin vaihto tekstuurilatauksen aikana ei saa antaa
 * vanhan tekstuurin ylikirjoittaa uutta.
 *
 * Tausta: sovelluksen käynnistyksen oletusmobi (Stalker) lataa tekstuurinsa
 * asynkronisesti (new Image() + onload). Jos käyttäjä klikkaa toisen mobin
 * ennen kuin kuva on dekoodautunut, myöhässä saapuva onload voi ylikirjoittaa
 * juuri luodun tekstuurin — korjattu js/main.js:n applyTextureDataURL- ja
 * applyEmissiveTexture-funktioiden race-suojauksella.
 *
 * Testi ajaa oikean preview.html:n headless Chromessa ja tekee tilanteen
 * deterministiseksi: Image-konstruktori korvataan ennen sovellusmoduulia
 * luokalla, joka kaappaa onload-kutsun eikä kutsu sitä ennen
 * __RELEASE_TEXTURE_LOADS()-kutsua. Näin vanha mobin kuva on varmasti
 * "vielä latautumassa", kun uusi mobi klikataan.
 *
 * Skenaariot:
 *   1. fast-switch — oletusmobi (Stalker) lataa, klikataan Voxel Dragon
 *      (sukupolvitekstuuri). Vanhan latauksen vapautus ei saa muuttaa
 *      tekstuuria eikä asettaa emissiivistä kerrosta.
 *   2. legit-load — sama alku, klikataan False Hydra (tekstuuripohjainen).
 *      Vapautuksen jälkeen HYDRA:n tekstuuri + emissiivinen kerros pitää
 *      asettua (suojaus ei saa estää oikeaa latausta).
 *
 * HUOMIO: profiili on TUORE joka ajolla — sovellus autosäilöö localStorageen,
 * joten edellisen ajon tallennettu mobi muuttaisi bootin oletusmobin ja
 * testi antaisi väärän tuloksen (vanha tekstuuri olisi "sama" kuin uusi).
 *
 * Usage: npm run verify:race   (vaatii buildatun preview.html:n + Chromen)
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { LIBRARY_MOBS } from '../js/mobs/library.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewFile = path.join(root, 'preview.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- preview.html: rakennetaan uudelleen, jos se on vanhentunut -----------
function needsRebuild() {
    if (!existsSync(previewFile)) return true;
    const previewTime = statSync(previewFile).mtimeMs;
    for (const f of ['js/main.js', 'build-preview.mjs', 'js/animation.js', 'js/utils/boxuv.js', 'js/formats/bedrock.js']) {
        const p = path.join(root, f);
        if (existsSync(p) && statSync(p).mtimeMs > previewTime) return true;
    }
    return false;
}
if (needsRebuild()) {
    console.log('⚠ preview.html vanhentunut — rakennetaan (npm run build:preview)…');
    const { execSync } = await import('child_process');
    execSync('npm run build:preview', { cwd: root, stdio: 'inherit' });
}

// ---- Chrome ---------------------------------------------------------------
const chromeCandidates = process.env.CHROME_PATH
    ? [process.env.CHROME_PATH]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
const chromePath = chromeCandidates.find(p => existsSync(p));
if (!chromePath) {
    console.error('✗ Chrome/Chromium/Edge/Brave ei löydy. Asenna jokin tai aseta CHROME_PATH.');
    process.exit(1);
}

// ---- PNG-dekooderi (puhdas Node, ei riippuvuuksia) ------------------------
// Purkaa 8-bittiset RGB/RGBA/grayscale-PNG:t (filtterit 0–4) RGBA8:ksi.
import { inflateSync } from 'zlib';
function decodePng(buf) {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const bitDepth = buf[24], colorType = buf[25];
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
    if (bitDepth !== 8 || !channels) throw new Error(`tukematon PNG (depth ${bitDepth}, tyyppi ${colorType})`);
    let idat = Buffer.alloc(0);
    let off = 8;
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        if (type === 'IDAT') idat = Buffer.concat([idat, buf.subarray(off + 8, off + 8 + len)]);
        if (type === 'IEND') break;
        off += 12 + len;
    }
    const raw = inflateSync(idat);
    const stride = w * channels;
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        const filter = raw[y * (stride + 1)];
        const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
        for (let i = 0; i < stride; i++) {
            const a = i >= channels ? out[y * stride + i - channels] : 0;
            const b = prev ? prev[i] : 0;
            const c = (prev && i >= channels) ? prev[i - channels] : 0;
            let v = raw[y * (stride + 1) + 1 + i];
            switch (filter) {
                case 1: v = (v + a) & 255; break;
                case 2: v = (v + b) & 255; break;
                case 3: v = (v + ((a + b) >> 1)) & 255; break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
                    break;
                }
            }
            out[y * stride + i] = v;
        }
    }
    if (channels !== 4) {
        const rgba = Buffer.alloc(w * h * 4);
        for (let i = 0; i < w * h; i++) {
            if (channels === 3) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
            else { rgba[i * 4] = out[i]; rgba[i * 4 + 1] = out[i]; rgba[i * 4 + 2] = out[i]; rgba[i * 4 + 3] = 255; }
        }
        return { width: w, height: h, data: rgba };
    }
    return { width: w, height: h, data: out };
}

// ---- CDP-miniasiakas ------------------------------------------------------
async function getPageTarget(port) {
    for (let i = 0; i < 100; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = await res.json();
            const page = list.find(t => t.type === 'page');
            if (page) return page;
        } catch { /* chrome käynnistymässä */ }
        await sleep(100);
    }
    return null;
}

function connectCdp(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const pending = new Map();
        let nextId = 0;
        ws.onopen = () => resolve({
            send(method, params = {}) {
                return new Promise((res, rej) => {
                    const id = ++nextId;
                    pending.set(id, { res, rej });
                    ws.send(JSON.stringify({ id, method, params }));
                });
            },
            close() { try { ws.close(); } catch { /* */ } }
        });
        ws.onerror = () => reject(new Error('CDP-yhteys epäonnistui'));
        ws.onmessage = e => {
            const msg = JSON.parse(e.data);
            if (msg.id && pending.has(msg.id)) {
                const { res, rej } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) rej(new Error(msg.error.message));
                else res(msg.result);
            }
        };
    });
}

async function waitForDone(cdp) {
    for (let i = 0; i < 600; i++) { // 60 s
        const { result } = await cdp.send('Runtime.evaluate', {
            expression: 'window.__SHOT_DONE ? JSON.stringify(window.__SHOT_DONE) : null',
            returnByValue: true
        });
        const v = result && result.value;
        if (v) return JSON.parse(v);
        await sleep(100);
    }
    return { ok: false, msg: 'aikakatkaisu (60 s)' };
}

// ---- testiskriptit ---------------------------------------------------------
const mockSetup = `
<script>
(() => {
    // Image-mock asennetaan ENNEN sovellusmoduulia (classic-skripti ajaa
    // ennen type="module" -deferoitua bundlea). Kaapataan onload, jotta
    // "kuvan lataus kesken" -tilanne voidaan pitää hallinnassa: handler
    // vapautetaan vasta __RELEASE_TEXTURE_LOADS()-kutsulla.
    const pending = [];
    class MockImg extends window.Image {
        constructor() { super(); pending.push(this); this.__handlerRan = false; }
        set onload(fn) {
            // Kääritään handler virheiden tallennusta varten — jos se heittää,
            // tiedämme, että vika on testissä eikä sovelluksessa.
            this.__captured = (...args) => {
                this.__handlerRan = true;
                try { fn.apply(this, args); } catch (e) { this.__handlerError = String((e && e.message) || e); }
            };
        }
        get onload() { return this.__captured; }
    }
    window.Image = MockImg;
    window.__TEX_LOAD_PENDING = pending;
    window.__RELEASE_TEXTURE_LOADS = async () => {
        for (const img of pending.splice(0)) {
            // odota että oikea data-URL-dekoodaus on valmis, jotta drawImage
            // piirtää oikean kuvan (ei tyhjää)
            for (let i = 0; i < 200 && !(img.complete && img.naturalWidth); i++) {
                await new Promise(r => setTimeout(r, 10));
            }
            if (img.__captured) img.__captured.call(img);
        }
    };
})();
</script>
`;

function scenarioScript(scenario) {
    const mob = LIBRARY_MOBS.find(m => m.id === (scenario === 'fast-switch' ? 'vox_dragon' : 'false_hydra'));
    const emoji = mob.emoji, name = mob.name;
    return `
<script type="module">
(() => {
    window.requestAnimationFrame = () => 0;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const SCENARIO = ${JSON.stringify(scenario)};
    const EMOJI = ${JSON.stringify(emoji)};
    const NAME = ${JSON.stringify(name)};
    window.__SHOT_DONE = null;
    (async () => {
        try {
            for (let i = 0; i < 400; i++) {
                const s = window.__MOB_STUDIO;
                if (s && s.renderer && document.querySelectorAll('.mob-btn').length) break;
                await sleep(50);
            }
            const s = window.__MOB_STUDIO;
            if (!s || !s.renderer) { window.__SHOT_DONE = { ok: false, msg: 'studio not ready' }; return; }
            const click = () => {
                const b = [...document.querySelectorAll('.mob-btn')].find(x => x.textContent.startsWith(EMOJI + NAME));
                if (!b) throw new Error('card not found: ' + NAME);
                b.click();
            };
            const px = (x, y) => {
                const c = s.textureCanvas;
                if (!c) return null;
                const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
                return [d[0], d[1], d[2], d[3]];
            };
            click();
            if (SCENARIO === 'fast-switch') {
                // Voxel Dragonin tekstuuri syntyy synkronisesti (ei Imagea)
                for (let i = 0; i < 400 && !s.texture; i++) await sleep(50);
                const snap = () => ({
                    name: s.projectName,
                    texUrl: s.textureDataURL,
                    p00: px(0, 0), p30: px(30, 5), p100: px(100, 100),
                    emissive: !!s.emissiveTexture
                });
                const a = snap();
                await window.__RELEASE_TEXTURE_LOADS(); // vanha (Stalker) lataus yrittää kirjoittaa päälle
                await sleep(300);
                const b = snap();
                window.__SHOT_DONE = { ok: true, msg: JSON.stringify({ a, b }) };
            } else {
                // False Hydran tekstuuri on Image-pohjainen → jää odottamaan
                for (let i = 0; i < 100 && s.texture; i++) await sleep(20);
                await window.__RELEASE_TEXTURE_LOADS(); // Stalker + Hydra lataukset
                for (let i = 0; i < 400 && !s.texture; i++) await sleep(50);
                await window.__RELEASE_TEXTURE_LOADS(); // emissiivinen kerros (toinen Image)
                await sleep(300);
                // peitto: kuinka suuri osa tekstuurista on läpinäkymätöntä
                let covered = 0, samples = 0;
                const c = s.textureCanvas;
                const samplesAt = [[0, 0], [64, 64], [128, 128], [200, 100], [100, 200]];
                const pixelAt = [];
                if (c) {
                    const tctx = c.getContext('2d');
                    for (let y = 0; y < c.height; y += 32) {
                        for (let x = 0; x < c.width; x += 32) {
                            const d = tctx.getImageData(x, y, 1, 1).data;
                            samples++;
                            if (d[3] > 0) covered++;
                        }
                    }
                    for (const [x, y] of samplesAt) {
                        const d = tctx.getImageData(x, y, 1, 1).data;
                        pixelAt.push([x, y, [d[0], d[1], d[2], d[3]]]);
                    }
                }
                window.__SHOT_DONE = { ok: true, msg: JSON.stringify({
                    name: s.projectName,
                    texUrl: (s.textureDataURL || '').slice(0, 30),
                    texSize: c ? [c.width, c.height] : null,
                    coveredPct: samples ? Math.round(100 * covered / samples) : 0,
                    emissive: !!s.emissiveTexture,
                    pixelAt
                }) };
            }
        } catch (err) {
            window.__SHOT_DONE = { ok: false, msg: String((err && err.message) || err) };
        }
    })();
})();
</script>
`;
}

// ---- aja yksi skenaario ----------------------------------------------------
async function runScenario(scenario, port) {
    const html = readFileSync(previewFile, 'utf8')
        .replace('<script type="module">', mockSetup + '<script type="module">')
        .replace('</body>', () => scenarioScript(scenario) + '</body>');
    const tmpFile = path.join(tmpdir(), `freebuff-race-${scenario}-${Date.now()}.html`);
    writeFileSync(tmpFile, html);
    // TUORE profiili: autosäilöty mobi edellisestä ajosta väärentäisi bootin.
    const profile = path.join(tmpdir(), `freebuff-race-profile-${port}-${Date.now()}`);
    const flags = [
        '--no-first-run', '--no-default-browser-check',
        '--headless=new', '--hide-scrollbars',
        '--remote-debugging-port=' + port,
        '--user-data-dir=' + profile
    ];
    // ?nosplash: aloitusnäyttö ohitetaan — testi ei saa riippua siitä.
    const chrome = spawn(chromePath, [...flags, 'file://' + tmpFile + '?nosplash'], { stdio: 'ignore' });
    try {
        const target = await getPageTarget(port);
        if (!target) throw new Error('Chrome ei vastannut');
        const cdp = await connectCdp(target.webSocketDebuggerUrl);
        try {
            await cdp.send('Runtime.enable');
            const done = await waitForDone(cdp);
            return done;
        } finally {
            cdp.close();
        }
    } finally {
        chrome.kill();
        try { unlinkSync(tmpFile); } catch { /* */ }
        try { rmSync(profile, { recursive: true, force: true }); } catch { /* */ }
    }
}

// ---- tarkistukset ----------------------------------------------------------
let failures = 0;
function check(label, ok, detail) {
    console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ' — ' + (detail || '')}`);
    if (!ok) failures++;
}

// Skenaario 1: vanha lataus ei saa ylikirjoittaa uutta mobia
const r1 = await runScenario('fast-switch', 9430);
if (!r1.ok) {
    console.error(`✗ fast-switch: ${r1.msg}`);
    failures++;
} else {
    const { a, b } = JSON.parse(r1.msg);
    check('fast-switch: klikkaus lataa Voxel Dragonin', a.name === 'Voxel Dragon', `name=${a.name}`);
    check('fast-switch: dragonin tekstuuri on paikallaan (valkoinen pohja + teal)', JSON.stringify(a.p00) === JSON.stringify([255, 255, 255, 255]), `p00=${a.p00}`);
    check('fast-switch: ei textureDataURL:a (generoitu tekstuuri)', a.texUrl === null, `texUrl=${a.texUrl}`);
    check('fast-switch: tekstuuri EI muutu vanhan latauksen vapautuksen jälkeen', JSON.stringify(a) === JSON.stringify(b), `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
    check('fast-switch: ei emissiivistä kerrosta (Stalkerin glow ei vuoda)', a.emissive === false && b.emissive === false, `emissive=${a.emissive}/${b.emissive}`);
}

// Skenaario 2: oikea lataus toimii yhä (suojaus ei estä kaikkea)
const r2 = await runScenario('legit-load', 9431);
if (!r2.ok) {
    console.error(`✗ legit-load: ${r2.msg}`);
    failures++;
} else {
    const d = JSON.parse(r2.msg);
    // Oikea vertailukuva: hydran textureDataURL dekoodataan ja verrataan
    // sivun tekstuurikankaan pikseleihin samassa pisteessä — jos vanha
    // (Stalkerin) lataus olisi kirjoittanut päälle, pikselit eroaisivat.
    const hydra = LIBRARY_MOBS.find(m => m.id === 'false_hydra');
    const png = Buffer.from(hydra.textureDataURL.split(',')[1], 'base64');
    const decoded = decodePng(png);
    const tex = (x, y) => {
        const i = (y * decoded.width + x) * 4;
        return [decoded.data[i], decoded.data[i + 1], decoded.data[i + 2], decoded.data[i + 3]];
    };

    check('legit-load: klikkaus lataa False Hydran', d.name === 'False Hydra', `name=${d.name}`);
    check('legit-load: hydran tekstuuri asettuu (data URL)', typeof d.texUrl === 'string' && d.texUrl.startsWith('data:image/png'), `texUrl=${d.texUrl}`);
    check('legit-load: tekstuurikangas on täytetty (peitto > 10 %)', d.coveredPct > 10, `peitto=${d.coveredPct}%`);
    check('legit-load: emissiivinen kerros asettuu (glow)', d.emissive === true, `emissive=${d.emissive}`);
    const mismatch = (d.pixelAt || []).filter(([x, y, got]) => JSON.stringify(got) !== JSON.stringify(tex(x, y)));
    check('legit-load: kangas sisältää TÄSMÄLLEEN hydran tekstuurin (ei Stalkerin)', mismatch.length === 0, `${mismatch.length} pistettä eroaa (${mismatch.map(([x, y]) => `${x},${y}`).join('; ')})`);
}

console.log(failures ? `\n✗ ${failures} tarkistusta epäonnistui` : '\n✅ race-suojaus toimii: vanha tekstuuri ei ylikirjoita uutta');
process.exitCode = failures ? 1 : 0;

/**
 * Renderöi mobeista 900×900 PNG-kuvat sovelluksen omalla THREE.js-rendererillä
 * (sama prosessi kuin editorissa). Kuva tallennetaan examples/<id>.png
 * (päivä) tai examples/<id>_night.png (yö).
 *
 * Tekniikka: preview.html on täysin itsenäinen (inline-bundle), joten se
 * toimii file://-osoitteesta. Työkalu injektoi sen perään kuvausskriptin,
 * joka lataa mobin kirjastokortista, odottaa tekstuurin, kehystää kameran
 * mallin bboxista ja renderöi 900×900. Headless Chromea ohjataan DevTools
 * Protocolin yli: työkalu odottaa skriptin valmistumissignaalia ja ottaa
 * sitten ruutukaappauksen — ei virtuaaliaika-hakkeja.
 *
 * Usage:
 *   npm run build:preview                       # vaaditaan kerran
 *   node tools/export-example-shots.mjs                    # 4 README-mobia, päivä
 *   node tools/export-example-shots.mjs --night            # samat, yötila
 *   node tools/export-example-shots.mjs --all              # molemmat
 *   node tools/export-example-shots.mjs false_hydra vox_dragon   # valitut
 *   node tools/export-example-shots.mjs --all --out=/tmp/fresh   # scratch-kansioon (vertailua varten)
 *   node tools/export-example-shots.mjs --library          # KOKO kirjasto → examples/gallery/
 *   node tools/export-example-shots.mjs --library --all    # koko kirjasto, päivä + yö
 *   node tools/export-example-shots.mjs --library --category=deepvoid
 *   node tools/export-example-shots.mjs --library --jobs=4 # 4 Chromea rinnakkain
 *
 * --library kirjoittaa kuvat examples/gallery/-kansioon ja generoi sinne
 * index.html-galleriasivun (☀️/🌙 -vaihto). --jobs=N renderöi N mobia
 * rinnakkain (oletus 1). Epäonnistuneet mobit listataan lopussa, mutta
 * onnistuneet kuvat jäävät levylle.
 *
 * Chrome etsitään CHROME_PATH-ympäristömuuttujasta tai yleisistä
 * asennuspoluista (Chrome, Chromium, Edge, Brave).
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { LIBRARY_MOBS } from '../js/mobs/library.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_IDS = ['stalker', 'false_hydra', 'weaver_of_souls', 'vox_dragon'];
const SIZE = 900;
const CATEGORY_LABELS = { deepvoid: 'Deep Void', vanilla: 'Vanilla', voxel: 'Voxel Animals', template: 'Template' };

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
// Lisälippuja voi antaa CHROME_FLAGS-ympäristömuuttujalla (välilyönnein
// erotettuina), esim. CHROME_FLAGS="--enable-gpu --use-angle=metal".
const extraChromeFlags = (process.env.CHROME_FLAGS || '').trim().split(/\s+/).filter(Boolean);
const chromePath = chromeCandidates.find(p => existsSync(p));
if (!chromePath) {
    console.error('✗ Chrome/Chromium/Edge/Brave ei löydy. Asenna jokin tai aseta CHROME_PATH.');
    process.exit(1);
}

const previewFile = path.join(root, 'preview.html');
if (!existsSync(previewFile)) {
    console.error('✗ preview.html puuttuu — aja ensin "npm run build:preview".');
    process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Mobi-id, jota voi käyttää tiedostonimessä (pohjalla ei ole id:tä). */
function mobId(mob) {
    if (mob.id) return mob.id;
    const base = (mob.model && mob.model.modelId) ? mob.model.modelId.replace('geometry.', '') : mob.name;
    return base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'mob';
}

// ---- kuvausskripti, joka injektoidaan preview.html:n perään --------------
function captureScript(emoji, name, night) {
    const bg = night ? 0x0b1020 : 0x24292f;
    return `
<script type="module">
(() => {
    // Pysäytä sovelluksen RAF-render-looppi heti, jotta headless-ajo ei
    // renderöi jatkuvasti (isojen mobien varjot SwiftShaderilla).
    window.requestAnimationFrame = () => 0;
    const NAME = ${JSON.stringify(name)};
    const EMOJI = ${JSON.stringify(emoji)};
    const NIGHT = ${night};
    const sleep = ms => new Promise(r => setTimeout(r, ms));
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
            const btn = [...document.querySelectorAll('.mob-btn')].find(b => b.textContent.startsWith(NAME));
            if (!btn) { window.__SHOT_DONE = { ok: false, msg: 'card not found: ' + NAME }; return; }
            btn.click();
            for (let i = 0; i < 400 && !s.texture; i++) await sleep(50);
            // Anna mobin omien asynkronisten tekstuurilatausten asettua
            // (esim. oletusmobin kuva ei saa ylikirjoittaa tätä mobia) ja
            // animaation/Game Previewin siirtyä päälle.
            await sleep(300);
            if (NIGHT && s.setGamePreviewNight) s.setGamePreviewNight(true);

            // bbox kuutioiden maailmankulmista (plain-JS matriisilasku)
            const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
            for (const mesh of s.cubes) {
                mesh.updateMatrixWorld(true);
                const m = mesh.matrixWorld.elements;
                const p = mesh.geometry.parameters;
                if (!p || !p.width) continue;
                const hx = p.width / 2, hy = p.height / 2, hz = p.depth / 2;
                for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
                    const x = sx * hx, y = sy * hy, z = sz * hz;
                    const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
                    const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
                    const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
                    if (wx < min[0]) min[0] = wx; if (wy < min[1]) min[1] = wy; if (wz < min[2]) min[2] = wz;
                    if (wx > max[0]) max[0] = wx; if (wy > max[1]) max[1] = wy; if (wz > max[2]) max[2] = wz;
                }
            }
            const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
            const radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
            const dist = radius * 2.6 + 2;
            const cam = s.camera;
            cam.aspect = 1;
            cam.near = Math.max(0.01, dist / 100);
            cam.far = Math.max(1000, dist * 10);
            cam.position.set(center[0] - dist * 0.72, center[1] + dist * 0.55, center[2] - dist * 0.72);
            cam.lookAt(center[0], center[1], center[2]);
            cam.updateProjectionMatrix();
            const dpr = s.renderer.getPixelRatio();
            const cw = s.renderer.domElement.width, ch = s.renderer.domElement.height;
            s.renderer.setPixelRatio(1);
            s.renderer.setSize(${SIZE}, ${SIZE}, false);
            s.renderer.setClearColor(${bg});
            s.renderer.render(s.scene, cam);
            const url = s.renderer.domElement.toDataURL('image/png');
            s.renderer.setPixelRatio(dpr);
            s.renderer.setSize(cw, ch, false);
            cam.aspect = 1;
            cam.updateProjectionMatrix();
            const img = document.createElement('img');
            img.src = url;
            img.style.cssText = 'position:fixed;inset:0;width:${SIZE}px;height:${SIZE}px;background:#${bg.toString(16)};z-index:99998';
            document.body.appendChild(img);
            document.body.style.background = '#${bg.toString(16)}';
            await sleep(400); // anna compositorin piirtää
            window.__SHOT_DONE = { ok: true, msg: 'rendered' };
        } catch (err) {
            window.__SHOT_DONE = { ok: false, msg: String((err && err.message) || err) };
        }
    })();
})();
</script>
`;
}

// ---- CDP: minimaalinen DevTools Protocol -asiakas -------------------------
async function getPageTarget(port) {
    for (let i = 0; i < 100; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/list`);
            const list = await res.json();
            const page = list.find(t => t.type === 'page');
            if (page) return page;
        } catch { /* chrome vielä käynnistymässä */ }
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

const SHOT_WAIT_MS = Number(process.env.SHOT_WAIT_MS || 60000); // hidas ympäristö (esim. qemu-emulaatio) voi tarvita enemmän
async function waitForShotDone(cdp) {
    for (let i = 0; i < SHOT_WAIT_MS / 100; i++) {
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

function validatePng(file) {
    if (!existsSync(file)) return 'tiedostoa ei syntynyt';
    const buf = readFileSync(file);
    if (buf.length < 64 || buf.readUInt32BE(0) !== 0x89504e47) return 'ei kelvollinen PNG';
    // Pienet mobit (esim. yhden kuution silmä) pakkautuvat alle 5 KB —
    // vain rikkinäinen renderi tuottaa oikeasti tyhjän tiedoston.
    if (buf.length < 1200) return `liian pieni (${buf.length} B)`;
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w !== SIZE || h !== SIZE) return `väärä koko ${w}×${h}`;
    return null;
}

// ---- aja yksi mobi --------------------------------------------------------
async function shotMob(mob, night, port, outDir) {
    const id = mobId(mob);
    const html = readFileSync(previewFile, 'utf8').replace('</body>', () => captureScript(mob.emoji, mob.name, night) + '</body>');
    const tmpFile = path.join(tmpdir(), `freebuff-shot-${id}${night ? '_night' : ''}.html`);
    writeFileSync(tmpFile, html);
    const outFile = path.join(outDir, `${id}${night ? '_night' : ''}.png`);
    const profile = path.join(tmpdir(), `freebuff-shot-profile-${port}`);
    const flags = [
        '--no-first-run',
        '--no-default-browser-check',
        ...extraChromeFlags,
        '--window-size=' + SIZE + ',' + SIZE,
        '--remote-debugging-port=' + port,
        '--user-data-dir=' + profile
    ];
    if (!process.env.SHOT_HEADED) flags.push('--headless=new', '--hide-scrollbars');
    // ?nosplash: aloitusnäyttö ohitetaan kuvaustilassa — kuvat pysyvät
    // identtisinä riippumatta localStorage-tilasta.
    const chrome = spawn(chromePath, [...flags, 'file://' + tmpFile + '?nosplash'], { stdio: 'ignore' });
    let doneMsg = null;

    try {
        const target = await getPageTarget(port);
        if (!target) { console.error(`✗ ${id}: Chrome ei vastannut`); return false; }
        const cdp = await connectCdp(target.webSocketDebuggerUrl);
        try {
            await cdp.send('Page.enable');
            await cdp.send('Runtime.enable');
            // Pakota viewport täsmälleen 900×900:ksi (headless-windowin
            // todellinen sisäkorkeus vaihtelee selaimittain).
            await cdp.send('Emulation.setDeviceMetricsOverride', {
                width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false
            });
            const done = await waitForShotDone(cdp);
            doneMsg = done.msg;
            if (!done.ok) { console.error(`✗ ${id}${night ? ' (yö)' : ''}: ${done.msg}`); return false; }
            await sleep(300);
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
        } finally {
            cdp.close();
        }
        const err = validatePng(outFile);
        if (err) { console.error(`✗ ${id}${night ? ' (yö)' : ''}: ${err}`); return false; }
        const kb = (readFileSync(outFile).length / 1024).toFixed(0);
        console.log(`✓ ${id}${night ? '_night' : ''} → ${path.relative(root, outFile)} (${kb} KB)`);
        if (doneMsg && doneMsg !== 'rendered') console.log(`   ℹ ${doneMsg}`);
        return true;
    } catch (e) {
        console.error(`✗ ${id}${night ? ' (yö)' : ''}: ${e.message}`);
        return false;
    } finally {
        chrome.kill();
        try { unlinkSync(tmpFile); } catch { /* */ }
    }
}

/** Aja tehtävälista rinnakkain (jobs = montako yhtä aikaa). */
async function runPool(tasks, jobs) {
    const results = new Array(tasks.length).fill(false);
    let next = 0;
    const worker = async () => {
        while (next < tasks.length) {
            const i = next++;
            results[i] = await tasks[i]();
        }
    };
    const n = Math.max(1, Math.min(jobs, tasks.length));
    await Promise.all(Array.from({ length: n }, worker));
    return results;
}

/** Generoi examples/gallery/index.html -galleriasivun. */
function writeGalleryPage(renderedMobs, wantDay, wantNight, failed) {
    const outDir = path.join(root, 'examples', 'gallery');
    const mobs = renderedMobs.slice().sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const sections = Object.entries(CATEGORY_LABELS)
        .map(([cat, label]) => {
            const list = mobs.filter(m => m.category === cat);
            if (!list.length) return '';
            const cards = list.map(m => {
                const id = mobId(m);
                const hasNight = existsSync(path.join(outDir, `${id}_night.png`));
                const tier = m.tier === 'boss' ? 'BOSS' : '';
                const nightImg = hasNight
                    ? `<img class="night" src="${id}_night.png" alt="${m.name} at night" loading="lazy" />`
                    : '';
                // Koko kortti on linkki editoriin: ../preview.html?mob=<id>
                // data-size/data-name: haku- ja kokosuodattimille
                return `<figure data-size="${m.sizeClass || ''}" data-name="${m.name.toLowerCase().replace(/"/g, '&quot;')}">
                    <a class="frame" href="../preview.html?mob=${id}" title="Open ${m.name} in editor">
                        <img class="day" src="${id}.png" alt="${m.name}" loading="lazy" />
                        ${nightImg}
                        ${tier ? `<span class="tier">${tier}</span>` : ''}
                        <span class="edit">Edit</span>
                        <span class="badge">${m.size != null ? m.size.toFixed(1) + ' blocks' : ''}</span>
                    </a>
                    <figcaption>${m.name}</figcaption>
                </figure>`;
            }).join('\n');
            return `<h2>${label} <span class="count">${list.length}</span></h2>
                <div class="grid">${cards}</div>`;
        })
        .join('\n');
    const failNote = failed.length
        ? `<p class="warn">${failed.length} mobia epäonnistui: ${failed.map(m => m.name).join(', ')}</p>`
        : '';
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mob Gallery — ${mobs.length} mobs</title>
<style>
  body { margin: 0; padding: 24px; background: #1b1e23; color: #e9eaec;
         font: 14px/1.45 system-ui, -apple-system, sans-serif; }
  h1 { font-size: 19px; margin: 0 0 4px; letter-spacing: .2px; }
  .sub { color: #9aa3b0; margin: 0 0 20px; }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
  .toolbar input, .toolbar select { background: #171a1f; color: #e9eaec; border: 1px solid #333943;
         border-radius: 4px; padding: 6px 10px; font: inherit; }
  .toolbar input { flex: 1; min-width: 180px; }
  .toolbar input:focus, .toolbar select:focus { outline: none; border-color: #d4a45c; }
  .toolbar button { background: #2a2f37; color: #e9eaec; border: 1px solid #333943;
         border-radius: 4px; padding: 6px 14px; cursor: pointer; font: inherit; }
  .toolbar button:hover { background: #343a44; }
  .toolbar button.active { background: #8f723f; border-color: #d4a45c; }
  .no-results { margin: 20px 0; color: #9aa3b0; font-size: 13px; }
  h2 { font-size: 12px; margin: 28px 0 12px; color: #d4a45c; text-transform: uppercase;
       letter-spacing: .09em; font-weight: 600; }
  h2 .count { color: #6b7480; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 14px; }
  figure { margin: 0; }
  .frame { position: relative; display: block; color: inherit; text-decoration: none;
           border: 1px solid #333943; border-radius: 4px;
           overflow: hidden; background: #23272e; transition: border-color .15s; }
  .frame:hover { border-color: #d4a45c; }
  .frame img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; }
  .frame img.night { display: none; }
  body.night .frame img.day { display: none; }
  body.night .frame img.night { display: block; }
  .tier { position: absolute; top: 6px; left: 6px; background: rgba(212,164,92,.16);
          color: #d4a45c; border: 1px solid rgba(212,164,92,.4); font-size: 9px;
          font-weight: 600; letter-spacing: .6px; padding: 2px 6px; border-radius: 3px; }
  .edit { position: absolute; right: 6px; top: 6px; background: rgba(27,30,35,.85);
          color: #e9eaec; border: 1px solid #333943; font-size: 10px; padding: 2px 6px; border-radius: 3px; }
  .frame:hover .edit { border-color: #d4a45c; color: #d4a45c; }
  .badge { position: absolute; right: 6px; bottom: 6px; background: rgba(0,0,0,.55);
           color: #c6cad1; font-size: 11px; padding: 2px 6px; border-radius: 3px; }
  figcaption { margin-top: 6px; font-size: 13px; color: #b6bcc6; text-align: center;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toplink { color: #d4a45c; text-decoration: none; margin-left: 12px; font-size: 13px; }
  .toplink:hover { text-decoration: underline; }
  .warn { color: #e0a26b; }
</style>
</head>
<body>
  <h1>Freebuff Mob Studio — Library <a class="toplink" href="../preview.html">← Open in editor</a></h1>
  <p class="sub">${mobs.length} mobs · rendered with the app's own renderer (${wantDay ? 'day' : ''}${wantDay && wantNight ? ' + ' : ''}${wantNight ? 'night' : ''}) · click a card to open the mob in the editor</p>
  <div class="toolbar">
    <input id="filter-search" type="search" placeholder="Search mobs…" oninput="applyFilter()" autocomplete="off" />
    <select id="filter-size" onchange="applyFilter()" title="Size">
      <option value="all">All sizes</option>
      <option value="jatti">Giant (≥8.5)</option>
      <option value="iso">Large (4–8.5)</option>
      <option value="keski">Medium (1.5–4)</option>
      <option value="pieni">Small (&lt;1.5)</option>
    </select>
    ${wantDay && wantNight ? `<button id="btn-day" class="active" onclick="document.body.classList.remove('night');this.classList.add('active');document.getElementById('btn-night').classList.remove('active')">Day</button>
    <button id="btn-night" onclick="document.body.classList.add('night');this.classList.add('active');document.getElementById('btn-day').classList.remove('active')">Night</button>` : ''}
  </div>
  <p id="no-results" class="no-results" hidden>No results — try a different search or clear the filters.</p>
  ${failNote}
  ${sections}
<script>
function applyFilter() {
  var q = (document.getElementById('filter-search').value || '').toLowerCase().trim();
  var size = document.getElementById('filter-size').value;
  var visible = 0;
  document.querySelectorAll('figure').forEach(function (f) {
    var okSize = size === 'all' || f.dataset.size === size;
    var okQ = !q || (f.dataset.name || '').indexOf(q) !== -1;
    var show = okSize && okQ;
    f.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.querySelectorAll('h2').forEach(function (h) {
    var grid = h.nextElementSibling;
    var hasVisible = grid && [].some.call(grid.querySelectorAll('figure'), function (f) { return f.style.display !== 'none'; });
    h.style.display = hasVisible ? '' : 'none';
  });
  document.getElementById('no-results').hidden = visible > 0;
}
</script>
</body>
</html>`;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'index.html'), html);
}

// ---- pää ------------------------------------------------------------------
const args = process.argv.slice(2);
const night = args.includes('--night');
const all = args.includes('--all');
const library = args.includes('--library');
const jobsArg = args.find(a => a.startsWith('--jobs='));
const jobs = jobsArg ? Math.max(1, parseInt(jobsArg.split('=')[1], 10) || 1) : 1;
const catArg = args.find(a => a.startsWith('--category='));
const category = catArg ? catArg.split('=')[1] : null;
if (category && !CATEGORY_LABELS[category]) {
    console.error(`✗ Tuntematon kategoria "${category}" — vaihtoehdot: ${Object.keys(CATEGORY_LABELS).join(', ')}`);
    process.exit(1);
}
const ids = args.filter(a => !a.startsWith('--'));
const wantsNight = night || all;
const wantsDay = !night || all;

const outArg = args.find(a => a.startsWith('--out='));
const outDirBase = outArg ? path.resolve(outArg.split('=')[1]) : path.join(root, 'examples');
let mobs;
let outDir = outDirBase;
if (library) {
    mobs = LIBRARY_MOBS.slice();
    if (category) mobs = mobs.filter(m => m.category === category);
    outDir = path.join(outDir, 'gallery');
    console.log(`Kirjasto: ${mobs.length} mobia (${category || 'kaikki'}) → examples/gallery/ (${jobs} rinnakkaista)`);
} else {
    const idList = ids.length ? ids : DEFAULT_IDS;
    mobs = idList.map(id => {
        const m = LIBRARY_MOBS.find(x => x.id === id);
        if (!m) { console.error(`✗ mobia "${id}" ei ole kirjastossa.`); process.exit(1); }
        return m;
    });
}

mkdirSync(outDir, { recursive: true });
console.log(`Chrome: ${chromePath}`);
let portCounter = 9330;
const tasks = [];
for (const mob of mobs) {
    if (wantsDay) { const port = portCounter++; tasks.push(() => shotMob(mob, false, port, outDir)); }
    if (wantsNight) { const port = portCounter++; tasks.push(() => shotMob(mob, true, port, outDir)); }
}
const results = await runPool(tasks, jobs);

// Epäonnistuneet mobit (yksilöidään, jotta molemmat päivä/yö-ajot eivät tuplaa listaa)
const failed = [];
const seen = new Set();
mobs.forEach((m, i) => {
    const dayOk = !wantsDay || results[i * (wantsDay && wantsNight ? 2 : 1)];
    const nightOk = !wantsNight || results[i * (wantsDay && wantsNight ? 2 : 1) + (wantsDay ? 1 : 0)];
    if ((!dayOk || !nightOk) && !seen.has(m.id)) { seen.add(m.id); failed.push(m); }
});

let okCount = 0, total = results.length;
results.forEach(r => { if (r) okCount++; });
console.log(`\n${okCount}/${total} kuvaa onnistui → ${path.relative(root, outDir)}/`);

if (library) {
    writeGalleryPage(mobs, wantsDay, wantsNight, failed);
    console.log(`Galleria: ${path.relative(root, path.join(outDir, 'index.html'))} (${mobs.length} mobia)`);
}

if (failed.length) {
    console.error(`\n✗ Epäonnistuneet (${failed.length}): ${failed.map(m => `${m.name} (${mobId(m)})`).join(', ')}`);
    process.exitCode = 1;
}

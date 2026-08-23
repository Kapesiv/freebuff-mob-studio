/**
 * Varmentaja: tallennussiivous (js/main.js cleanupStaleData) toimii oikein.
 *
 * Tausta: sovellus siivoaa kerran bootissa yli 30 päivää vanhat tallennukset
 * (deeplink-autosave-avaimet, tavallinen autosave ja 'Omat olennot' -lista).
 * Testi ajaa oikean preview.html:n headless Chromessa ?mob=allay -deeplinkillä
 * ja kirjoittaa ENNEN sovellusmoduulia localStorageen testiavaimet:
 *
 *   avain                                odotus
 *   …_deeplink_orphan_mob   (tuore, ei kirjastossa)   → POISTETAAN
 *   …_deeplink_vox_dragon   (40 pv, kirjastossa)      → POISTETAAN
 *   …_deeplink_allay        (40 pv, AKTIIVINEN)       → JÄÄ + päivittyy
 *   …_deeplink_cat          (tuore, ei aktiivinen)    → JÄÄ
 *   …_deeplink_stalker      (ei aikaleimaa)           → JÄÄ (ikä tuntematon)
 *   freebuff_mobstudio_project_v5 (40 pv, ei aktiivinen) → POISTETAAN
 *   omat olennot: 1 vanha (40 pv) + 1 tuore           → vanha POISTETAAN
 *
 * Statusrivin pitää myös kertoa siivouksesta ("🧹 4 vanhaa tallennusta…").
 *
 * HUOMIO: profiili on TUORE joka ajolla (localStorage ei saa jäädä
 * edellisestä ajosta). file://-localStorage on profiilikohtainen, joten
 * TUORE profiili takaa puhtaan lähtötilan.
 *
 * Usage: npm run verify:cleanup   (vaatii buildatun preview.html:n + Chromen)
 */
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewFile = path.join(root, 'preview.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- preview.html: rakennetaan uudelleen, jos se on vanhentunut -----------
function needsRebuild() {
    if (!existsSync(previewFile)) return true;
    const previewTime = statSync(previewFile).mtimeMs;
    for (const f of ['js/main.js', 'build-preview.mjs', 'js/animation.js']) {
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

// ---- testidata localStorageen ENNEN sovellusmoduulia ----------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const setupScript = `
<script>
(() => {
    // Classic-skripti ajaa ennen type="module" -bundlea → testiavaimet ovat
    // paikallaan, kun cleanupStaleData käynnistyy bootissa.
    const base = 'freebuff_mobstudio_project_v5';
    const now = Date.now();
    const model = { modelId: 'geometry.test', bones: [], textureWidth: 64, textureHeight: 64 };
    const put = (k, savedAt) => localStorage.setItem(
        base + '_deeplink_' + k,
        JSON.stringify({ savedAt, model, projectName: k })
    );
    put('orphan_mob', now);                 // ei kirjastossa → orpo
    put('vox_dragon', now - 40 * ${DAY_MS}); // kirjastossa mutta > 30 pv
    put('allay', now - 40 * ${DAY_MS});      // > 30 pv JA aktiivinen (?mob=allay)
    put('cat', now);                        // tuore, ei aktiivinen
    put('stalker', undefined);              // ei aikaleimaa (ikä tuntematon)
    localStorage.setItem(base, JSON.stringify({   // tavallinen autosave: 40 pv
        savedAt: now - 40 * ${DAY_MS}, model, projectName: 'Vanha projekti'
    }));
    localStorage.setItem('freebuff_mobstudio_mycreatures_v1', JSON.stringify([
        { id: 'mine_old', name: 'Vanha olento', savedAt: now - 40 * ${DAY_MS}, model: { bones: [] } },
        { id: 'mine_fresh', name: 'Tuore olento', savedAt: now, model: { bones: [] } }
    ]));
})();
</script>
`;

// ---- kuvausskripti: tilanne bootin jälkeen --------------------------------
const captureScript = `
<script type="module">
(() => {
    window.requestAnimationFrame = () => 0;
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
            // Anna deeplinkin autosaven päivittyä (300 ms debounce + marginaali)
            await sleep(900);
            const base = 'freebuff_mobstudio_project_v5';
            const keys = Object.keys(localStorage)
                .filter(k => k.startsWith(base + '_deeplink_') || k === base || k === 'freebuff_mobstudio_mycreatures_v1');
            const allayRaw = localStorage.getItem(base + '_deeplink_allay');
            let allaySavedAt = null;
            try { allaySavedAt = JSON.parse(allayRaw).savedAt; } catch { /* */ }
            const creatures = JSON.parse(localStorage.getItem('freebuff_mobstudio_mycreatures_v1') || '[]')
                .map(c => c.name);
            window.__SHOT_DONE = { ok: true, msg: JSON.stringify({
                keys,
                allaySavedAt,
                allayFresh: typeof allaySavedAt === 'number' && (Date.now() - allaySavedAt) < 60000,
                creatures,
                status: document.getElementById('status-text').textContent
            }) };
        } catch (err) {
            window.__SHOT_DONE = { ok: false, msg: String((err && err.message) || err) };
        }
    })();
})();
</script>
`;

// ---- ajo ----------------------------------------------------------------
async function runScenario(port) {
    const html = readFileSync(previewFile, 'utf8')
        .replace('<script type="module">', setupScript + '<script type="module">')
        .replace('</body>', () => captureScript + '</body>');
    const tmpFile = path.join(tmpdir(), `freebuff-cleanup-${Date.now()}.html`);
    writeFileSync(tmpFile, html);
    // TUORE profiili: edellisen ajon localStorage väärentäisi testin.
    const profile = path.join(tmpdir(), `freebuff-cleanup-profile-${port}-${Date.now()}`);
    const flags = [
        '--no-first-run', '--no-default-browser-check',
        '--headless=new', '--hide-scrollbars',
        '--remote-debugging-port=' + port,
        '--user-data-dir=' + profile
    ];
    // ?mob=allay: deeplink-istunto (allay-avain on AKTIIVINEN) + ?nosplash:
    // aloitusnäyttö pois tieltä.
    const chrome = spawn(chromePath, [...flags, `file://${tmpFile}?mob=allay&nosplash`], { stdio: 'ignore' });
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

const r = await runScenario(9440);
if (!r.ok) {
    console.error(`✗ ajo epäonnistui: ${r.msg}`);
    process.exit(1);
}
const d = JSON.parse(r.msg);
const has = k => d.keys.includes(k);

check('orpo avain (mobi poistettu kirjastosta) → poistettu', !has('freebuff_mobstudio_project_v5_deeplink_orphan_mob'), JSON.stringify(d.keys));
check('yli 30 pv deeplink-avain → poistettu', !has('freebuff_mobstudio_project_v5_deeplink_vox_dragon'), JSON.stringify(d.keys));
check('AKTIIVINEN yli 30 pv avain (?mob=allay) → JÄÄ', has('freebuff_mobstudio_project_v5_deeplink_allay'), JSON.stringify(d.keys));
check('aktiivinen avain päivittyi tuoreeksi (savedAt)', d.allayFresh === true, `savedAt=${d.allaySavedAt}`);
check('tuore ei-aktiivinen avain → JÄÄ', has('freebuff_mobstudio_project_v5_deeplink_cat'), JSON.stringify(d.keys));
check('aikaleimaton avain (ikä tuntematon) → JÄÄ', has('freebuff_mobstudio_project_v5_deeplink_stalker'), JSON.stringify(d.keys));
check('yli 30 pv tavallinen autosave (ei aktiivinen) → poistettu', !has('freebuff_mobstudio_project_v5'), JSON.stringify(d.keys));
check('Omat olennot: vanha poistettu, tuore jää', JSON.stringify(d.creatures) === JSON.stringify(['Tuore olento']), JSON.stringify(d.creatures));
const m = d.status.match(/🧹 (\d+) vanhaa tallennusta siivottu/);
check('statusilmoitus näkyy ja luku on 4', !!m && m[1] === '4', d.status);

console.log(failures ? `\n✗ ${failures} tarkistusta epäonnistui` : '\n✅ tallennussiivous toimii: orpo/vanha poistetaan, tuore/aktiivinen säilyy, ilmoitus näkyy');
process.exit(failures ? 1 : 0);

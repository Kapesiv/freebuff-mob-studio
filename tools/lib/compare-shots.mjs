/**
 * Jaettu vertailulogiikka Esimerkkejä-kuville: PNG-dekoodaus ja
 * pikselitarkka vertailu toleransseilla. Käyttävät sekä
 * tools/verify-example-shots.mjs (natiivi) että
 * tools/verify-example-shots-ubuntu.mjs (docker-kontti) — sama
 * toleranssi ja sama raportointi joka alustalla.
 *
 * Toleranssit (oletukset mitattu macOS-vs-ubuntu-ajosta):
 *   tolerance    — max kanavapoikkeama yksittäiselle pikselille (12)
 *   maxDiffPct   — max osuus pikseleistä, jotka ylittävät toleranssin (2 %)
 *   maxMea       — max keskipoikkeama kanavaa kohti koko kuvassa (2)
 * Yksittäiset maxΔ-piikit (esim. reunojen antialiasointi) eivät yksinään
 * kaada tarkistusta — vain diff-osuus ja MEA toimivat portteina.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { inflateSync } from 'zlib';

export const DEFAULTS = { tolerance: 12, maxDiffPct: 2.0, maxMea: 2.0 };

/** Purkaa 8-bittiset RGB/RGBA/grayscale-PNG:t (filtterit 0–4) RGBA8:ksi. */
export function decodePng(buf) {
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

/** Vertaa kahta PNG-puskuria; palauttaa { dimsMismatch, mea, pct, maxDelta }. */
export function comparePngs(aBuf, bBuf, tolerance = DEFAULTS.tolerance) {
    const a = decodePng(aBuf), b = decodePng(bBuf);
    if (a.width !== b.width || a.height !== b.height) {
        return { dimsMismatch: true, mea: Infinity, pct: 100, maxDelta: 255 };
    }
    const n = a.width * a.height;
    let diffPx = 0, sum = 0, maxDelta = 0;
    for (let i = 0; i < n; i++) {
        const d1 = a.data[i * 4] - b.data[i * 4];
        const d2 = a.data[i * 4 + 1] - b.data[i * 4 + 1];
        const d3 = a.data[i * 4 + 2] - b.data[i * 4 + 2];
        sum += (Math.abs(d1) + Math.abs(d2) + Math.abs(d3)) / 3;
        const mx = Math.max(Math.abs(d1), Math.abs(d2), Math.abs(d3));
        if (mx > maxDelta) maxDelta = mx;
        if (mx > tolerance) diffPx++;
    }
    return { dimsMismatch: false, mea: sum / n, pct: 100 * diffPx / n, maxDelta };
}

/**
 * Vertaa kaksi kansiota: repo-esimerkit vs tuore render. Vertaa vain juuren
 * *.png-tiedostoja (gallery/ ei lasketa). Palauttaa epäonnistumisten määrän
 * ja tulostaa taulukon.
 */
export function compareExampleDirs(repoDir, freshDir, opts = {}) {
    const { tolerance = DEFAULTS.tolerance, maxDiffPct = DEFAULTS.maxDiffPct, maxMea = DEFAULTS.maxMea } = opts;
    let failures = 0;
    const check = (label, ok, detail) => {
        console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ' — ' + (detail || '')}`);
        if (!ok) failures++;
    };

    const repoFiles = readdirSync(repoDir).filter(f => f.endsWith('.png')).sort();
    const freshFiles = readdirSync(freshDir).filter(f => f.endsWith('.png')).sort();
    check('sama tiedostosarja (repo vs tuore render)',
        JSON.stringify(repoFiles) === JSON.stringify(freshFiles),
        `repo: ${repoFiles.join(',')} | tuore: ${freshFiles.join(',')}`);
    if (JSON.stringify(repoFiles) !== JSON.stringify(freshFiles)) return failures;

    console.log('');
    console.log(`${'kuva'.padEnd(24)} ${'koko'.padStart(9)} ${'MEA'.padStart(7)} ${'ero%'.padStart(7)} ${'maxΔ'.padStart(6)}  tulos`);
    for (const f of repoFiles) {
        const a = readFileSync(pathJoin(repoDir, f));
        const b = readFileSync(pathJoin(freshDir, f));
        const r = comparePngs(a, b, tolerance);
        const ok = !r.dimsMismatch && r.pct <= maxDiffPct && r.mea <= maxMea;
        const sizeTxt = r.dimsMismatch ? 'DIMS-ERO' : `${a.readUInt32BE(16)}×${a.readUInt32BE(20)}`;
        console.log(`${f.padEnd(24)} ${sizeTxt.padStart(9)} ${r.mea.toFixed(2).padStart(7)} ${r.pct.toFixed(2).padStart(7)} ${(r.maxDelta | 0).toString().padStart(6)}  ${ok ? '✅' : '❌'}`);
        check(`kuva ${f} toleranssissa`, ok, `MEA=${r.mea.toFixed(2)} ero=${r.pct.toFixed(2)}% maxΔ=${r.maxDelta | 0}`);
    }
    return failures;
}

const pathJoin = (a, b) => path.join(a, b);

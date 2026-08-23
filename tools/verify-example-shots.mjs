#!/usr/bin/env node
/**
 * Toistettavuusvarmentaja Esimerkkejä-kuville (natiivi, ilman Dockeria):
 * renderöi kuvat tuoreeseen scratch-kansioon ja vertaa ne repo-versioihin
 * toleransseilla. Epäonnistuu, jos ero ylittää toleranssin — sama tarkistus
 * kuin CI:n verify-example-shots-jobissa.
 *
 * Vertaa KAKSI sarjaa:
 *   1. examples/*.png          — 4 README-mobia × päivä/yö (--all)
 *   2. examples/gallery/*.png  — koko kirjasto (--library, tarvittaessa --all:
 *      yöversiot renderöidään vain jos repo-galleriassa niitä on)
 *
 * Vaatii Chromen (sama kuin tools/export-example-shots.mjs). Ajaa
 * build:preview:n automaattisesti, jos preview.html on vanhentunut.
 *
 * Usage:
 *   node tools/verify-example-shots.mjs
 *   node tools/verify-example-shots.mjs --tolerance=8 --max-diff-pct=1
 *   node tools/verify-example-shots.mjs --jobs=4        # galleria rinnakkain
 *   node tools/verify-example-shots.mjs --skip-gallery  # vain README-kuvat
 *   node tools/verify-example-shots.mjs --keep          # pidä scratch-kansio
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULTS, compareExampleDirs } from './lib/compare-shots.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewFile = path.join(root, 'preview.html');
const examplesDir = path.join(root, 'examples');
const galleryDir = path.join(examplesDir, 'gallery');

// ---- parametrit ------------------------------------------------------------
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const skipGallery = args.includes('--skip-gallery');
const jobsArg = args.find(a => a.startsWith('--jobs='));
const jobs = jobsArg ? Math.max(1, parseInt(jobsArg.split('=')[1], 10) || 1) : 4;
const tolArg = args.find(a => a.startsWith('--tolerance='));
const TOLERANCE = tolArg ? Number(tolArg.split('=')[1]) : DEFAULTS.tolerance;
const pctArg = args.find(a => a.startsWith('--max-diff-pct='));
const MAX_DIFF_PCT = pctArg ? Number(pctArg.split('=')[1]) : DEFAULTS.maxDiffPct;
const meaArg = args.find(a => a.startsWith('--max-mea='));
const MAX_MEA = meaArg ? Number(meaArg.split('=')[1]) : DEFAULTS.maxMea;

// ---- preview.html ajan tasalle -------------------------------------------------
function needsRebuild() {
    if (!existsSync(previewFile)) return true;
    const t = statSync(previewFile).mtimeMs;
    for (const f of ['js/main.js', 'build-preview.mjs', 'js/animation.js', 'js/utils/boxuv.js', 'js/formats/bedrock.js']) {
        const p = path.join(root, f);
        if (existsSync(p) && statSync(p).mtimeMs > t) return true;
    }
    return false;
}
if (needsRebuild()) {
    console.log('⚠ preview.html vanhentunut — rakennetaan (npm run build:preview)…');
    const r = spawnSync('npm', ['run', 'build:preview'], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
}

// ---- renderöi scratch-kansioon ---------------------------------------------
const scratch = path.join(tmpdir(), `freebuff-shot-verify-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
let failures = 0;

const render = (label, argsList) => {
    console.log(`\n🖼 ${label} → ${path.relative(root, scratch)}…`);
    const r = spawnSync('node', ['tools/export-example-shots.mjs', ...argsList], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) {
        console.error(`\n✗ Renderöinti epäonnistui (${label}) — ei voi verrata`);
        if (!keep) rmSync(scratch, { recursive: true, force: true });
        process.exit(r.status ?? 1);
    }
};

console.log(`\nToleranssit: max kanavapoikkeama ${TOLERANCE}, diff-osuus ≤ ${MAX_DIFF_PCT} %, MEA ≤ ${MAX_MEA}`);

// 1) README-kuvat (4 mobia × päivä/yö)
render('Esimerkkejä-kuvat (--all)', ['--all', `--out=${scratch}`]);
failures += compareExampleDirs(examplesDir, scratch, { tolerance: TOLERANCE, maxDiffPct: MAX_DIFF_PCT, maxMea: MAX_MEA });

// 2) Galleria (koko kirjasto) — jos repo-galleria on olemassa
if (!skipGallery && existsSync(galleryDir)) {
    // Renderöidään sama tila kuin repo-galleriassa: yöversiot vain jos niitä on
    const galleryHasNight = readdirSync(galleryDir).some(f => f.endsWith('_night.png'));
    const galleryArgs = ['--library', `--out=${scratch}`, `--jobs=${jobs}`];
    if (galleryHasNight) galleryArgs.push('--all');
    render(`Galleria (--library${galleryHasNight ? ' --all' : ''}, ${jobs} rinnakkain)`, galleryArgs);
    console.log('');
    failures += compareExampleDirs(galleryDir, path.join(scratch, 'gallery'), { tolerance: TOLERANCE, maxDiffPct: MAX_DIFF_PCT, maxMea: MAX_MEA });
} else if (!skipGallery) {
    console.log('\nℹ examples/gallery/ ei ole — galleriavertailu ohitettu');
}

if (!keep) rmSync(scratch, { recursive: true, force: true });
console.log(failures
    ? `\n✗ ${failures} tarkistusta epäonnistui — kuvat eivät ole toistettavia (ajaa node tools/export-example-shots.mjs --all ja committaa kuvat)`
    : '\n✅ Esimerkkejä-kuvat ja galleria ovat toistettavia: tuore render vastaa repo-versioita toleranssissa');
process.exitCode = failures ? 1 : 0;

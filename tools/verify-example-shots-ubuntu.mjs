#!/usr/bin/env node
/**
 * Toistettava vertailu: renderöi Esimerkkejä-kuvat ubuntu-kontissa ja
 * vertaa ne repo-versioihin (examples/*.png) pikselitarkasti.
 *
 * Kontti ajaa TÄSMÄLLEEN samoilla vaiheilla kuin CI-workflow
 * (.github/workflows/example-shots.yml):
 *   npm ci → Google Chrome (deb) → npm run build:preview
 *   → node tools/export-example-shots.mjs --all
 *
 * Vertailu (puhdas Node, ei riippuvuuksia):
 *   - sama tiedostosarja examples/-juuressa (gallery/ ei lasketa)
 *   - samat kuvakoot
 *   - toleranssi: max kanavapoikkeama (oletus 12) ja diff-osuus (oletus 2 %)
 *
 * Usage:
 *   node tools/verify-example-shots-ubuntu.mjs            # koko ajo + vertailu
 *   node tools/verify-example-shots-ubuntu.mjs --rebuild-image
 *   node tools/verify-example-shots-ubuntu.mjs --tolerance=8 --max-diff-pct=1
 *   node tools/verify-example-shots-ubuntu.mjs --keep     # pidä työtila
 *   node tools/verify-example-shots-ubuntu.mjs --no-platform-pin  # älä pakota amd64
 *
 * Vaaditaan: Docker (kontti rakennetaan automaattisesti, jos ei ole).
 * Apple Siliconilla amd64-emulaatio on hidas — koko ajo vie 3–6 min.
 */
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULTS, compareExampleDirs } from './lib/compare-shots.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = 'freebuff-example-shots-verify';
const EXAMPLES = path.join(root, 'examples');

// ---- parametrit ------------------------------------------------------------
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const rebuildImage = args.includes('--rebuild-image');
const pinAmd64 = !args.includes('--no-platform-pin');
const tolArg = args.find(a => a.startsWith('--tolerance='));
const TOLERANCE = tolArg ? Number(tolArg.split('=')[1]) : DEFAULTS.tolerance;
const pctArg = args.find(a => a.startsWith('--max-diff-pct='));
const MAX_DIFF_PCT = pctArg ? Number(pctArg.split('=')[1]) : DEFAULTS.maxDiffPct;
const meaArg = args.find(a => a.startsWith('--max-mea='));
const MAX_MEA = meaArg ? Number(meaArg.split('=')[1]) : DEFAULTS.maxMea;

const platformFlag = pinAmd64 ? ['--platform', 'linux/amd64'] : [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- Docker-apurit ---------------------------------------------------------
function dockerAvailable() {
    const { status, error } = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' });
    if (error) { console.error(`✗ Docker ei käynnisty: ${error.message}`); return false; }
    return status === 0;
}

function imageExists() {
    const { status } = spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' });
    return status === 0;
}

function runDocker(argsList, { timeoutMs = 20 * 60 * 1000, input = null } = {}) {
    return new Promise((resolve) => {
        const child = spawn('docker', argsList, { stdio: input !== null ? ['pipe', 'inherit', 'inherit'] : 'inherit' });
        const timer = setTimeout(() => { console.error('⏱ aikakatkaisu — docker-komento ei valmistunut'); child.kill('SIGKILL'); }, timeoutMs);
        if (input !== null) child.stdin.end(input);
        child.on('close', code => { clearTimeout(timer); resolve(code ?? 1); });
        child.on('error', e => { clearTimeout(timer); console.error('✗ docker-käynnistys epäonnistui:', e.message); resolve(1); });
    });
}

// ---- konttikuvan rakennus (sama asennus kuin workflow'ssa) -----------------
const DOCKERFILE = `
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y curl wget ca-certificates \\
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\
    && apt-get install -y nodejs \\
    && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \\
    && apt-get install -y ./google-chrome-stable_current_amd64.deb \\
    && rm -f google-chrome-stable_current_amd64.deb
RUN node --version && google-chrome --version
`;

async function ensureImage() {
    if (!rebuildImage && imageExists()) return true;
    console.log(`\n🔨 Rakennetaan konttikuva ${IMAGE} (Node 22 + Google Chrome, kuten runnerilla)…`);
    const ctx = path.join(tmpdir(), 'freebuff-ub-buildctx');
    mkdirSync(ctx, { recursive: true });
    // docker build -f - <ctx> lukee Dockerfilen stdinistä
    const code = await runDocker(['build', ...platformFlag, '-t', IMAGE, '-f', '-', ctx], { input: DOCKERFILE });
    if (code !== 0) return false;
    try { rmSync(ctx, { recursive: true, force: true }); } catch { /* */ }
    return true;
}

// ---- kontin render-skripti (peilaa example-shots.yml -vaiheita) ------------
const RENDER_SCRIPT = `#!/bin/bash
set -euo pipefail
echo "=== [1/4] repo-kopio (ilman node_modules/.git) ==="
cd /host-repo
tar --exclude='./node_modules' --exclude='./.git' -cf - . | (cd /work && tar -xf -)
cd /work
echo "=== [2/4] npm ci ==="
npm ci 2>&1 | tail -2
echo "=== [3/4] build:preview ==="
npm run build:preview 2>&1 | tail -2
echo "=== [4/4] render: export-example-shots --all ==="
CHROME_FLAGS="--no-sandbox" SHOT_WAIT_MS=300000 node tools/export-example-shots.mjs --all
echo "=== RENDER VALMIS ==="
ls examples/*.png
`;

// ---- pää -------------------------------------------------------------------
console.log(`Toleranssit: max kanavapoikkeama ${TOLERANCE}, diff-osuus ≤ ${MAX_DIFF_PCT} %, MEA ≤ ${MAX_MEA}`);
let failures = 0;

if (!dockerAvailable()) process.exit(1);
if (!(await ensureImage())) {
    console.error('✗ Konttikuvan rakennus epäonnistui');
    process.exit(1);
}

// Työtila: kontin /work (npm ci + build + kuvat), poistetaan lopuksi
const workdir = path.join(tmpdir(), `freebuff-ub-shots-${Date.now()}`);
mkdirSync(workdir, { recursive: true });
const scriptFile = path.join(workdir, 'run-verify.sh');
writeFileSync(scriptFile, RENDER_SCRIPT, { mode: 0o755 });

console.log(`\n🐳 Ajetaan ubuntu-kontti (${pinAmd64 ? 'amd64-emulaatio' : 'natiivi alusta'})…\n`);
const runCode = await runDocker([
    'run', '--rm', ...platformFlag, '--shm-size=2g',
    '-v', `${root}:/host-repo:ro`,
    '-v', `${workdir}:/work`,
    '-v', `${scriptFile}:/run-verify.sh:ro`,
    IMAGE,
    'bash', '/run-verify.sh'
]);

if (runCode !== 0) {
    console.error('\n✗ Kontin renderöinti epäonnistui (vaiheet: repo-kopio → npm ci → build → render)');
    if (!keep) rmSync(workdir, { recursive: true, force: true });
    process.exit(1);
}

// Vertailu: repo-examples vs kontin examples (vain juuren *.png — gallery/ ei)
failures = compareExampleDirs(EXAMPLES, path.join(workdir, 'examples'), {
    tolerance: TOLERANCE, maxDiffPct: MAX_DIFF_PCT, maxMea: MAX_MEA
});

if (!keep) rmSync(workdir, { recursive: true, force: true });
console.log(failures
    ? `\n✗ ${failures} tarkistusta epäonnistui — kuvat eivät ole yhdenmukaisia ubuntu-renderin kanssa`
    : '\n✅ Esimerkkejä-kuvat ovat yhdenmukaisia ubuntu-kontin renderin kanssa (sama putki kuin CI)');
process.exitCode = failures ? 1 : 0;

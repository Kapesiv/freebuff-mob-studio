/**
 * Fetches vanilla mob geometries, textures and animations directly from
 * Mojang's official bedrock-samples repo, with ZtechNetwork's vanilla resource
 * pack as fallback, then regenerates the library and runs the UV verifier.
 *
 *   node tools/fetch-vanilla.js        (or: npm run fetch:vanilla)
 *
 * What it does:
 *   1. Downloads Mojang/bedrock-samples and extracts EVERY entity geometry and
 *      animation file.
 *   2. Downloads a texture for every mob: bedrock-samples textures when they
 *      exist (sheep/spider/rabbit), otherwise ZtechNetwork's mirror — resolved
 *      automatically (explicit variant map + generic path probes). TGA files
 *      are converted to PNG.
 *   3. Bakes the sheep face (modern Bedrock draws it at alpha=3, see
 *      tools/bake-sheep-face.js).
 *   4. Regenerates js/mobs/vanilla.js and runs the UV verifier.
 *
 * Adding a new mob is just a MOB_CONFIG entry in tools/generate-vanilla.js —
 * the assets are fetched automatically by this script.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodeTga } from './tga.js';
import { encodePng } from './png.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.join(root, 'assets/vanilla/models');
const texDir = path.join(root, 'assets/vanilla/textures');
const animDir = path.join(root, 'assets/vanilla/animations');
const TMP = path.join(root, '.fetch-tmp');
const SAMPLES_DIR = path.join(TMP, 'samples');
const SAMPLES_URL = 'https://codeload.github.com/Mojang/bedrock-samples/tar.gz/refs/heads/main';
const ZTECH_BASE = 'https://raw.githubusercontent.com/ZtechNetwork/MCBVanillaResourcePack/master';
const JAVA_BASE = 'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.20/assets/minecraft/textures/entity';

// Full URL overrides for mobs whose modern Bedrock texture no longer matches
// the (older, 64x32) geometry — e.g. ghast, whose current texture is 128x64
// with a different layout. The Java Edition classic texture matches.
const TEX_URL = {
    ghast: `${JAVA_BASE}/ghast/ghast.png`,
};

// Explicit texture variants (non-standard paths / variant defaults).
// Generic fallback probes textures/entity/<id>(/<id>).png|.tga automatically.
const TEX_CHOICE = {
    axolotl: 'textures/entity/axolotl/axolotl_lucy.png',
    bat: 'textures/entity/bat.png',
    bogged: 'textures/entity/skeleton/bogged.png',
    cat: 'textures/entity/cat/tabby.png',
    cod: 'textures/entity/fish/cod.png',
    drowned: 'textures/entity/zombie/drowned.tga',
    evoker: 'textures/entity/illager/evoker.png',
    fox: 'textures/entity/fox/fox.png',
    frog: 'textures/entity/frog/temperate_frog.png',
    husk: 'textures/entity/zombie/husk.png',
    llama: 'textures/entity/llama/llama.png',
    ocelot: 'textures/entity/cat/ocelot.png',
    parrot: 'textures/entity/parrot/parrot_red_blue.png',
    pufferfish: 'textures/entity/fish/pufferfish.png',
    salmon: 'textures/entity/fish/salmon.png',
    shulker: 'textures/entity/shulker/shulker_purple.png',
    stray: 'textures/entity/skeleton/stray.png',
    tropical_fish: 'textures/entity/fish/tropical_a.png',
    turtle: 'textures/entity/sea_turtle.png',
};

function sh(cmd) {
    execSync(cmd, { stdio: 'inherit', cwd: root });
}
function log(icon, msg) {
    console.log('  ' + icon + ' ' + msg);
}
function isTga(buf) {
    return buf.length > 18 && buf[0] === 0 && (buf[1] === 0 || buf[1] === 1) && (buf[2] === 2 || buf[2] === 10);
}

// ---- 1. Download + extract bedrock-samples --------------------------------
console.log('1) Downloading Mojang/bedrock-samples…');
mkdirSync(TMP, { recursive: true });
try {
    execSync(`curl -sL "${SAMPLES_URL}" -o ${TMP}/samples.tar.gz`, { stdio: 'inherit' });
    rmSync(SAMPLES_DIR, { recursive: true, force: true });
    mkdirSync(SAMPLES_DIR, { recursive: true });
    // geometries + animations + the few textures bedrock-samples ships
    execSync(`tar xzf ${TMP}/samples.tar.gz -C ${SAMPLES_DIR} --strip-components=1 \\\n      bedrock-samples-main/resource_pack/models/entity \\\n      bedrock-samples-main/resource_pack/animations \\\n      bedrock-samples-main/resource_pack/textures/entity/sheep \\\n      bedrock-samples-main/resource_pack/textures/entity/spider \\\n      bedrock-samples-main/resource_pack/textures/entity/rabbit`, { stdio: 'inherit' });
} catch (e) {
    console.error('Failed to fetch bedrock-samples:', e.message);
    process.exit(1);
}

// ---- 2. Copy geometries + animations ---------------------------------------
console.log('2) Copying geometries and animations…');
let geoCount = 0, animCount = 0;
for (const f of readdirSync(path.join(SAMPLES_DIR, 'resource_pack/models/entity')).filter(f => f.endsWith('.geo.json'))) {
    copyFileSync(
        path.join(SAMPLES_DIR, 'resource_pack/models/entity', f),
        path.join(modelsDir, f)
    );
    geoCount++;
}
for (const f of readdirSync(path.join(SAMPLES_DIR, 'resource_pack/animations')).filter(f => f.endsWith('.animation.json'))) {
    const id = f.replace('.animation.json', '');
    mkdirSync(animDir, { recursive: true });
    copyFileSync(
        path.join(SAMPLES_DIR, 'resource_pack/animations', f),
        path.join(animDir, id + '.json')
    );
    animCount++;
}
console.log(`  ✓ ${geoCount} geometries, ${animCount} animation files`);

// ---- 3. Resolve + download a texture per mob -------------------------------
console.log('3) Downloading textures…');
const ids = readdirSync(modelsDir).filter(f => f.endsWith('.geo.json')).map(f => f.replace('.geo.json', ''));
let ok = 0, skipped = 0;
for (const id of ids.sort()) {
    // 3a. bedrock-samples textures first (only sheep/spider/rabbit ship them)
    let src = null, local = null;
    for (const sub of [id, 'sheep', 'spider', 'rabbit']) {
        if (id !== sub && !['sheep', 'spider', 'rabbit'].includes(id)) continue;
        for (const ext of ['png', 'tga']) {
            const p = path.join(SAMPLES_DIR, `resource_pack/textures/entity/${id}/${id}.${ext}`);
            if (existsSync(p)) { src = p; break; }
        }
        if (src) break;
    }
    // 3b. ztech fallback — explicit choice then generic probes
    const candidates = [];
    if (TEX_CHOICE[id]) candidates.push(TEX_CHOICE[id]);
    candidates.push(
        `textures/entity/${id}/${id}.png`,
        `textures/entity/${id}/${id}.tga`,
        `textures/entity/${id}.png`,
        `textures/entity/${id}.tga`
    );

    const outTex = path.join(texDir, id + '.png');
    if (src) {
        if (src.endsWith('.tga')) {
            const tga = decodeTga(readFileSync(src));
            writeFileSync(outTex, encodePng(tga));
            log('✓', `${id}: texture (bedrock-samples tga → png)`);
        } else {
            copyFileSync(src, outTex);
            log('✓', `${id}: texture (bedrock-samples)`);
        }
        ok++;
        continue;
    }
    let got = false;
    if (TEX_URL[id]) {
        try {
            execSync(`curl -sfL "${TEX_URL[id]}" -o "${outTex}"`, { stdio: 'ignore' });
            const b = readFileSync(outTex);
            if (b.length >= 100) {
                log('✓', `${id}: texture (classic override)`);
                got = true;
                ok++;
            }
        } catch { /* fall through to generic */ }
    }
    for (const cand of got ? [] : candidates) {
        try {
            execSync(`curl -sfL "${ZTECH_BASE}/${cand}" -o "${outTex}"`, { stdio: 'ignore' });
            const b = readFileSync(outTex);
            if (b.length < 100) continue;
            if (isTga(b)) {
                const tga = decodeTga(b);
                writeFileSync(outTex, encodePng(tga));
                log('✓', `${id}: texture (ztech ${cand.split('/').pop()})`);
            } else {
                log('✓', `${id}: texture (ztech ${cand.split('/').pop()})`);
            }
            got = true;
            ok++;
            break;
        } catch { /* try next candidate */ }
    }
    if (!got) {
        rmSync(outTex, { force: true });
        console.log('  (skip ' + id + ' — no texture source found)');
        skipped++;
    }
}
console.log(`  ${ok} textures downloaded, ${skipped} skipped (no texture source)`);

// ---- 4. Sheep face bake -----------------------------------------------------
if (existsSync(path.join(texDir, 'sheep.png'))) {
    console.log('4) Baking sheep face onto the texture…');
    sh('node tools/bake-sheep-face.js');
}

// ---- 5. Regenerate the library + verify ------------------------------------
console.log('5) Regenerating js/mobs/vanilla.js…');
sh('node tools/generate-vanilla.js');

console.log('6) Verifying UVs…');
sh('node tools/verify-uv.js');

rmSync(TMP, { recursive: true, force: true });
console.log('✅ Vanilla mobs updated. Run `node build-preview.mjs` to rebuild preview.html.');

/**
 * UV verifier v2 — checks every library mob's face rects against the actual
 * vanilla texture PNG:
 *
 * HARD ERRORS (real bugs):
 *   1. face rect outside the texture bounds
 *   2. rects of different cubes overlap (identical rects are allowed:
 *      vanilla mirror pairs like left/right arm or left/right leg share one
 *      texture region on purpose)
 *   3. a whole cube maps to a fully transparent region (would be invisible),
 *      unless it's a known overlay layer (hat/overlay) which is intentionally
 *      invisible by default
 *
 * SOFT CHECKS (reported, not failures):
 *   4. individual faces left transparent (vanilla deliberately leaves the
 *      back faces of thin cubes, e.g. udder back, snout back, drawn empty)
 *   5. the head's north face (the mob's face) must contain enough distinct
 *      colors to actually look like a face (eyes/mouth) — this is the check
 *      that caught the original villager distortion
 *
 * Usage: node tools/verify-uv.js
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import zlib from 'zlib';
import { computeFaceRects } from '../js/utils/boxuv.js';
import { LIBRARY_MOBS } from '../js/mobs/library.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal PNG decoder (8-bit RGB/RGBA only — all vanilla textures qualify). */
function decodePNG(buf) {
    let pos = 8, width = 0, height = 0, colorType = 0;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.slice(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            colorType = data[9];
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        pos += 12 + len;
    }
    const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    const stride = width * channels;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const out = Buffer.alloc(height * stride);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = Buffer.from(line);
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? cur[x - channels] : 0;
            const b = y > 0 ? prev[x] : 0;
            const c = (x >= channels && y > 0) ? prev[x - channels] : 0;
            let v = cur[x];
            if (filter === 1) v = (v + a) & 0xff;
            else if (filter === 2) v = (v + b) & 0xff;
            else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
                v = (v + pr) & 0xff;
            }
            cur[x] = v;
        }
        cur.copy(out, y * stride);
        prev = cur;
    }
    return { width, height, channels, data: out };
}

function sampleRegion(png, x, y, w, h) {
    let opaque = 0, total = 0;
    const colors = new Set();
    for (let yy = Math.max(0, y); yy < Math.min(png.height, y + h); yy++) {
        for (let xx = Math.max(0, x); xx < Math.min(png.width, x + w); xx++) {
            const i = (yy * png.width + xx) * png.channels;
            total++;
            if (png.data[i + 3] > 0) {
                opaque++;
                colors.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
            }
        }
    }
    return { opaque, total, distinct: colors.size };
}

function isOverlayCube(name) {
    return /hat|overlay|outer/i.test(name || '');
}

// Mod-artefakteja: kuutio, joka on modin OMASSA lähdetekstuurissa täysin
// läpinäkyvä — se renderöityy siis myös pelissä näkymättömänä (ei UV-bugi).
// Tarkistaja ohittaa nämä, koska malli on kopio alkuperäisestä datasta.
const KNOWN_TRANSPARENT = new Map([
    ['Primordial Bone Crawler', ['head_1']] // alaleuka (uv 176,27) — tyhjä modin tekstuurissa
]);

const errors = [];
const soft = [];
let checkedRects = 0;

for (const mob of LIBRARY_MOBS) {
    const { model, textureDataURL } = mob;
    const texW = model.textureWidth, texH = model.textureHeight;
    const png = textureDataURL ? decodePNG(Buffer.from(textureDataURL.split(',')[1], 'base64')) : null;

    if (png && (png.width !== texW || png.height !== texH)) {
        errors.push(`✗ ${mob.name}: texture PNG is ${png.width}x${png.height} but model says ${texW}x${texH}`);
    }

    // gather all cube face rects
    const rects = []; // { cube, bone, face, x, y, w, h }
    const byCube = new Map();
    const byName = new Map(model.bones.flatMap(b => (b.cubes || []).map(c => [c.name, c])));
    const cubeIsFlat = (name, map) => {
        const c = byName.get(name);
        return !!(c && (c.size[0] === 0 || c.size[1] === 0 || c.size[2] === 0));
    };
    for (const bone of model.bones) {
        for (const cube of (bone.cubes || [])) {
            const cubeRects = computeFaceRects(cube).map(r => ({ cube: cube.name, bone: bone.name, ...r }));
            byCube.set(cube.name, cubeRects);
            for (const r of cubeRects) {
                checkedRects++;
                rects.push(r);
            }
        }
    }

    // 1) bounds (hard). Degenerate (zero-area) faces don't render and may
    //    legally hang slightly outside the texture in real models.
    for (const r of rects) {
        if ((r.w === 0 || r.h === 0) && (r.x < 0 || r.y < 0 || r.x + r.w > texW || r.y + r.h > texH)) continue;
        if (r.x < 0 || r.y < 0 || r.x + r.w > texW || r.y + r.h > texH) {
            errors.push(`✗ ${mob.name}.${r.cube} ${r.face}: rect (${r.x},${r.y} ${r.w}x${r.h}) OUT OF BOUNDS for ${texW}x${texH}`);
        }
    }

    // Mod-mobit (uvRelaxed): UV-pakkaus on alkuperäistä dataa — modi itse
    // käyttää päällekkäisiä alueita (ketjut, koristenauhat) ja läpinäkyviä
    // koristeita tarkoituksella. Näille ei ole mielekästä vaatia vanilja-
    // tiukkuutta, mutta rajat/tekstuuri/naama tarkistetaan aina.
    const relaxed = !!model.uvRelaxed;

    // 3) whole-cube transparency (hard, hats allowed)
    if (png && !relaxed) {
        const known = KNOWN_TRANSPARENT.get(mob.name) || [];
        for (const [cubeName, cubeRects] of byCube) {
            let anyOpaque = false;
            for (const r of cubeRects) {
                if (sampleRegion(png, r.x, r.y, r.w, r.h).opaque > 0) { anyOpaque = true; break; }
            }
            if (!anyOpaque && !isOverlayCube(cubeName) && !known.includes(cubeName)) {
                errors.push(`✗ ${mob.name}.${cubeName}: ALL faces map to a fully transparent region (cube would be invisible)`);
            }
        }
    }

    // 2) cross-cube overlap (hard, identical rects allowed = mirror pairs).
    // Degenerate faces (zero area — thin 0-width cubes like claws/blades) are
    // skipped: they occupy no pixels and commonly share space in the original
    // Blockbench UV packing (e.g. the stalker's claw planes over the head).
    // Overlaps between cubes of the SAME part (same stem, e.g. body_1/body_2,
    // reins_0/reins_1 — vanilla splits parts into multiple cubes that share
    // texture space) are allowed too.
    const stemOf = name => (name || '').replace(/(_\d+)+$/, ''); // tentacles_0_0 → tentacles
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i], b = rects[j];
            if (a.cube === b.cube) continue;
            if (a.w === 0 || a.h === 0 || b.w === 0 || b.h === 0) continue;
            const sameRect = a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
            const sameStem = stemOf(a.cube) === stemOf(b.cube);
            const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
            if (overlap && !sameRect && !sameStem) {
                // Mod-koristeet (ketjut, terät, kynnet) ovat usein 0-paksuisia
                // tasoja, jotka JAKAVAT saman tekstuurialueen tarkoituksella
                // (esim. Bringer of Despairin ketjut — kaikki samasta
                // ketjutekstuurista). Kaksi litteää kuutiota = sallittu.
                const flatA = cubeIsFlat(a.cube, byCube);
                const flatB = cubeIsFlat(b.cube, byCube);
                if (!(flatA && flatB) && !relaxed) {
                    errors.push(`✗ ${mob.name}: ${a.cube} ${a.face} (${a.x},${a.y} ${a.w}x${a.h}) overlaps ${b.cube} ${b.face} (${b.x},${b.y} ${b.w}x${b.h})`);
                }
            }
        }
    }

    // 4) soft: individual transparent faces
    if (png) {
        for (const r of rects) {
            if (r.w === 0 || r.h === 0) continue; // degenerate face — nothing to sample
            const s = sampleRegion(png, r.x, r.y, r.w, r.h);
            if (s.opaque === 0) {
                soft.push(`ℹ ${mob.name}.${r.cube} ${r.face}: left transparent by design`);
            }
        }
    }

    // 5) the face check: find the head cube (largest cube of the head bone or a cube named head),
    //    its north face should have enough distinct colors to be a real face
    const headCube = model.bones
        .filter(b => /head/i.test(b.name))
        .flatMap(b => b.cubes || [])
        .sort((a, b) => (b.size[0] * b.size[1] * b.size[2]) - (a.size[0] * a.size[1] * a.size[2]))[0];
    if (headCube && png) {
        const north = computeFaceRects(headCube).find(r => r.face === 'north');
        if (north) {
            const s = sampleRegion(png, north.x, north.y, north.w, north.h);
            if (s.opaque === 0) {
                errors.push(`✗ ${mob.name}: HEAD north face (${north.x},${north.y} ${north.w}x${north.h}) is EMPTY — face is missing!`);
            } else if (s.distinct < 3) {
                soft.push(`ℹ ${mob.name}: head north face has only ${s.distinct} distinct colors (check the face is drawn correctly)`);
            } else {
                soft.push(`✓ ${mob.name}: head north face at (${north.x},${north.y} ${north.w}x${north.h}) has ${s.distinct} distinct colors`);
            }
        }
    }
}

console.log(`\nChecked ${checkedRects} face rects across ${LIBRARY_MOBS.length} mobs.\n`);
if (errors.length === 0) {
    console.log('✅ NO HARD UV ERRORS — layout is valid for all mobs\n');
} else {
    console.log(errors.join('\n'));
}
console.log('Soft notes:');
console.log(soft.join('\n'));
process.exitCode = errors.length ? 1 : 0;

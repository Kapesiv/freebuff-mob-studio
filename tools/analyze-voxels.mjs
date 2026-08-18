#!/usr/bin/env node
/**
 * Analysoi vokseliristikot — auttaa asettamaan luujakorajat oikein.
 * Käyttö: node tools/analyze-voxels.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { collectTriangles, voxelize } from './voxelize.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const MODELS = [
    { file: 'DragonAttenuation.glb', id: 'vox_dragon', heightBlocks: 4.5, voxel: 2 },
    { file: 'Horse.glb', id: 'vox_horse', heightBlocks: 2.2 },
    { file: 'Fox.glb', id: 'vox_fox', heightBlocks: 1.1 },
    { file: 'Flamingo.glb', id: 'vox_flamingo', heightBlocks: 1.6 },
    { file: 'Parrot.glb', id: 'vox_parrot', heightBlocks: 1.0 },
    { file: 'Stork.glb', id: 'vox_stork', heightBlocks: 1.8 }
];

/** Poista pohjapiedestaali/taustaverkko: alimmat tasot, joiden solu-määrä >= 0.6*maxCount. */
function dropPedestal(boxes) {
    let mnY = Infinity, mxY = -Infinity;
    for (const b of boxes) { mnY = Math.min(mnY, b.y0); mxY = Math.max(mxY, b.y1); }
    const cnt = new Array(mxY - mnY + 1).fill(0);
    for (const b of boxes) for (let y = b.y0; y <= b.y1; y++) cnt[y - mnY]++;
    const maxC = Math.max(...cnt);
    let dropTo = mnY - 1;
    for (let y = mnY; y <= mxY; y++) { if (cnt[y - mnY] >= 0.6 * maxC) dropTo = y; else break; }
    if (dropTo < mnY) return boxes;
    return boxes.filter(b => b.y1 > dropTo);
}

function topView(boxes) {
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (const b of boxes) {
        mnX = Math.min(mnX, b.x); mxX = Math.max(mxX, b.x);
        mnZ = Math.min(mnZ, b.z); mxZ = Math.max(mxZ, b.z);
    }
    const h = mxX - mnX + 1, w = mxZ - mnZ + 1;
    const grid = Array.from({ length: h }, () => new Array(w).fill(' '));
    for (const b of boxes) {
        for (let y = b.y0; y <= b.y1; y++) {
            const x = b.x - mnX, z = b.z - mnZ;
            if (x >= 0 && x < h && z >= 0 && z < w) grid[x][z] = '#';
        }
    }
    const lines = [];
    lines.push('   ' + Array.from({ length: w }, (_, i) => (i + mnZ) % 10 === 0 ? String(Math.floor((i + mnZ) / 10) % 10) : ' ').join(''));
    for (let x = h - 1; x >= 0; x--) {
        lines.push(String(x + mnX).padStart(2) + ' ' + grid[x].join(''));
    }
    lines.push('   z→ ' + mnZ + '..' + mxZ + '   x↑ ' + mnX + '..' + mxX);
    return lines.join('\n');
}

for (const cfg of MODELS) {
    const src = join('/tmp/vox', cfg.file);
    if (!existsSync(src)) { console.error('missing', src); continue; }
    console.log(`\n================ ${cfg.id} (${cfg.file}) ================`);
    const tris = collectTriangles(src);
    const { boxes, cellUnits, gridCell } = voxelize(tris, cfg.heightBlocks * 16, cfg.voxel || 1);
    const clean = dropPedestal(boxes);
    console.log(`boxes ${boxes.length} → after pedestal drop: ${clean.length}`);
    console.log('\n--- TOP VIEW (x↑, z→; etuosa = SUURI z) ---');
    console.log(topView(clean));
    // x-saraketiheys (mihin x-akselilla malli yltää) — siivet näkyvät harvoina reunoina
    let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity, mnY = Infinity, mxY = -Infinity;
    for (const b of clean) {
        mnX = Math.min(mnX, b.x); mxX = Math.max(mxX, b.x);
        mnZ = Math.min(mnZ, b.z); mxZ = Math.max(mxZ, b.z);
        mnY = Math.min(mnY, b.y0); mxY = Math.max(mxY, b.y1);
    }
    const xcnt = new Array(mxX - mnX + 1).fill(0);
    for (const b of clean) for (let y = b.y0; y <= b.y1; y++) xcnt[b.x - mnX]++;
    const xmax = Math.max(...xcnt);
    console.log('\n--- X-SARAKETIHEYS (x→, #=suhteellinen) ---');
    console.log(xcnt.map((c, i) => String(i + mnX).padStart(2) + ' ' + '#'.repeat(Math.round(c / xmax * 40)) + ' ' + c).join('\n'));
    // ylimmät 4 tasoa
    console.log('\n--- YLIMMÄT 4 TASOA (x,z-solut) ---');
    for (let y = mxY - 3; y <= mxY; y++) {
        const cells = new Set();
        for (const b of clean) if (b.y0 <= y && b.y1 >= y) cells.add(b.x + ',' + b.z);
        console.log('y=' + y + ' (' + cells.size + '): ' + [...cells].slice(0, 80).join(' '));
    }
    // z-jakauma (häntä/pää-päät)
    const zcnt = new Array(mxZ - mnZ + 1).fill(0);
    for (const b of clean) for (let y = b.y0; y <= b.y1; y++) zcnt[b.z - mnZ]++;
    console.log('\n--- Z-SARAKETIHEYS (z→) ---');
    console.log(zcnt.map((c, i) => String(i + mnZ).padStart(2) + ' ' + '#'.repeat(Math.round(c / Math.max(...zcnt) * 40)) + ' ' + c).join('\n'));
}

#!/usr/bin/env node
/**
 * Varmistaa että vokselimobien animaatiot eivät revi osia irti rungosta:
 * simuloi jokaisen animaation jokaisen keyframen luut (sama matriisiketju kuin
 * editorissa) ja tarkistaa, että jokaisen luun kuutiot pysyvät rungon
 * laatikon lähellä (enintään luun koon verran etäällä).
 */
import { VOXEL_MOBS } from '../js/mobs/voxel.js';

const THRESHOLD = 12; // yksikköä: sallittu "irtileijunta" rungosta

function mat4Identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
function mat4Mul(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
    }
    return out;
}
function mat4T(x, y, z) { const m = mat4Identity(); m[12] = x; m[13] = y; m[14] = z; return m; }
function mat4RotZYX(x, y, z) {
    // THREE.Matrix4.makeRotationFromEuler('ZYX') — sama kaava kuin editorissa
    // (tarkistettu numerisesti; aikaisempi transpoosi pyöritti vääriä akseleita)
    const a = Math.cos(x * Math.PI / 180), b = Math.sin(x * Math.PI / 180);
    const c = Math.cos(y * Math.PI / 180), d = Math.sin(y * Math.PI / 180);
    const e = Math.cos(z * Math.PI / 180), f = Math.sin(z * Math.PI / 180);
    return [
        c * e, c * f, -d, 0,
        b * e * d - a * f, b * f * d + a * e, b * c, 0,
        a * e * d + b * f, a * f * d - b * e, a * c, 0,
        0, 0, 0, 1
    ];
}
function apply(m, v) {
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
}

function lerp(a, b, t) { return a + (b - a) * t; }

function sampleTrack(track, frame) {
    // track: {frame: [rx, ry, rz]}
    const frames = Object.keys(track).map(Number).sort((a, b) => a - b);
    if (frames.length === 0) return [0, 0, 0];
    if (frame <= frames[0]) return track[frames[0]];
    if (frame >= frames[frames.length - 1]) return track[frames[frames.length - 1]];
    for (let i = 0; i < frames.length - 1; i++) {
        if (frame >= frames[i] && frame <= frames[i + 1]) {
            const t = (frame - frames[i]) / (frames[i + 1] - frames[i]);
            const a = track[frames[i]], b = track[frames[i + 1]];
            return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
        }
    }
    return [0, 0, 0];
}

function bboxOf(cubes, world, pivot) {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const c of cubes) {
        const corners = [
            [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]
        ];
        for (const [cx, cy, cz] of corners) {
            const p = apply(world, [
                c.origin[0] + c.size[0] * cx - pivot[0],
                c.origin[1] + c.size[1] * cy - pivot[1],
                c.origin[2] + c.size[2] * cz - pivot[2]
            ]);
            for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
        }
    }
    return { mn, mx };
}

let problems = 0;
for (const mob of VOXEL_MOBS) {
    const model = mob.model;
    const byName = new Map(model.bones.map(b => [b.name, b]));
    const anims = mob.animations || {};
    for (const [animName, anim] of Object.entries(anims)) {
        const length = anim.length || 1;
        const tracks = anim.tracks || {};
        const posTracks = anim.posTracks || {};
        for (let frame = 0; frame <= length; frame += 2) {
            // simulate hierarchy
            const order = [];
            for (const b of model.bones) if (!b.parent) order.push(b);
            for (let i = 0; i < order.length; i++) for (const b of model.bones)
                if (b.parent && order.some(o => o.name === b.parent) && !order.some(o => o.name === b.name)) order.push(b);
            const world = new Map();
            const bodyBone = model.bones.find(b => b.name === 'body');
            for (const b of order) {
                const parent = b.parent ? byName.get(b.parent) : null;
                let base = b.pivot.slice();
                if (parent) { base[0] -= parent.pivot[0]; base[1] -= parent.pivot[1]; base[2] -= parent.pivot[2]; }
                const r = sampleTrack(tracks[b.name] || {}, frame);
                const p = sampleTrack((posTracks[b.name] || {}), frame);
                const local = mat4Mul(mat4T(base[0] + p[0], base[1] + p[1], base[2] + p[2]), mat4RotZYX(r[0], r[1], r[2]));
                const pw = parent ? world.get(b.parent) : mat4Identity();
                world.set(b.name, parent ? mat4Mul(pw, local) : local);
            }
            // body bbox in world
            const bodyWorld = world.get('body');
            const bodyCubes = bodyBone ? bodyBone.cubes : [];
            const bodyBb = bboxOf(bodyCubes, bodyWorld, bodyBone.pivot);
            // check every other bone
            for (const b of model.bones) {
                if (b.name === 'body' || b.name === 'root' || !b.cubes.length) continue;
                const bb = bboxOf(b.cubes, world.get(b.name), b.pivot);
                const gap = [0, 1, 2].map(i => Math.max(0, bodyBb.mn[i] - bb.mx[i], bb.mn[i] - bodyBb.mx[i]));
                const g = Math.hypot(...gap.map(v => Math.max(0, v)));
                // jos luu on pieni (alle 8 kuutiota), sallitaan isompi heilunta
                const thr = b.cubes.length < 8 ? THRESHOLD * 1.8 : THRESHOLD;
                if (g > thr) {
                    console.log(`⚠ ${mob.id} [${animName}@${frame}] ${b.name} gap ${g.toFixed(1)} (${b.cubes.length}c) from body`);
                    problems++;
                }
            }
        }
    }
}
console.log(problems === 0 ? '✅ kaikki animaatiot pitävät luut kiinni rungossa' : `\n${problems} ongelmaa`);
process.exitCode = problems ? 1 : 0;

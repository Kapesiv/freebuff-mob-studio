#!/usr/bin/env node
/** Diagnose voxel mob geometry: side/front silhouettes + per-bone bboxes + head orientation. */
import { VOXEL_MOBS } from '../js/mobs/voxel.js';

function bboxOf(bone) {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const c of bone.cubes) for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i], c.origin[i]);
        mx[i] = Math.max(mx[i], c.origin[i] + c.size[i]);
    }
    return { mn, mx };
}

function silhouette(cubes, u, v, w, mnU, mnV, mnW, mxU, mxV, mxW) {
    const hu = Math.round(mxU - mnU) + 1, hv = Math.round(mxV - mnV) + 1;
    const grid = Array.from({ length: hv }, () => new Array(hu).fill(' '));
    for (let a = 0; a < hu; a++) for (let b = 0; b < hv; b++) {
        // cell center in U/V/W coords
        const pu = mnU + a + 0.5, pv = mnV + b + 0.5;
        for (const c of cubes) {
            const o = c.origin, s = c.size;
            if (pu >= o[u] && pu <= o[u] + s[u] && pv >= o[v] && pv <= o[v] + s[v]) {
                grid[b][a] = '#';
                break;
            }
        }
    }
    const lines = [];
    for (let u = hu - 1; u >= 0; u--) {
        let row = '';
        for (let v = 0; v < hv; v++) row += grid[v][u] || ' ';
        lines.push(String(u + mnU).padStart(4) + ' ' + row);
    }
    return lines.join('\n');
}

for (const mob of VOXEL_MOBS) {
    console.log('\n========== ' + mob.id + ' ==========');
    const all = [];
    for (const b of mob.model.bones) for (const c of b.cubes) all.push(c);
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const c of all) for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i], c.origin[i]);
        mx[i] = Math.max(mx[i], c.origin[i] + c.size[i]);
    }
    const W = Math.round(mx[0] - mn[0]) + 1, H = Math.round(mx[1] - mn[1]) + 1, D = Math.round(mx[2] - mn[2]) + 1;
    console.log(`model bbox: x ${mn[0].toFixed(1)}..${mx[0].toFixed(1)} (w${W})  y ${mn[1].toFixed(1)}..${mx[1].toFixed(1)} (h${H})  z ${mn[2].toFixed(1)}..${mx[2].toFixed(1)} (d${D})`);
    // head vs body z-center
    const head = mob.model.bones.find(b => b.name === 'head');
    const body = mob.model.bones.find(b => b.name === 'body');
    if (head && body) {
        const hb = bboxOf(head), bb = bboxOf(body);
        console.log(`head z-center ${((hb.mn[2] + hb.mx[2]) / 2).toFixed(1)} vs body z-center ${((bb.mn[2] + bb.mx[2]) / 2).toFixed(1)} (model z-center ${((mn[2] + mx[2]) / 2).toFixed(1)}) → head ${((hb.mn[2] + hb.mx[2]) / 2 > (bb.mn[2] + bb.mx[2]) / 2 ? 'FRONT(+z)' : 'BACK(-z)')}`);
        console.log(`head y ${hb.mn[1].toFixed(1)}..${hb.mx[1].toFixed(1)} vs body top ${bb.mx[1].toFixed(1)} → ${hb.mx[1] >= bb.mx[1] - 0.01 ? 'AT TOP' : 'BELOW BODY TOP'}`);
    }
    // silhouette: rows = first axis (u), columns = second axis (v)
    const side = silhouette(all, 1, 2, 0, mn[1], mn[2], mn[0], mx[1], mx[2], mx[0]);
    console.log('--- SIDE VIEW (y↑, z→; front should be large z) ---');
    console.log(side);
    const front = silhouette(all, 1, 0, 2, mn[1], mn[0], mn[2], mx[1], mx[0], mx[2]);
    console.log('--- FRONT VIEW (y↑, x→; left/right) ---');
    console.log(front);
    // per-bone rows
    for (const b of mob.model.bones) {
        if (!b.cubes.length) continue;
        const bb = bboxOf(b);
        console.log(`  ${b.name.padEnd(14)} ${String(b.cubes.length).padStart(3)}c  x ${bb.mn[0].toFixed(1)}..${bb.mx[0].toFixed(1)}  y ${bb.mn[1].toFixed(1)}..${bb.mx[1].toFixed(1)}  z ${bb.mn[2].toFixed(1)}..${bb.mx[2].toFixed(1)}  pivot ${b.pivot.map(v => v.toFixed(1))}`);
    }
}

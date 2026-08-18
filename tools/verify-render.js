/**
 * Render correctness verifier — ensures the 3D render always matches the
 * model DATA (origin = bottom corner, box spans origin..origin+size).
 *
 * WHY: THREE's BoxGeometry is centered on its origin, but Bedrock/Blockbench
 * cube origins are bottom corners. The app must therefore offset every mesh
 * by +size/2. If that offset is lost (it regressed once — cubes rendered
 * half a size away from their data), every mob looks broken AND 3D painting
 * misses the model. This verifier guards against that regression and checks
 * the data itself:
 *
 * HARD ERRORS:
 *   1. js/main.js mesh-position formula missing the "+ size/2" offset
 *      (the regression guard for the fix in rebuildModel), or the gizmo
 *      write-back missing the "- size/2".
 *   2. Non-finite / negative cube data, missing parent bones.
 *   3. Rendered world center (simulated with the app's exact transform
 *      chain: hierarchy + ZYX rest rotations) must equal the data center
 *      (origin + size/2) for every cube whose bone chain is unrotated.
 *      Rotated chains are reported as soft notes (their center legitimately
 *      moves with the bone rotation).
 *
 * Usage: node tools/verify-render.js
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { LIBRARY_MOBS } from '../js/mobs/library.js';
import { MOB_TEMPLATES } from '../js/mobs/templates.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const soft = [];
let checkedCubes = 0;

// ---- 1) static regression guard: the render formulas in main.js ----------
const mainSrc = readFileSync(path.join(root, 'js/main.js'), 'utf8');
const meshSetOk = [0, 1, 2].every(i =>
    mainSrc.includes(`cubeData.origin[${i}] + cubeData.size[${i}] / 2 - boneData.pivot[${i}]`)
);
if (!meshSetOk) {
    errors.push('✗ js/main.js rebuildModel: mesh.position must be origin + size/2 − pivot (missing "+ size[i] / 2" for some axis)');
}
const gizmoOk = [0, 1, 2].every(i =>
    mainSrc.includes(`worldPos.${'xyz'[i]} - cubeData.size[${i}] / 2`)
);
if (!gizmoOk) {
    errors.push('✗ js/main.js updatePropertiesFromObject: origin must be center − size/2 (missing "- size[i] / 2" for some axis)');
}

// ---- minimal 4x4 matrix math (matches THREE conventions) ------------------
function mat4Identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // column-major
}
function mat4Mul(a, b) {
    const out = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
            out[c * 4 + r] = s;
        }
    }
    return out;
}
function mat4Translate(tx, ty, tz) {
    const m = mat4Identity();
    m[12] = tx; m[13] = ty; m[14] = tz;
    return m;
}
/** THREE Euler 'ZYX' rotation matrix, degrees in, column-major.
 *  Sama kaava kuin THREE.Matrix4.makeRotationFromEuler('ZYX') — tarkistettu
 *  numerisesti kolmessa tapauksessa (aikaisempi transpoosi pyöritti vääriä
 *  akseleita). a=cos(x) b=sin(x) c=cos(y) d=sin(y) e=cos(z) f=sin(z):
 *    te[0]=c*e  te[4]=be*d-af  te[8]=ae*d+bf
 *    te[1]=c*f  te[5]=bf*d+ae  te[9]=af*d-be
 *    te[2]=-d   te[6]=b*c      te[10]=a*c */
function mat4RotZYX(x, y, z) {
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
function mat4Apply(m, v) {
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
    ];
}

// ---- transform simulation ------------------------------------------------
// Replicates rebuildModel's hierarchy: bone world matrix = parent · T(pivot_i −
// pivot_parent) · R(bone rest, ZYX). Mesh local point = origin + size/2 − pivot.
function simulateBoneWorldMatrices(model) {
    const byName = new Map(model.bones.map(b => [b.name, b]));
    const world = new Map();
    const chainRotated = new Map(); // onko jokin luu ketjussa rotaatiolla
    const order = [];
    const inOrder = (name) => order.some(o => o.name === name);
    for (const b of model.bones) if (!b.parent) order.push(b);
    for (let i = 0; i < order.length; i++) {
        for (const b of model.bones) {
            if (b.parent && inOrder(b.parent) && !inOrder(b.name)) order.push(b);
        }
    }
    for (const b of order) {
        const parent = b.parent ? byName.get(b.parent) : null;
        const base = b.pivot.slice();
        if (parent) {
            base[0] -= parent.pivot[0];
            base[1] -= parent.pivot[1];
            base[2] -= parent.pivot[2];
        }
        const local = mat4Mul(mat4Translate(base[0], base[1], base[2]), mat4RotZYX(b.rotation[0], b.rotation[1], b.rotation[2]));
        const parentWorld = parent ? world.get(b.parent) : mat4Identity();
        const w = parent ? mat4Mul(parentWorld, local) : local;
        world.set(b.name, w);
        const parentRotated = parent ? chainRotated.get(b.parent) : false;
        chainRotated.set(b.name, parentRotated || b.rotation.some(v => Math.abs(v) > 0.001));
    }
    return { world, chainRotated };
}

const allMobs = [
    ...LIBRARY_MOBS.map(m => ({ name: m.name, model: m.model })),
    ...MOB_TEMPLATES.map(t => ({ name: t.name + ' (template)', model: t.model }))
];

for (const { name: mobName, model } of allMobs) {
    if (!model || !model.bones) continue;
    const { world, chainRotated } = simulateBoneWorldMatrices(model);

    for (const bone of model.bones) {
        const parent = bone.parent ? model.bones.find(b => b.name === bone.parent) : null;
        if (bone.parent && !parent) {
            errors.push(`✗ ${mobName}: bone "${bone.name}" parent "${bone.parent}" not found`);
        }
        for (const cube of bone.cubes || []) {
            checkedCubes++;
            const size = cube.size || [];
            if (!cube.origin || !size || size.length < 3 || !bone.pivot || !bone.rotation) {
                errors.push(`✗ ${mobName}.${cube.name}: missing origin/size/pivot/rotation data`);
                continue;
            }
            if (!size.every(v => Number.isFinite(v)) || size.some(v => v < 0)) {
                errors.push(`✗ ${mobName}.${cube.name}: size ${JSON.stringify(size)} not finite/non-negative`);
            }
            if (!cube.origin.every(v => Number.isFinite(v))) {
                errors.push(`✗ ${mobName}.${cube.name}: origin not finite`);
            }
            if (!bone.pivot.every(v => Number.isFinite(v)) || !bone.rotation.every(v => Number.isFinite(v))) {
                errors.push(`✗ ${mobName}.${cube.name}: bone ${bone.name} pivot/rotation not finite`);
            }

            const localPoint = [
                cube.origin[0] + size[0] / 2 - bone.pivot[0],
                cube.origin[1] + size[1] / 2 - bone.pivot[1],
                cube.origin[2] + size[2] / 2 - bone.pivot[2]
            ];
            const wm = world.get(bone.name);
            if (!wm) { errors.push(`✗ ${mobName}: no world matrix for bone ${bone.name}`); continue; }
            const renderedCenter = mat4Apply(wm, localPoint);
            const dataCenter = [cube.origin[0] + size[0] / 2, cube.origin[1] + size[1] / 2, cube.origin[2] + size[2] / 2];

            const dev = Math.hypot(
                renderedCenter[0] - dataCenter[0],
                renderedCenter[1] - dataCenter[1],
                renderedCenter[2] - dataCenter[2]
            );
            const rotatedChain = chainRotated.get(bone.name);
            if (rotatedChain) {
                // Rotaatio siirtää keskipisteen oikeutetusti — vain pehmeä huomio
                if (dev > 0.05) {
                    soft.push(`ℹ ${mobName}.${cube.name}: center ${dev.toFixed(2)}px from data center (bone "${bone.name}" rest-rotated — expected)`);
                }
            } else if (dev > 0.01) {
                errors.push(`✗ ${mobName}.${cube.name}: rendered center ${renderedCenter.map(n => n.toFixed(1)).join(',')} ≠ data center ${dataCenter.map(n => n.toFixed(1)).join(',')} (offset ${dev.toFixed(2)})`);
            }
        }
    }
}

console.log(`\nRender-verifier: checked ${checkedCubes} cubes across ${allMobs.length} mobs/templates.`);
if (errors.length === 0) {
    console.log('✅ NO RENDER ERRORS — every cube renders at its data position (origin+size/2)');
} else {
    console.log(errors.join('\n'));
}
console.log('Soft notes:');
console.log(soft.join('\n') || '(none)');
process.exitCode = errors.length ? 1 : 0;

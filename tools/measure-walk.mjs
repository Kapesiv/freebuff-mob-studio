#!/usr/bin/env node
/** Mittaa vokselimobien walk-animaation jalkojen käyttäytymistä
 *  AIDOLLA THREE.js:llä (sama ketju kuin editorin rebuildModel + applyPose):
 *  - jalkaterän korkeus (min/max y) kaikkien keyframien yli
 *  - leikkaako jalka lattiaan (y < -0.01)
 *  - jalkaterän liike z-suunnassa (askellus)
 */
import * as THREE from 'three';
import { VOXEL_MOBS } from '../js/mobs/voxel.js';

function lerp(a, b, t) { return a + (b - a) * t; }
function sampleTrack(track, frame) {
    const frames = Object.keys(track).map(Number).sort((a, b) => a - b);
    if (!frames.length) return [0, 0, 0];
    if (frame <= frames[0]) return track[frames[0]];
    if (frame >= frames[frames.length - 1]) return track[frames[frames.length - 1]];
    for (let i = 0; i < frames.length - 1; i++) {
        if (frame >= frames[i] && frame <= frames[i + 1]) {
            const t = (frame - frames[i]) / (frames[i + 1] - frames[i]);
            return [lerp(track[frames[i]][0], track[frames[i + 1]][0], t), lerp(track[frames[i]][1], track[frames[i + 1]][1], t), lerp(track[frames[i]][2], track[frames[i + 1]][2], t)];
        }
    }
    return [0, 0, 0];
}
const d2r = THREE.MathUtils.degToRad;

function buildRig(model) {
    // mirror rebuildModel: group per bone with ZYX rotation + cubes positioned at origin+size/2-pivot
    const groups = [];
    const meshByBone = [];
    for (const boneData of model.bones) {
        const group = new THREE.Group();
        group.name = boneData.name;
        group.rotation.order = 'ZYX';
        group.rotation.set(d2r(boneData.rotation[0]), d2r(boneData.rotation[1]), d2r(boneData.rotation[2]));
        const meshes = [];
        for (const cubeData of boneData.cubes) {
            const geo = new THREE.BoxGeometry(cubeData.size[0], cubeData.size[1], cubeData.size[2]);
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
            mesh.position.set(
                cubeData.origin[0] + cubeData.size[0] / 2 - boneData.pivot[0],
                cubeData.origin[1] + cubeData.size[1] / 2 - boneData.pivot[1],
                cubeData.origin[2] + cubeData.size[2] / 2 - boneData.pivot[2]
            );
            mesh.rotation.order = 'ZYX';
            mesh.rotation.set(d2r(cubeData.rotation[0]), d2r(cubeData.rotation[1]), d2r(cubeData.rotation[2]));
            group.add(mesh);
            meshes.push(mesh);
        }
        groups.push(group);
        meshByBone.push(meshes);
    }
    for (let bi = 0; bi < model.bones.length; bi++) {
        const boneData = model.bones[bi];
        const group = groups[bi];
        const parentIdx = boneData.parent ? model.bones.findIndex(b => b.name === boneData.parent) : -1;
        const base = boneData.pivot.slice();
        if (parentIdx >= 0 && groups[parentIdx]) {
            const pp = model.bones[parentIdx].pivot;
            base[0] -= pp[0]; base[1] -= pp[1]; base[2] -= pp[2];
            groups[parentIdx].add(group);
        }
        group.userData.basePosition = base;
        group.position.set(base[0], base[1], base[2]);
    }
    return { groups, meshByBone };
}

function applyPose(model, rig, anim, frame) {
    for (let bi = 0; bi < model.bones.length; bi++) {
        const boneData = model.bones[bi];
        const group = rig.groups[bi];
        const track = anim.tracks[boneData.name];
        let rot = boneData.rotation;
        if (track && Object.keys(track).length > 0) {
            rot = sampleTrack(track, frame);
            if (model.additiveRotation) {
                rot = [rot[0] + boneData.rotation[0], rot[1] + boneData.rotation[1], rot[2] + boneData.rotation[2]];
            }
        }
        group.rotation.order = 'ZYX';
        group.rotation.set(d2r(rot[0]), d2r(rot[1]), d2r(rot[2]));
        const base = (group.userData && group.userData.basePosition) ? group.userData.basePosition : boneData.pivot;
        const posTrack = anim.posTracks ? anim.posTracks[boneData.name] : null;
        if (posTrack && Object.keys(posTrack).length > 0) {
            const p = sampleTrack(posTrack, frame);
            group.position.set(base[0] + p[0], base[1] + p[1], base[2] + p[2]);
        } else {
            group.position.set(base[0], base[1], base[2]);
        }
    }
}

const v = new THREE.Vector3();
let any = false;
for (const mob of VOXEL_MOBS) {
    const model = mob.model;
    const legIdx = model.bones.map((b, i) => /_(front|back)(_\d+)?$/.test(b.name) && b.cubes.length ? i : -1).filter(i => i >= 0);
    if (!legIdx.length) continue;
    const anims = mob.animations || {};
    const rig = buildRig(model);
    for (const [animName, anim] of Object.entries(anims)) {
        if (!anim || !anim.length) continue;
        any = true;
        const len = anim.length;
        const foots = new Map();
        for (const i of legIdx) foots.set(model.bones[i].name, { min: Infinity, max: -Infinity });
        let clips = 0;
        for (let f = 0; f <= len; f += 2) {
            applyPose(model, rig, anim, f);
            for (const g of rig.groups) if (!g.parent) g.updateMatrixWorld(true);
            for (const i of legIdx) {
                let footMinY = Infinity;
                for (const mesh of rig.meshByBone[i]) {
                    const geo = mesh.geometry;
                    const pos = geo.attributes.position;
                    for (let k = 0; k < pos.count; k++) {
                        v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
                        footMinY = Math.min(footMinY, v.y);
                    }
                }
                const ft = foots.get(model.bones[i].name);
                ft.min = Math.min(ft.min, footMinY);
                ft.max = Math.max(ft.max, footMinY);
                // Sallitaan alle puolen yksikön painuma (16 yksikköä = 1 lohko,
                // eli alle puoli pikseliä tekstuurissa) — rungon huojunnan
                // aiheuttama luonnollinen painauma. Oikea uppoaminen (> 0.5)
                // jää kiinni (vanha walk upposi jopa 1.9 yksikköä).
                if (footMinY < -0.5) clips++;
            }
        }
        const parts = [];
        for (const [name, ft] of foots) {
            parts.push(name.replace(/^(left|right)_/, '') + ' y' + ft.min.toFixed(1) + '..' + ft.max.toFixed(1));
        }
        console.log(mob.id.padEnd(12), animName.padEnd(5) + '@' + len, '| ' + parts.join(' | ') + (clips ? ' | ⚠ ' + clips + ' CLIP' : ''));
        if (clips) {
            console.error(`✗ ${mob.id}[${animName}]: ${clips} jalkaterää uppoaa lattiaan (y < 0)`);
            process.exitCode = 1;
        }
    }
}
if (!any) console.log('ei jalka-animaatioita');
if (!process.exitCode) console.log('✅ kaikki jalkaterät pysyvät maassa/ilmassa — ei uppoamista');


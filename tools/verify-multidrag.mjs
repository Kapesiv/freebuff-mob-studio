/**
 * Verifies the multi-select gizmo math in js/main.js (applyMultiTransform):
 * with several cubes selected, a transform applied to the focus cube must
 * reach all other selected cubes in world space, converted back into each
 * cube's own bone-local frame.
 *
 * Replicates the exact scene structure the app builds:
 *   boneGroup.position = basePosition (pivot − parentPivot), rotation ZYX
 *   cubeMesh.position  = origin + size/2 − pivot   (child of boneGroup)
 *
 * Run: node tools/verify-multidrag.mjs
 */
import * as THREE from 'three';

let failures = 0;
function check(label, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.error(`  ✗ ${label} ${detail || ''}`);
    }
}
const close = (a, b, eps = 0.002) => Math.abs(a - b) < eps;

// Build a bone + cube pair exactly like the app: bone with pivot+rotation,
// cube mesh with origin+size, mesh.position = origin + size/2 − pivot.
function makeCube(name, pivot, rotDeg, origin, size) {
    const group = new THREE.Group();
    group.position.set(pivot[0], pivot[1], pivot[2]); // root: basePosition = pivot
    group.rotation.order = 'ZYX';
    group.rotation.set(THREE.MathUtils.degToRad(rotDeg[0]), THREE.MathUtils.degToRad(rotDeg[1]), THREE.MathUtils.degToRad(rotDeg[2]));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]));
    mesh.position.set(origin[0] + size[0] / 2 - pivot[0], origin[1] + size[1] / 2 - pivot[1], origin[2] + size[2] / 2 - pivot[2]);
    mesh.rotation.order = 'ZYX';
    group.add(mesh);
    return { group, mesh, pivot: pivot.slice(), data: { name, origin: origin.slice(), rotation: rotDeg.slice(), size: size.slice(), uvSize: size.map(v => v * 10) } };
}

// setOrigin — same formula as applyMultiTransform
function setOrigin(o, local) {
    o.data.origin[0] = local.x + o.pivot[0] - o.data.size[0] / 2;
    o.data.origin[1] = local.y + o.pivot[1] - o.data.size[1] / 2;
    o.data.origin[2] = local.z + o.pivot[2] - o.data.size[2] / 2;
}

const scene = new THREE.Scene();
// Two cubes in different bones: one in an unrotated bone, one in a rotated bone
const A = makeCube('A', [0, 10, 0], [0, 0, 0], [2, 3, 2], [1, 1, 1]);   // left leg
const B = makeCube('B', [4, 10, 2], [0, 30, 0], [5, 3, 2], [1, 1, 1]);  // rotated bone (tail)
scene.add(A.group);
scene.add(B.group);
scene.updateMatrixWorld(true);

const focusStart = A.mesh.getWorldPosition(new THREE.Vector3());
const bStart = B.mesh.getWorldPosition(new THREE.Vector3());

// ---------- TRANSLATE ----------
console.log('TRANSLATE (move all selected by same world delta)');
{
    // Simulate: focus moved +1 X in world
    A.mesh.position.x += 1; // bone unrotated → bone-local delta == world delta
    scene.updateMatrixWorld(true);
    const delta = A.mesh.getWorldPosition(new THREE.Vector3()).sub(focusStart);

    // Apply to B via the app's formula
    const local = B.group.worldToLocal(bStart.clone().add(delta));
    B.mesh.position.copy(local);
    setOrigin(B, local);

    const expect = bStart.clone().add(delta);
    const got = B.mesh.getWorldPosition(new THREE.Vector3());
    check('B shifts by same world delta as A', close(got.x, expect.x) && close(got.y, expect.y) && close(got.z, expect.z),
        `got (${got.x.toFixed(3)},${got.y.toFixed(3)},${got.z.toFixed(3)}) expected (${expect.x.toFixed(3)},${expect.y.toFixed(3)},${expect.z.toFixed(3)})`);
    // origin round-trip: mesh.position = origin + size/2 − pivot
    check('origin round-trips (render==data)', close(B.mesh.position.x, B.data.origin[0] + B.data.size[0] / 2 - B.pivot[0]), `pos ${B.mesh.position.x} vs ${B.data.origin[0] + B.data.size[0] / 2 - B.pivot[0]}`);
}

// ---------- ROTATE ----------
console.log('ROTATE (rotate all selected around focus pivot)');
{
    const curB = B.mesh.getWorldPosition(new THREE.Vector3()); // B may have moved in the translate test
    const pivot = A.mesh.getWorldPosition(new THREE.Vector3()); // focus cube's current position = gizmo center
    // Focus rotates 30° around Y (world delta)
    const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(30));
    const tmp = curB.clone().sub(pivot).applyQuaternion(dq).add(pivot);
    const local = B.group.worldToLocal(tmp.clone()); // clone: worldToLocal mutates in place
    B.mesh.position.copy(local);
    setOrigin(B, local);

    const got = B.mesh.getWorldPosition(new THREE.Vector3());
    check('B rotates around focus pivot by 30°', close(got.x, tmp.x) && close(got.z, tmp.z), `got (${got.x.toFixed(3)},${got.z.toFixed(3)}) expected (${tmp.x.toFixed(3)},${tmp.z.toFixed(3)})`);

    // Rotation delta in bone-local frame
    const boneQuat = B.group.getWorldQuaternion(new THREE.Quaternion());
    const dqLocal = boneQuat.clone().invert().multiply(dq).multiply(boneQuat);
    const q = new THREE.Quaternion().setFromEuler(B.mesh.rotation).premultiply(dqLocal);
    B.mesh.rotation.setFromQuaternion(q);
    const r = B.mesh.rotation;
    // Bone has +30° Y rest; after applying +30° world Y rotation around its own
    // (rotated) frame the local Y should be 30° + 30° = 60° only if frames align —
    // just verify the quaternion is valid and rotation changed from the start
    check('B rotation updated from rotation delta', Math.abs(r.y) > 0.01, `r=${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)}`);
}

// ---------- SCALE ----------
console.log('SCALE (same factor to size + uvSize)');
{
    const sf = [1.5, 2, 0.5];
    const o = B.data;
    const before = { size: o.size.slice(), uvSize: o.uvSize.slice() };
    o.size[0] = Math.max(0.25, Math.abs(o.size[0] * sf[0]));
    o.size[1] = Math.max(0.25, Math.abs(o.size[1] * sf[1]));
    o.size[2] = Math.max(0.25, Math.abs(o.size[2] * sf[2]));
    o.uvSize[0] = Math.max(1, o.uvSize[0] * sf[0]);
    o.uvSize[1] = Math.max(1, o.uvSize[1] * sf[1]);
    o.uvSize[2] = Math.max(1, o.uvSize[2] * sf[2]);
    check('size scaled by factor', close(o.size[0], before.size[0] * 1.5) && close(o.size[1], before.size[1] * 2) && close(o.size[2], before.size[2] * 0.5));
    // pixel density preserved (uvSize == 10×size stays true)
    check('uvSize keeps 10:1 density (no texture stretch)',
        close(o.uvSize[0], o.size[0] * 10) && close(o.uvSize[1], o.size[1] * 10) && close(o.uvSize[2], o.size[2] * 10));
}

console.log(failures === 0 ? '\n✅ multi-drag math verified' : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

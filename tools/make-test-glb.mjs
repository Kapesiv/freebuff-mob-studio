// Generates a tiny test GLB (a blocky quadruped: body + head + 4 legs) and
// prints its base64 — used to test the in-browser voxelizer without big files.
import { writeFileSync } from 'fs';

function box(cx, cy, cz, w, h, d) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    // 8 corners, 12 triangles (2 per face), CCW winding
    const v = [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    const f = [
        [0, 2, 1], [0, 3, 2], // -z
        [4, 5, 6], [4, 6, 7], // +z
        [0, 1, 5], [0, 5, 4], // -y
        [3, 7, 6], [3, 6, 2], // +y
        [0, 4, 7], [0, 7, 3], // -x
        [1, 2, 6], [1, 6, 5]  // +x
    ];
    return { v, f };
}

// quadruped: y up, +z forward
const parts = [];
parts.push(box(0, 3.2, 0.8, 2.2, 1.2, 3.0));      // body (z-centered slightly forward)
parts.push(box(0, 4.6, 3.0, 0.9, 0.9, 0.9));      // head (front, up)
parts.push(box(-0.9, 0.6, 2.2, 0.4, 1.2, 0.4));   // front-left leg
parts.push(box(0.9, 0.6, 2.2, 0.4, 1.2, 0.4));    // front-right leg
parts.push(box(-0.9, 0.6, -1.0, 0.4, 1.2, 0.4));  // back-left leg
parts.push(box(0.9, 0.6, -1.0, 0.4, 1.2, 0.4));   // back-right leg
parts.push(box(0, 2.6, -2.6, 0.4, 0.4, 1.4));     // tail

const positions = [];
const indices = [];
let base = 0;
for (const p of parts) {
    for (const [x, y, z] of p.v) positions.push(x, y, z);
    for (const [a, b, c] of p.f) indices.push(base + a, base + b, base + c);
    base += 8;
}

const bin = Buffer.alloc(positions.length * 4 + indices.length * 2);
let o = 0;
for (const x of positions) { bin.writeFloatLE(x, o); o += 4; }
for (const i of indices) { bin.writeUInt16LE(i, o); o += 2; }

const json = {
    asset: { version: '2.0', generator: 'codebuff-test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
        primitives: [{
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0
        }]
    }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.62, 0.45, 0.28, 1] } }],
    accessors: [
        { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-1.1, 0, -3.3], max: [1.1, 5.05, 3.45] },
        { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }
    ],
    bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positions.length * 4, target: 34962 },
        { buffer: 0, byteOffset: positions.length * 4, byteLength: indices.length * 2, target: 34963 }
    ],
    buffers: [{ byteLength: bin.length }]
};
const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
const glb = Buffer.alloc(total);
glb.writeUInt32LE(0x46546c67, 0);
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(total, 8);
glb.writeUInt32LE(jsonBuf.length, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
jsonBuf.copy(glb, 20);
let p = 20 + jsonBuf.length;
glb.writeUInt32LE(bin.length, p);
glb.writeUInt32LE(0x004e4942, p + 4);
bin.copy(glb, p + 8);

writeFileSync('/tmp/vox/test-quad.glb', glb);
console.log(glb.toString('base64'));
console.error('bytes:', glb.length);

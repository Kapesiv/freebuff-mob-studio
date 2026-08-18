#!/usr/bin/env node
/**
 * Voxelize real 3D animal models (CC0 / CC-BY glTF) into Minecraft-style
 * voxel mobs for the library.
 *
 * Pipeline:
 *   1. Parse a .glb (JSON chunk + BIN chunk) WITHOUT textures — we only
 *      need positions, indices, vertex colors and material base color.
 *   2. Bake node world transforms into triangle soup (rest pose).
 *   3. Voxelize: mark surface cells (distance-to-triangle < 1 unit),
 *      flood-fill the outside, interior = not surface & not outside.
 *   4. Column-fill colors, merge Y-runs into boxes.
 *   5. Emit js/mobs/voxel.js with VOXEL_MOBS (Bedrock-style model +
 *      gentle idle bob animation). The editor auto-generates the shaded
 *      Minecraft texture from each cube's color.
 *
 * Models: three.js / Khronos glTF sample assets (CC-BY 4.0).
 * Usage:  node tools/voxelize.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { inflateSync } from 'zlib';
import { execFileSync } from 'child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------------- minimal PNG decoder (embedded textures) ----------------
export function decodePNG(buf) {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8, width, height, bitDepth, colorType, idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4);
            bitDepth = data[8]; colorType = data[9];
        } else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (!width || !height || bitDepth !== 8) return null;
    const bpp = colorType === 6 ? 4 : 3;
    if (colorType !== 6 && colorType !== 2) return null;
    let raw;
    try { raw = inflateSync(Buffer.concat(idat)); } catch { return null; }
    const stride = width * bpp;
    const out = Buffer.alloc(width * height * 4);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = Buffer.from(line);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? cur[x - bpp] : 0;
            const b = prev[x];
            const c = x >= bpp ? prev[x - bpp] : 0;
            let v = cur[x];
            if (filter === 1) v = (v + a) & 255;
            else if (filter === 2) v = (v + b) & 255;
            else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
            else if (filter === 4) {
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
            }
            cur[x] = v;
        }
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (colorType === 6) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]; }
            else { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; }
        }
        prev = cur;
    }
    return { width, height, data: out };
}

function sampleTexel(img, u, v) {
    let x = Math.floor((u - Math.floor(u)) * (img.width - 1));
    let y = Math.floor((1 - (v - Math.floor(v))) * (img.height - 1));
    if (x < 0) x = 0; if (x >= img.width) x = img.width - 1;
    if (y < 0) y = 0; if (y >= img.height) y = img.height - 1;
    const o = (y * img.width + x) * 4;
    return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
}

// ---------------- minimal glTF/GLB parser (no textures) ----------------

export function readAccessor(gltf, bin, acc) {
    if (acc.bufferView === undefined) return [];
    const bv = gltf.bufferViews[acc.bufferView];
    const buf = gltf.buffers[bv.buffer];
    const base = buf.byteOffset || 0;
    const start = base + (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || componentSize(acc.componentType) * compCount(acc.type);
    const out = [];
    const n = acc.count;
    const cs = componentSize(acc.componentType);
    const cc = compCount(acc.type);
    for (let i = 0; i < n; i++) {
        const off = start + i * stride;
        const v = [];
        for (let c = 0; c < cc; c++) {
            let val;
            if (acc.componentType === 5126) val = bin.readFloatLE(off + c * 4);
            else if (acc.componentType === 5121) val = bin.readUInt8(off + c);
            else if (acc.componentType === 5122) val = bin.readInt16LE(off + c * 2);
            else if (acc.componentType === 5123) val = bin.readUInt16LE(off + c * 2);
            else if (acc.componentType === 5125) val = bin.readUInt32LE(off + c * 4);
            else if (acc.componentType === 5120) val = bin.readInt8(off + c);
            else throw new Error('componentType ' + acc.componentType);
            if (acc.normalized && (acc.componentType === 5121 || acc.componentType === 5123 || acc.componentType === 5120 || acc.componentType === 5122)) {
                const max = acc.componentType === 5121 ? 255 : acc.componentType === 5123 ? 65535 : acc.componentType === 5122 ? 32767 : 127;
                val = Math.max(-1, Math.min(1, val / max));
            }
            v.push(val);
        }
        out.push(v);
    }
    return out;
}

function componentSize(t) {
    return t === 5126 ? 4 : t === 5125 ? 4 : t === 5121 || t === 5120 ? 1 : 2;
}
function compCount(type) {
    return type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : 0;
}

export function parseGLB(bytes) {
    const magic = bytes.readUInt32LE(0);
    if (magic !== 0x46546c67) throw new Error('not a GLB');
    let off = 12;
    let json, bin;
    while (off < bytes.length) {
        const len = bytes.readUInt32LE(off);
        const type = bytes.readUInt32LE(off + 4);
        const data = bytes.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
        else if (type === 0x004e4942) bin = data;
        off += 8 + len;
    }
    return { json, bin };
}

// minimal mat4 (column-major like glTF)
function mat4Mul(a, b) {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
    }
    return o;
}
function mat4TRS(t, q, s) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z;
    const wx = w * x, wy = w * y, wz = w * z;
    const m = new Float64Array(16);
    m[0] = (1 - 2 * (yy + zz)) * s[0]; m[1] = 2 * (xy + wz);       m[2] = 2 * (xz - wy);
    m[4] = 2 * (xy - wz);             m[5] = (1 - 2 * (xx + zz)) * s[1]; m[6] = 2 * (yz + wx);
    m[8] = 2 * (xz + wy);             m[9] = 2 * (yz - wx);       m[10] = (1 - 2 * (xx + yy)) * s[2];
    m[3] = t[0]; m[7] = t[1]; m[11] = t[2]; m[15] = 1;
    return m;
}
function transformPoint(m, p) {
    return [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[3],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[7],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[11]
    ];
}

export function collectTriangles(path) {
    const bytes = readFileSync(path);
    const { json, bin } = parseGLB(bytes);
    const scene = json.scenes[json.scene || 0];
    const tris = [];
    const colorCache = new Map();

    // decode embedded base-color textures for materials (PNG + JPEG via sips)
    const tmpJpeg = join('/tmp', 'vox_tex_' + Math.random().toString(36).slice(2) + '.jpg');
    const imgByIndex = (json.images || []).map(img => {
        if (img.bufferView === undefined) return null;
        const bv = json.bufferViews[img.bufferView];
        const bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
        if (img.mimeType === 'image/png') return decodePNG(bytes);
        if (img.mimeType === 'image/jpeg') {
            try {
                writeFileSync(tmpJpeg, bytes);
                const pngOut = tmpJpeg.replace('.jpg', '.png');
                execFileSync('sips', ['-s', 'format', 'png', tmpJpeg, '--out', pngOut], { stdio: 'pipe' });
                return decodePNG(readFileSync(pngOut));
            } catch { return null; }
        }
        return null;
    });
    const texImage = (json.textures || []).map(tex =>
        tex && tex.source !== undefined ? imgByIndex[tex.source] : null
    );
    const matInfo = (json.materials || []).map(m => {
        const p = m && m.pbrMetallicRoughness;
        const f = (p && p.baseColorFactor) || [1, 1, 1, 1];
        const img = (p && p.baseColorTexture && p.baseColorTexture.index !== undefined)
            ? texImage[p.baseColorTexture.index] : null;
        return { factor: [Math.min(1, f[0]), Math.min(1, f[1]), Math.min(1, f[2])], img };
    });

    function nodeColor(matIdx) {
        if (matIdx === undefined) return { factor: [1, 1, 1], img: null };
        if (colorCache.has(matIdx)) return colorCache.get(matIdx);
        const c = matInfo[matIdx] || { factor: [1, 1, 1], img: null };
        colorCache.set(matIdx, c);
        return c;
    }

    function visit(nodeIdx, world) {
        const node = json.nodes[nodeIdx];
        let m = world;
        if (node.matrix) {
            const gm = new Float64Array(16);
            for (let i = 0; i < 16; i++) gm[i] = node.matrix[i];
            m = mat4Mul(gm, world);
        } else {
            const t = node.translation || [0, 0, 0];
            const q = node.rotation || [0, 0, 0, 1];
            const s = node.scale || [1, 1, 1];
            m = mat4Mul(mat4TRS(t, q, s), world);
        }
        if (node.mesh !== undefined) {
            const mesh = json.meshes[node.mesh];
            for (const prim of mesh.primitives) {
                const posAcc = json.accessors[prim.attributes.POSITION];
                const idxAcc = prim.indices !== undefined ? json.accessors[prim.indices] : null;
                const colAcc = prim.attributes.COLOR_0 !== undefined ? json.accessors[prim.attributes.COLOR_0] : null;
                const uvAcc = prim.attributes.TEXCOORD_0 !== undefined ? json.accessors[prim.attributes.TEXCOORD_0] : null;
                const { factor: matFactor, img: matImg } = nodeColor(prim.material);
                const pos = readAccessor(json, bin, posAcc);
                const idx = idxAcc ? readAccessor(json, bin, idxAcc).map(v => v[0]) : pos.map((_, i) => i);
                const cols = colAcc ? readAccessor(json, bin, colAcc) : null;
                const uvs = uvAcc && matImg ? readAccessor(json, bin, uvAcc) : null;
                for (let i = 0; i < idx.length; i += 3) {
                    const ia = idx[i], ib = idx[i + 1], ic = idx[i + 2];
                    const a = transformPoint(m, pos[ia]);
                    const b = transformPoint(m, pos[ib]);
                    const c = transformPoint(m, pos[ic]);
                    let color = matFactor;
                    if (uvs && matImg) {
                        const ca = sampleTexel(matImg, uvs[ia][0], uvs[ia][1]);
                        const cb = sampleTexel(matImg, uvs[ib][0], uvs[ib][1]);
                        const cc = sampleTexel(matImg, uvs[ic][0], uvs[ic][1]);
                        color = [
                            (ca[0] + cb[0] + cc[0]) / 3 * matFactor[0],
                            (ca[1] + cb[1] + cc[1]) / 3 * matFactor[1],
                            (ca[2] + cb[2] + cc[2]) / 3 * matFactor[2]
                        ];
                    } else if (cols) {
                        const ca = cols[ia], cb = cols[ib], cc = cols[ic];
                        color = [
                            (ca[0] + cb[0] + cc[0]) / 3 * matFactor[0],
                            (ca[1] + cb[1] + cc[1]) / 3 * matFactor[1],
                            (ca[2] + cb[2] + cc[2]) / 3 * matFactor[2]
                        ];
                    }
                    tris.push({ a, b, c, color });
                }
            }
        }
        for (const ch of node.children || []) visit(ch, m);
    }
    for (const n of scene.nodes) visit(n, new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    return tris;
}

// ---------------- voxelization ----------------

function closestPointOnTriangle(p, a, b, c) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2];
    const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2];
    const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2];
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const t = d1 / (d1 - d3);
        return [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]];
    }
    const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2];
    const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2];
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const t = d2 / (d2 - d6);
        return [a[0] + t * ac[0], a[1] + t * ac[1], a[2] + t * ac[2]];
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return [b[0] + t * (c[0] - b[0]), b[1] + t * (c[1] - b[1]), b[2] + t * (c[2] - b[2])];
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

export function voxelize(tris, targetHeightUnits, voxelUnits = 1) {
    // world bbox
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const p of [t.a, t.b, t.c]) {
        for (let i = 0; i < 3; i++) {
            if (p[i] < mn[i]) mn[i] = p[i];
            if (p[i] > mx[i]) mx[i] = p[i];
        }
    }
    const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    // target grid cells along the longest axis, so a voxel ≈ voxelUnits (1/16 block)
    const nCells = Math.max(8, Math.round(targetHeightUnits / voxelUnits));
    const cell = span / nCells; // world units per voxel
    const margin = 2;
    const cmin = [Math.floor(mn[0] / cell) - margin, Math.floor(mn[1] / cell) - margin, Math.floor(mn[2] / cell) - margin];
    const cmax = [Math.ceil(mx[0] / cell) + margin, Math.ceil(mx[1] / cell) + margin, Math.ceil(mx[2] / cell) + margin];
    const gx = cmax[0] - cmin[0] + 1, gy = cmax[1] - cmin[1] + 1, gz = cmax[2] - cmin[2] + 1;
    const cellCenter = (i, ax) => (cmin[ax] + i + 0.5) * cell;
    const key = (x, y, z) => (x * gy + y) * gz + z;

    const grid = new Uint8Array(gx * gy * gz); // 0 unvisited, 1 surface, 2 outside, 3 interior
    const cellColors = new Float32Array(gx * gy * gz * 3);
    const cellTri = new Map(); // cellKey -> [triIdx...]

    // --- surface marking (with per-cell best triangle color) ---
    const cellT = cell;
    for (let ti = 0; ti < tris.length; ti++) {
        const t = tris[ti];
        const ta = [t.a[0] / cell, t.a[1] / cell, t.a[2] / cell];
        const tb = [t.b[0] / cell, t.b[1] / cell, t.b[2] / cell];
        const tc = [t.c[0] / cell, t.c[1] / cell, t.c[2] / cell];
        const tmn = [Math.min(ta[0], tb[0], tc[0]), Math.min(ta[1], tb[1], tc[1]), Math.min(ta[2], tb[2], tc[2])];
        const tmx = [Math.max(ta[0], tb[0], tc[0]), Math.max(ta[1], tb[1], tc[1]), Math.max(ta[2], tb[2], tc[2])];
        const x0 = Math.max(0, Math.floor(tmn[0]) - 1 - cmin[0]), x1 = Math.min(gx - 1, Math.ceil(tmx[0]) + 1 - cmin[0]);
        const y0 = Math.max(0, Math.floor(tmn[1]) - 1 - cmin[1]), y1 = Math.min(gy - 1, Math.ceil(tmx[1]) + 1 - cmin[1]);
        const z0 = Math.max(0, Math.floor(tmn[2]) - 1 - cmin[2]), z1 = Math.min(gz - 1, Math.ceil(tmx[2]) + 1 - cmin[2]);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
            const k = key(x, y, z);
            const lst = cellTri.get(k);
            if (!lst) cellTri.set(k, [ti]);
            else if (lst.length < 24) lst.push(ti);
        }
    }
    // distance-based surface: a cell is surface if its center is within cellT
    // of any triangle (checked against triangles registered for that cell).
    const near = new Float32Array(gx * gy * gz).fill(Infinity);
    const nearIdx = new Int32Array(gx * gy * gz).fill(-1);
    for (const [k, lst] of cellTri) {
        const x = Math.floor(k / (gy * gz)), rem = k % (gy * gz), y = Math.floor(rem / gz), z = rem % gz;
        const p = [cellCenter(x, 0), cellCenter(y, 1), cellCenter(z, 2)];
        let best = Infinity, bestT = -1;
        for (const ti of lst) {
            const t = tris[ti];
            const q = closestPointOnTriangle(p, t.a, t.b, t.c);
            const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < best) { best = d2; bestT = ti; }
        }
        if (bestT >= 0) {
            near[k] = best;
            nearIdx[k] = bestT;
            if (best < cellT * cellT * 0.72) grid[k] = 1;
        }
    }
    // ensure surface shell has no single-cell holes: also mark neighbors of
    // surface cells that have a triangle within 1.2 cells
    for (const [k, lst] of cellTri) {
        if (grid[k] === 1) continue;
        if (near[k] < cellT * cellT * 1.3) grid[k] = 1;
    }

    // --- flood fill outside from the boundary ---
    const stack = [];
    const push = (x, y, z) => {
        const k = key(x, y, z);
        if (grid[k] === 0) { grid[k] = 2; stack.push(k); }
    };
    for (let x = 0; x < gx; x++) for (let y = 0; y < gy; y++) { push(x, y, 0); push(x, y, gz - 1); }
    for (let x = 0; x < gx; x++) for (let z = 0; z < gz; z++) { push(x, 0, z); push(x, gy - 1, z); }
    for (let y = 0; y < gy; y++) for (let z = 0; z < gz; z++) { push(0, y, z); push(gx - 1, y, z); }
    while (stack.length) {
        const k = stack.pop();
        const x = Math.floor(k / (gy * gz)), rem = k % (gy * gz), y = Math.floor(rem / gz), z = rem % gz;
        if (x > 0) push(x - 1, y, z);
        if (x < gx - 1) push(x + 1, y, z);
        if (y > 0) push(x, y - 1, z);
        if (y < gy - 1) push(x, y + 1, z);
        if (z > 0) push(x, y, z - 1);
        if (z < gz - 1) push(x, y, z + 1);
    }
    // interior = remaining unvisited
    for (let k = 0; k < grid.length; k++) if (grid[k] === 0) grid[k] = 3;

    // --- colors ---
    // surface cell color from nearest triangle
    for (let k = 0; k < grid.length; k++) {
        if (grid[k] === 1 && nearIdx[k] >= 0) {
            const c = tris[nearIdx[k]].color;
            cellColors[k * 3] = c[0]; cellColors[k * 3 + 1] = c[1]; cellColors[k * 3 + 2] = c[2];
        }
    }
    // interior: column fill — take the surface color below (or above) in the same column
    for (let x = 0; x < gx; x++) for (let z = 0; z < gz; z++) {
        let lastSurf = null;
        for (let y = 0; y < gy; y++) {
            const k = key(x, y, z);
            if (grid[k] === 1) lastSurf = [cellColors[k * 3], cellColors[k * 3 + 1], cellColors[k * 3 + 2]];
            else if (grid[k] === 3 && lastSurf) {
                cellColors[k * 3] = lastSurf[0]; cellColors[k * 3 + 1] = lastSurf[1]; cellColors[k * 3 + 2] = lastSurf[2];
            }
        }
        lastSurf = null;
        for (let y = gy - 1; y >= 0; y--) {
            const k = key(x, y, z);
            if (grid[k] === 1) lastSurf = [cellColors[k * 3], cellColors[k * 3 + 1], cellColors[k * 3 + 2]];
            else if (grid[k] === 3 && !lastSurf) {
                cellColors[k * 3] = cellColors[k * 3]; // already handled below-fill
            } else if (grid[k] === 3 && cellColors[k * 3] === 0 && cellColors[k * 3 + 1] === 0 && cellColors[k * 3 + 2] === 0 && lastSurf) {
                cellColors[k * 3] = lastSurf[0]; cellColors[k * 3 + 1] = lastSurf[1]; cellColors[k * 3 + 2] = lastSurf[2];
            }
        }
    }

    // --- merge Y-runs into boxes ---
    const boxes = [];
    for (let x = 0; x < gx; x++) for (let z = 0; z < gz; z++) {
        let y = 0;
        while (y < gy) {
            if (grid[key(x, y, z)] === 2 || grid[key(x, y, z)] === 0) { y++; continue; }
            const start = y;
            const col = [cellColors[key(x, y, z) * 3], cellColors[key(x, y, z) * 3 + 1], cellColors[key(x, y, z) * 3 + 2]];
            while (y < gy && grid[key(x, y, z)] !== 2 && grid[key(x, y, z)] !== 0) y++;
            boxes.push({ x, z, y0: start, y1: y - 1, color: col });
        }
    }

    // --- map to Bedrock units, center X/Z, ground at y=0, face -Z ---
    let bminX = Infinity, bmaxX = -Infinity, bminZ = Infinity, bmaxZ = -Infinity, bminY = Infinity, bmaxY = -Infinity;
    for (const b of boxes) {
        if (b.x < bminX) bminX = b.x;
        if (b.x > bmaxX) bmaxX = b.x;
        if (b.z < bminZ) bminZ = b.z;
        if (b.z > bmaxZ) bmaxZ = b.z;
        if (b.y0 < bminY) bminY = b.y0;
        if (b.y1 > bmaxY) bmaxY = b.y1;
    }
    const cx = (bminX + bmaxX) / 2, cz = (bminZ + bmaxZ) / 2;
    // rescale so the model height is exactly targetHeightUnits (16 units = 1 block)
    const heightCells = bmaxY - bminY + 1;
    const factor = targetHeightUnits / (heightCells * cell);
    const out = boxes.map((b, i) => {
        // voxel center (unit space) -> origin of a size-`cell` box
        const ox = (b.x - cx) * cell * factor;
        const oz = (b.z - cz) * cell * factor;
        const oy = (b.y0 - bminY) * cell * factor;
        const sizeY = (b.y1 - b.y0 + 1) * cell * factor;
        const hex = '#' + b.color.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
        return {
            name: `v${i}`,
            origin: [-ox, oy, -oz], // negate x & z -> model faces -Z like vanilla mobs
            size: [cell * factor, sizeY, cell * factor],
            rotation: [0, 0, 0],
            color: hex,
            uv: {},
            mirror: false
        };
    });
    return { cubes: out, cell: cell * factor, heightUnits: targetHeightUnits, boxes, bminY, cx, cz, cellUnits: cell * factor, gridCell: cell, factor };
}

// ---------------- UV shelf packing (same as library autoLayoutUVs) ----------------

function packUVs(cubes, texW, texH) {
    for (let attempt = 0; attempt < 6; attempt++) {
        let y = 0, rowH = 0, x = 0, overflow = false;
        for (const c of cubes) {
            const [w, h, d] = c.size;
            const extW = 2 * d + 2 * w;
            const extH = d + h;
            if (x + extW > texW) {
                x = 0;
                y += rowH;
                rowH = 0;
            }
            if (y + extH > texH) { overflow = true; break; }
            // Kokonaislukuoffsetit + 1 px rako: ei liukulukupäällekkäisyyksiä
            c.uv = { offset: [Math.floor(x), Math.floor(y)] };
            x = Math.ceil(x + extW) + 1;
            rowH = Math.max(rowH, Math.ceil(extH));
        }
        if (!overflow) return { texW, texH };
        texW *= 2;
        texH *= 2;
    }
    return { texW, texH };
}

// ---------------- emit library module ----------------

const MODELS = [
    { file: 'DragonAttenuation.glb', id: 'vox_dragon', name: 'Voxel Dragon', emoji: '🐉', desc: 'CC-BY 3D dragon (three.js glTF sample, DragonAttenuation) voxelized into a blocky boss', heightBlocks: 4.5, voxel: 2 },
    { file: 'Horse.glb', id: 'vox_horse', name: 'Voxel Horse', emoji: '🐎', desc: 'Real horse model (three.js glTF sample) voxelized into blocks', heightBlocks: 2.2 },
    { file: 'Fox.glb', id: 'vox_fox', name: 'Voxel Fox', emoji: '🦊', desc: 'Real fox model (Khronos glTF-Sample, CC-BY 4.0) voxelized into blocks', heightBlocks: 1.1 },
    { file: 'Flamingo.glb', id: 'vox_flamingo', name: 'Voxel Flamingo', emoji: '🦩', desc: 'Real flamingo model (three.js glTF sample) voxelized into blocks', heightBlocks: 1.6 },
    { file: 'Parrot.glb', id: 'vox_parrot', name: 'Voxel Parrot', emoji: '🦜', desc: 'Real parrot model (three.js glTF sample) voxelized into blocks', heightBlocks: 1.0 },
    { file: 'Stork.glb', id: 'vox_stork', name: 'Voxel Stork', emoji: '🦤', desc: 'Real stork model (three.js glTF sample) voxelized into blocks', heightBlocks: 1.8 }
];

const out = [];
const counts = [];
for (const cfg of MODELS) {
    const src = join('/tmp/vox', cfg.file);
    if (!existsSync(src)) { console.error('missing', src); continue; }
    console.log(`--- ${cfg.name} ---`);
    const tris = collectTriangles(src);
    console.log(`triangles: ${tris.length}`);
    // target height in units: 16 units = 1 block
    const { cubes, heightUnits } = voxelize(tris, cfg.heightBlocks * 16, cfg.voxel || 1);
    // Pakkaa UV:t datatasolle (varmentaja vaatii päällekkäisyydettömät rectit)
    const { texW, texH } = packUVs(cubes, 128, 128);
    console.log(`cubes: ${cubes.length}, height: ${(heightUnits / 16).toFixed(2)} blocks, tex ${texW}x${texH}`);
    counts.push([cfg.name, tris.length, cubes.length]);
    // kamerasovitus: keskelle korkeuden puoliväliin, säde = suurin mitta
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const c of cubes) for (let i = 0; i < 3; i++) {
        if (c.origin[i] < mn[i]) mn[i] = c.origin[i];
        if (c.origin[i] + c.size[i] > mx[i]) mx[i] = c.origin[i] + c.size[i];
    }
    const fit = {
        center: [0, (mn[1] + mx[1]) / 2, 0],
        radius: Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2
    };
    out.push({
        id: cfg.id,
        name: cfg.name,
        emoji: cfg.emoji,
        description: cfg.desc,
        fit,
        model: {
            modelId: `geometry.${cfg.id}`,
            textureWidth: texW,
            textureHeight: texH,
            visibleBoundsWidth: Math.ceil(heightUnits / 16) * 2,
            visibleBoundsHeight: Math.ceil(heightUnits / 16) * 2,
            visibleBoundsOffset: [0, 0, 0],
            bones: [{
                name: 'root',
                parent: null,
                pivot: [0, 0, 0],
                rotation: [0, 0, 0],
                cubes
            }]
        },
        animation: {
            length: 60,
            tracks: {
                root: {
                    0: [0, 0, 0],
                    30: [1.5, 0, 0],
                    60: [0, 0, 0]
                }
            }
        }
    });
}

const js = `/**
 * VOXEL_MOBS — real 3D animal models (CC0/CC-BY glTF samples) voxelized
 * into Minecraft-style blocky mobs by tools/voxelize.mjs.
 *
 * Models: three.js examples / Khronos glTF-Sample-Assets, CC-BY 4.0
 * (Fox, DragonAttenuation, Horse, Flamingo, Parrot, Stork, duck).
 * Each cube carries a color; the editor auto-generates the shaded
 * Minecraft texture (per-face shading + dithering).
 */
export const VOXEL_MOBS = ${JSON.stringify(out, null, 2)};
`;
const dest = join(root, 'js/mobs/voxel.js');
writeFileSync(dest, js);
console.log(`\n✅ wrote ${dest} (${(js.length / 1024).toFixed(1)} KB)`);
console.log('\nsummary:');
for (const [n, t, c] of counts) console.log(`  ${n}: ${t} tris -> ${c} cubes`);

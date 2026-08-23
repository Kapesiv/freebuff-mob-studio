/**
 * Browser-side voxelizer — drag & drop your own GLB/OBJ model and turn it
 * into a Minecraft-style voxel mob, right in the editor.
 *
 * Pipeline (mirrors tools/voxelize.mjs — keep the math in sync):
 *   1. Parse .glb (JSON+BIN chunks) with embedded PNG/JPEG textures, or
 *      parse .obj (+ optional .mtl colors / map_Kd texture image).
 *   2. Bake node world transforms into triangle soup (rest pose).
 *   3. Voxelize: surface cells (distance to triangles), outside flood fill,
 *      interior fill, column color fill, Y-run merge into boxes.
 *   4. Auto bone split (tools/voxel-parts.mjs): body / head / legs / wings /
 *      tail — geometric heuristics, no node names needed.
 *   5. Build Bedrock-style bones + pivots + idle/walk/fly animations,
 *      shelf-packed UVs, and a camera fit. Returns a full library mob entry.
 *
 * Only the pure math lives here; the classifier is shared with the Node
 * generator via ../tools/voxel-parts.mjs (pure ESM, no Node imports).
 */
import { classifyVoxelParts, bboxOf, cellKey } from '../tools/voxel-parts.mjs';

// ---------------- texture decoding (browser) ----------------

async function decodePNGBrowser(buf) {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8, width, height, bitDepth, colorType, idat = [];
    while (off < buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        off += 12 + len;
    }
    if (!width || !height || bitDepth !== 8) return null;
    const bpp = colorType === 6 ? 4 : 3;
    if (colorType !== 6 && colorType !== 2) return null;
    let raw;
    try {
        const ds = new DecompressionStream('deflate');
        const stream = new Blob(idat).stream().pipeThrough(ds);
        raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { return null; }
    const stride = width * bpp;
    const out = new Uint8Array(width * height * 4);
    let prev = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = new Uint8Array(line);
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

async function decodeJPEGBrowser(buf) {
    try {
        const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width; canvas.height = bmp.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height, data: img.data };
    } catch { return null; }
}

function sampleTexel(img, u, v) {
    let x = Math.floor((u - Math.floor(u)) * (img.width - 1));
    let y = Math.floor((1 - (v - Math.floor(v))) * (img.height - 1));
    if (x < 0) x = 0; if (x >= img.width) x = img.width - 1;
    if (y < 0) y = 0; if (y >= img.height) y = img.height - 1;
    const o = (y * img.width + x) * 4;
    return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
}

// ---------------- glTF/GLB parsing ----------------

function readAccessor(gltf, bin, acc) {
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
            if (acc.componentType === 5126) val = bin.getFloat32(off + c * 4, true);
            else if (acc.componentType === 5121) val = bin.getUint8(off + c);
            else if (acc.componentType === 5122) val = bin.getInt16(off + c * 2, true);
            else if (acc.componentType === 5123) val = bin.getUint16(off + c * 2, true);
            else if (acc.componentType === 5125) val = bin.getUint32(off + c * 4, true);
            else if (acc.componentType === 5120) val = bin.getInt8(off + c);
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

function componentSize(t) { return t === 5126 ? 4 : t === 5125 ? 4 : t === 5121 || t === 5120 ? 1 : 2; }
function compCount(type) { return type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : type === 'VEC4' ? 4 : 0; }

function parseGLB(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
    let off = 12;
    let json, bin = null;
    while (off < bytes.length) {
        const len = view.getUint32(off, true);
        const type = view.getUint32(off + 4, true);
        const data = bytes.subarray(off + 8, off + 8 + len);
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(data));
        else if (type === 0x004e4942) bin = new DataView(data.buffer, data.byteOffset, data.byteLength);
        off += 8 + len;
    }
    if (!bin) throw new Error('GLB has no BIN chunk');
    return { json, bin };
}

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
    m[0] = (1 - 2 * (yy + zz)) * s[0]; m[1] = 2 * (xy + wz); m[2] = 2 * (xz - wy);
    m[4] = 2 * (xy - wz); m[5] = (1 - 2 * (xx + zz)) * s[1]; m[6] = 2 * (yz + wx);
    m[8] = 2 * (xz + wy); m[9] = 2 * (yz - wx); m[10] = (1 - 2 * (xx + yy)) * s[2];
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

async function collectTrianglesGLB(json, bin) {
    const scene = json.scenes[json.scene || 0];
    const tris = [];
    const colorCache = new Map();

    const imgByIndex = [];
    for (const img of (json.images || [])) {
        if (img.bufferView === undefined) { imgByIndex.push(null); continue; }
        const bv = json.bufferViews[img.bufferView];
        const bytes = bin.buffer.slice(bin.byteOffset + (bv.byteOffset || 0), bin.byteOffset + (bv.byteOffset || 0) + bv.byteLength);
        if (img.mimeType === 'image/png') imgByIndex.push(await decodePNGBrowser(new Uint8Array(bytes)));
        else if (img.mimeType === 'image/jpeg') imgByIndex.push(await decodeJPEGBrowser(new Uint8Array(bytes)));
        else imgByIndex.push(null);
    }
    const texImage = (json.textures || []).map(tex => (tex && tex.source !== undefined ? imgByIndex[tex.source] : null));
    const matInfo = (json.materials || []).map(m => {
        const p = m && m.pbrMetallicRoughness;
        const f = (p && p.baseColorFactor) || [1, 1, 1, 1];
        const img = (p && p.baseColorTexture && p.baseColorTexture.index !== undefined)
            ? texImage[p.baseColorTexture.index] : null;
        return { factor: [Math.min(1, f[0]), Math.min(1, f[1]), Math.min(1, f[2])], img };
    });
    const nodeColor = (matIdx) => {
        if (matIdx === undefined) return { factor: [1, 1, 1], img: null };
        if (colorCache.has(matIdx)) return colorCache.get(matIdx);
        const c = matInfo[matIdx] || { factor: [1, 1, 1], img: null };
        colorCache.set(matIdx, c);
        return c;
    };

    const visit = (nodeIdx, world) => {
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
    };
    for (const n of scene.nodes) visit(n, new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    return tris;
}

// ---------------- OBJ parsing ----------------

function parseOBJ(text) {
    const verts = [], uvs = [], faces = [];
    let curMtl = null;
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const parts = t.split(/\s+/);
        const tag = parts[0];
        const rest = parts.slice(1);
        if (tag === 'v') verts.push([Number(rest[0]), Number(rest[1]), Number(rest[2])]);
        else if (tag === 'vt') uvs.push([Number(rest[0]), Number(rest[1])]);
        else if (tag === 'usemtl') curMtl = rest.join(' ');
        else if (tag === 'f') {
            const idxs = rest.map(s => {
                const [vi, ti] = s.split('/');
                return [parseInt(vi, 10) - 1, ti !== undefined && ti !== '' ? parseInt(ti, 10) - 1 : -1];
            });
            for (let i = 1; i < idxs.length - 1; i++) {
                faces.push({ a: idxs[0], b: idxs[i], c: idxs[i + 1], mtl: curMtl || null });
            }
        }
    }
    return { verts, uvs, faces };
}

function parseMTL(text) {
    const mats = {};
    let cur = null;
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const parts = t.split(/\s+/);
        const tag = parts[0];
        const rest = parts.slice(1);
        if (tag === 'newmtl') { cur = rest.join(' '); mats[cur] = { color: [0.6, 0.63, 0.66], map: null }; }
        else if (tag === 'Kd' && cur) mats[cur].color = [Number(rest[0]), Number(rest[1]), Number(rest[2])];
        else if (tag === 'map_Kd' && cur) mats[cur].map = rest.join(' ').replace(/^.*[\\/]/, '');
    }
    return mats;
}

async function trisFromOBJ(objBytes, aux) {
    const text = new TextDecoder().decode(objBytes);
    const parsed = parseOBJ(text);
    if (!parsed.verts.length || !parsed.faces.length) throw new Error('OBJ has no geometry (v/f rows)');
    // aux: { name -> bytes }; find .mtl referenced by mtllib
    let mtlText = null, imgBytes = null, imgName = null;
    const m = text.match(/^mtllib\s+(.+)$/mi);
    if (m) {
        const mtlName = m[1].trim().replace(/^.*[\\/]/, '');
        const mtlFile = aux.find(f => f.name.toLowerCase() === mtlName.toLowerCase());
        if (mtlFile) {
            mtlText = new TextDecoder().decode(mtlFile.bytes);
            const mats = parseMTL(mtlText);
            // first map_Kd with a dropped image
            for (const mat of Object.values(mats)) {
                if (mat.map) {
                    const img = aux.find(f => f.name.toLowerCase() === mat.map.toLowerCase());
                    if (img) { imgBytes = img.bytes; imgName = mat.map; break; }
                }
            }
        }
    }
    let img = null;
    if (imgBytes) {
        const low = imgName.toLowerCase();
        if (low.endsWith('.png')) img = await decodePNGBrowser(new Uint8Array(imgBytes));
        else if (low.endsWith('.jpg') || low.endsWith('.jpeg')) img = await decodeJPEGBrowser(new Uint8Array(imgBytes));
    }
    const mats = mtlText ? parseMTL(mtlText) : {};
    const defaultColor = [0.6, 0.63, 0.66];
    const tris = [];
    for (const f of parsed.faces) {
        const ia = f.a[0], ib = f.b[0], ic = f.c[0];
        const va = parsed.verts[ia], vb = parsed.verts[ib], vc = parsed.verts[ic];
        if (!va || !vb || !vc) continue;
        let color = (f.mtl && mats[f.mtl]) ? mats[f.mtl].color : defaultColor;
        if (img && parsed.uvs.length) {
            const ua = f.a[1] >= 0 ? parsed.uvs[f.a[1]] : null;
            const ub = f.b[1] >= 0 ? parsed.uvs[f.b[1]] : null;
            const uc = f.c[1] >= 0 ? parsed.uvs[f.c[1]] : null;
            const ca = ua ? sampleTexel(img, ua[0], ua[1]) : color;
            const cb = ub ? sampleTexel(img, ub[0], ub[1]) : color;
            const cc = uc ? sampleTexel(img, uc[0], uc[1]) : color;
            color = [(ca[0] + cb[0] + cc[0]) / 3, (ca[1] + cb[1] + cc[1]) / 3, (ca[2] + cb[2] + cc[2]) / 3];
        }
        tris.push({ a: va, b: vb, c: vc, color });
    }
    if (!tris.length) throw new Error('OBJ has no triangles');
    return tris;
}

// ---------------- voxelization (ported from tools/voxelize.mjs) ----------------

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
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const p of [t.a, t.b, t.c]) {
        for (let i = 0; i < 3; i++) {
            if (p[i] < mn[i]) mn[i] = p[i];
            if (p[i] > mx[i]) mx[i] = p[i];
        }
    }
    const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    const nCells = Math.max(8, Math.round(targetHeightUnits / voxelUnits));
    const cell = span / nCells;
    const margin = 2;
    const cmin = [Math.floor(mn[0] / cell) - margin, Math.floor(mn[1] / cell) - margin, Math.floor(mn[2] / cell) - margin];
    const cmax = [Math.ceil(mx[0] / cell) + margin, Math.ceil(mx[1] / cell) + margin, Math.ceil(mx[2] / cell) + margin];
    const gx = cmax[0] - cmin[0] + 1, gy = cmax[1] - cmin[1] + 1, gz = cmax[2] - cmin[2] + 1;
    const cellCenter = (i, ax) => (cmin[ax] + i + 0.5) * cell;
    const key = (x, y, z) => (x * gy + y) * gz + z;

    const grid = new Uint8Array(gx * gy * gz);
    const cellColors = new Float32Array(gx * gy * gz * 3);
    const cellTri = new Map();

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
    for (const [k, lst] of cellTri) {
        if (grid[k] === 1) continue;
        if (near[k] < cellT * cellT * 1.3) grid[k] = 1;
    }

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
    for (let k = 0; k < grid.length; k++) if (grid[k] === 0) grid[k] = 3;

    for (let k = 0; k < grid.length; k++) {
        if (grid[k] === 1 && nearIdx[k] >= 0) {
            const c = tris[nearIdx[k]].color;
            cellColors[k * 3] = c[0]; cellColors[k * 3 + 1] = c[1]; cellColors[k * 3 + 2] = c[2];
        }
    }
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
            else if (grid[k] === 3 && cellColors[k * 3] === 0 && cellColors[k * 3 + 1] === 0 && cellColors[k * 3 + 2] === 0 && lastSurf) {
                cellColors[k * 3] = lastSurf[0]; cellColors[k * 3 + 1] = lastSurf[1]; cellColors[k * 3 + 2] = lastSurf[2];
            }
        }
    }

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
    // Rescale niin että mallin korkeus on TÄSMÄLLEEN targetHeightUnits
    // (16 yksikköä = 1 lohko) — sama kuin tools/voxelize.mjs:ssä.
    let bbMinY = Infinity, bbMaxY = -Infinity;
    for (const b of boxes) { if (b.y0 < bbMinY) bbMinY = b.y0; if (b.y1 > bbMaxY) bbMaxY = b.y1; }
    const heightCells = bbMaxY - bbMinY + 1;
    const factor = targetHeightUnits / (heightCells * cell);
    return { boxes, cell: cell * factor, heightUnits: targetHeightUnits };
}

// ---------------- UV shelf packing (same as library autoLayoutUVs) ----------------

function packUVs(cubes, texW, texH) {
    for (let attempt = 0; attempt < 6; attempt++) {
        let y = 0, rowH = 0, x = 0, overflow = false;
        for (const c of cubes) {
            const [w, h, d] = c.size;
            const extW = 2 * d + 2 * w;
            const extH = d + h;
            if (x + extW > texW) { x = 0; y += rowH; rowH = 0; }
            if (y + extH > texH) { overflow = true; break; }
            c.uv = { offset: [Math.floor(x), Math.floor(y)] };
            x = Math.ceil(x + extW) + 1;
            rowH = Math.max(rowH, Math.ceil(extH));
        }
        if (!overflow) return { texW, texH };
        texW *= 2; texH *= 2;
    }
    return { texW, texH };
}

// ---------------- bone building + animations (ported from tools/voxelize.mjs) ----------------

function clipBoxesToPart(boxes, cells) {
    const out = [];
    for (const b of boxes) {
        let start = -1;
        for (let y = b.y0; y <= b.y1; y++) {
            const inPart = cells.has(cellKey(b.x, y, b.z));
            if (inPart && start < 0) start = y;
            if (!inPart && start >= 0) { out.push({ x: b.x, z: b.z, y0: start, y1: y - 1, color: b.color }); start = -1; }
        }
        if (start >= 0) out.push({ x: b.x, z: b.z, y0: start, y1: b.y1, color: b.color });
    }
    return out;
}

const swapSide = (n) => n.replace(/^(left|right)/, (m) => (m === 'left' ? 'right' : 'left'));

function buildVoxelModel(cfg, tris) {
    const v = voxelize(tris, cfg.heightBlocks * 16, cfg.voxel || 1);
    const res = classifyVoxelParts(v.boxes);
    const u = v.cell;
    const boxes = res.boxes;
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (const b of boxes) {
        if (b.x < mnX) mnX = b.x; if (b.x > mxX) mxX = b.x;
        if (b.y0 < mnY) mnY = b.y0; if (b.y1 > mxY) mxY = b.y1;
        if (b.z < mnZ) mnZ = b.z; if (b.z > mxZ) mxZ = b.z;
    }
    const cx = (mnX + mxX) / 2, cz = (mnZ + mxZ) / 2, bminY = mnY;
    const W = (gx, gy, gz) => [-(gx - cx) * u, (gy - bminY) * u, -(gz - cz) * u];
    const parts = res.parts;

    const bones = [];
    const allCubes = [];
    let cubeN = 0;
    const addBone = (name, parent, pivotGrid, cells) => {
        const cubes = [];
        for (const b of clipBoxesToPart(boxes, cells)) {
            const ox = (b.x - cx) * u, oz = (b.z - cz) * u, oy = (b.y0 - bminY) * u;
            const hex = '#' + b.color.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
            cubes.push({
                name: `${name}_${cubeN++}`,
                origin: [-ox, oy, -oz],
                size: [u, (b.y1 - b.y0 + 1) * u, u],
                rotation: [0, 0, 0],
                color: hex,
                uv: {},
                mirror: false
            });
        }
        allCubes.push(...cubes);
        bones.push({ name, parent, pivot: W(pivotGrid[0], pivotGrid[1], pivotGrid[2]), rotation: [0, 0, 0], cubes });
    };

    bones.push({ name: 'root', parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] });

    const wingCellsUnion = new Set();
    for (const w of parts.wings) for (const k of w.cells) wingCellsUnion.add(k);
    const hasSubWings = parts.wings.length >= 2 && wingCellsUnion.size >= 60;
    const bodyCells = hasSubWings ? parts.body : new Set([...parts.body, ...wingCellsUnion]);
    const bbb = bboxOf(bodyCells);
    addBone('body', 'root', [(bbb.mnX + bbb.mxX) / 2, (bbb.mnY + bbb.mxY) / 2, (bbb.mnZ + bbb.mxZ) / 2], bodyCells);

    const hbb = bboxOf(parts.head);
    addBone('head', 'body', [(hbb.mnX + hbb.mxX) / 2, hbb.mnY, (hbb.mnZ + hbb.mxZ) / 2], parts.head);

    const legBones = [];
    for (const leg of parts.legs) {
        const lb = bboxOf(leg.cells);
        const name = swapSide(leg.name);
        legBones.push(name);
        addBone(name, 'body', [(lb.mnX + lb.mxX) / 2, lb.mxY, (lb.mnZ + lb.mxZ) / 2], leg.cells);
    }

    const wingBones = [];
    if (hasSubWings) {
        for (const wing of parts.wings) {
            const wb = bboxOf(wing.cells);
            const name = swapSide(wing.side) + '_wing';
            let gx = (wb.mnX + wb.mxX) / 2, gz = (wb.mnZ + wb.mxZ) / 2;
            if (wing.axis === 'x') gx = wing.side === 'left' ? wb.mxX : wb.mnX;
            else gz = (wb.mnZ + wb.mxZ) / 2 < res.bodyCz ? wb.mxZ : wb.mnZ;
            wingBones.push({ name, axis: wing.axis, side: swapSide(wing.side) });
            addBone(name, 'body', [gx, (wb.mnY + wb.mxY) / 2, gz], wing.cells);
        }
    }

    let tailName = null;
    if (parts.tail.size) {
        const tb = bboxOf(parts.tail);
        const gz = (tb.mnZ + tb.mxZ) / 2 < res.bodyCz ? tb.mxZ : tb.mnZ;
        tailName = 'tail';
        addBone('tail', 'body', [(tb.mnX + tb.mxX) / 2, (tb.mnY + tb.mxY) / 2, gz], parts.tail);
    }

    // ---- animations ----
    const animations = {};
    const idle = { length: 60, tracks: {}, posTracks: {} };
    idle.tracks.body = { 0: [1.0, 0, 0], 30: [-1.0, 0, 0], 60: [1.0, 0, 0] };
    idle.tracks.head = { 0: [0, 0, 0], 15: [3, 6, 0], 30: [0, 0, 0], 45: [-3, -6, 0], 60: [0, 0, 0] };
    if (tailName) idle.tracks.tail = { 0: [0, -4, 0], 30: [0, 4, 0], 60: [0, -4, 0] };
    animations.idle = idle;

    // ---- walk: aito askellus (sama kuin tools/voxelize.mjs:ssä). Jalka on
    // maassa 60 % kierrosta (tuki, kallistus kompensoitu jalan geometrialla)
    // ja nostaa jalkaterän ilmaan 40 % (heilunta eteenpäin).
    const walk = { length: 40, tracks: {}, posTracks: {} };
    const legA = [], legB = [];
    for (const n of legBones) {
        if (/left_front|right_back/.test(n)) legA.push(n);
        else legB.push(n);
    }
    const legGeo = {};
    for (const lb of bones) {
        if (!lb.cubes.length || !/_(front|back)(_\d+)?$/.test(lb.name)) continue;
        let footMin = Infinity, zMax = 0;
        for (const c of lb.cubes) {
            footMin = Math.min(footMin, c.origin[1]);
            zMax = Math.max(zMax, Math.abs(c.origin[2] + c.size[2] / 2 - lb.pivot[2]) + c.size[2] / 2);
        }
        legGeo[lb.name] = { L: Math.max(1, lb.pivot[1] - footMin), zExt: zMax };
    }
    const SWING = 18;
    const baseFrames = [0, 12, 24, 27, 32, 36];
    const angAt = (f) => (f === 0 ? SWING : f === 12 ? 0 : f === 24 ? -SWING : f === 27 ? -SWING * 0.55 : f === 32 ? -SWING * 0.1 : SWING * 0.7);
    const dipAt = (leg, ang) => {
        const g = legGeo[leg];
        if (!g) return 0;
        const r = ang * Math.PI / 180;
        return Math.max(0, g.zExt * Math.abs(Math.sin(r)) - g.L * (1 - Math.cos(r)));
    };
    const sizeF = v.heightUnits / 32;
    const swingPeak = (leg) => Math.min(2.2, Math.max(0.5, (legGeo[leg] ? legGeo[leg].L : 6) * 0.2));
    const liftAt = (f) => (f === 24 ? 0 : f === 27 ? 0.55 : f === 32 ? 1 : f === 36 ? 0.55 : 0);
    for (const n of [...legA, ...legB]) {
        const phase = legA.includes(n) ? 0 : 20;
        walk.tracks[n] = {};
        walk.posTracks[n] = {};
        for (const f of baseFrames) {
            const kf = (f + phase) % 40;
            const ang = angAt(f);
            walk.tracks[n][kf] = [ang, 0, 0];
            walk.posTracks[n][kf] = [0, dipAt(n, ang) + liftAt(f) * swingPeak(n), 0];
        }
    }
    const bob = 0.9 * sizeF;
    walk.tracks.body = { 0: [0, 0, 0], 12: [-1.4, 0, 0], 20: [0, 0, 0], 32: [-1.4, 0, 0], 40: [0, 0, 0] };
    walk.posTracks.body = { 0: [0, 0, 0], 12: [0, bob, 0], 20: [0, 0, 0], 32: [0, bob, 0], 40: [0, 0, 0] };
    walk.tracks.head = { 0: [0, 0, 0], 12: [1.6, 0, 0], 20: [0, 0, 0], 32: [1.6, 0, 0], 40: [0, 0, 0] };
    if (tailName) walk.tracks.tail = { 0: [0, -6, 0], 20: [0, 6, 0], 40: [0, -6, 0] };
    animations.walk = walk;

    // ---- turn: kevyt käännös (sama kuin tools/voxelize.mjs:ssä)
    const turn = { length: 60, tracks: {}, posTracks: {} };
    turn.tracks.root = { 0: [0, 0, 0], 30: [0, 75, 0], 60: [0, 0, 0] };
    turn.tracks.body = { 0: [0, 0, 0], 15: [0, 0, 4], 30: [0, 0, 0], 45: [0, 0, -4], 60: [0, 0, 0] };
    turn.posTracks.body = { 0: [0, 0, 0], 15: [0, 0.5, 0], 30: [0, 0, 0], 45: [0, 0.5, 0], 60: [0, 0, 0] };
    turn.tracks.head = { 0: [0, 0, 0], 15: [0, 14, 1.5], 30: [0, 0, 0], 45: [0, -14, -1.5], 60: [0, 0, 0] };
    if (tailName) turn.tracks.tail = { 0: [0, 0, 0], 15: [0, 5, 0], 30: [0, 0, 0], 45: [0, -5, 0], 60: [0, 0, 0] };
    const TURN_FRAMES = [0, 18, 21, 24, 27, 30, 48, 51, 54, 57];
    const turnAng = (leg, f) => {
        const outside = (f >= 48 ? /^left/ : /^right/).test(leg);
        const S = outside ? 20 : 11;
        if (f === 0 || f === 30) return S;
        if (f === 18 || f === 48) return -S;
        if (f === 21 || f === 51) return -S * 0.55;
        if (f === 24 || f === 54) return -S * 0.1;
        return S * 0.7;
    };
    const turnLiftAt = (f) => ((f === 0 || f === 18 || f === 30 || f === 48) ? 0 : (f === 21 || f === 51) ? 0.55 : (f === 24 || f === 54) ? 1 : 0.55);
    let legI = 0;
    for (const n of [...legA, ...legB]) {
        const phase = (legA.length && legB.length)
            ? (legA.includes(n) ? 0 : 15)
            : ((legI % 2) * 15);
        legI++;
        turn.tracks[n] = {};
        turn.posTracks[n] = {};
        for (const f of TURN_FRAMES) {
            const kf = (f + phase) % 60;
            const ang = turnAng(n, f);
            turn.tracks[n][kf] = [ang, 0, 0];
            turn.posTracks[n][kf] = [0, dipAt(n, ang) + turnLiftAt(f) * swingPeak(n), 0];
        }
    }
    animations.turn = turn;

    if (wingBones.length >= 2) {
        // fly: lentoonlähtö + räpyttely (sama kuin tools/voxelize.mjs:ssä).
        // Jalat tekevät lentoonlähtöjuoksun (vuorottaiset askeleet) SAMALLA
        // lattia-kompensoinnilla kuin walkissa — eivät uppoa maahan. Siipien
        // alas-isku on synkronoitu jalkojen painonottoon (12/32).
        const fly = { length: 40, tracks: {}, posTracks: {} };
        for (const w of wingBones) {
            if (w.axis === 'x') {
                const s = w.side === 'left' ? -1 : 1;
                fly.tracks[w.name] = { 0: [0, 0, -s * 6], 12: [0, 0, s * 26], 20: [0, 0, 0], 32: [0, 0, -s * 26], 40: [0, 0, -s * 6] };
            } else {
                fly.tracks[w.name] = { 0: [6, 0, 0], 12: [-26, 0, 0], 20: [0, 0, 0], 32: [26, 0, 0], 40: [6, 0, 0] };
            }
        }
        fly.tracks.body = { 0: [0, 0, 0], 12: [-4, 0, 0], 20: [0, 0, 0], 32: [-4, 0, 0], 40: [0, 0, 0] };
        fly.posTracks.body = { 0: [0, 0, 0], 12: [0, 0.5, 0], 20: [0, 0, 0], 32: [0, 0.5, 0], 40: [0, 0, 0] };
        for (const n of [...legA, ...legB]) {
            const phase = legA.includes(n) ? 0 : 20;
            fly.tracks[n] = {};
            fly.posTracks[n] = {};
            for (const f of baseFrames) {
                const kf = (f + phase) % 40;
                const ang = angAt(f) * 0.8;
                fly.tracks[n][kf] = [ang, 0, 0];
                fly.posTracks[n][kf] = [0, dipAt(n, ang) + liftAt(f) * swingPeak(n) * 0.7, 0];
            }
        }
        fly.tracks.head = { 0: [0, 0, 0], 12: [5, 0, 0], 20: [0, 0, 0], 32: [5, 0, 0], 40: [0, 0, 0] };
        if (tailName) fly.tracks.tail = { 0: [0, 0, 0], 12: [0, -4, 0], 20: [0, 0, 0], 32: [0, 4, 0], 40: [0, 0, 0] };
        animations.fly = fly;
    }

    const { texW, texH } = packUVs(allCubes, 128, 128);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const c of allCubes) for (let i = 0; i < 3; i++) {
        if (c.origin[i] < mn[i]) mn[i] = c.origin[i];
        if (c.origin[i] + c.size[i] > mx[i]) mx[i] = c.origin[i] + c.size[i];
    }
    const fit = {
        center: [0, (mn[1] + mx[1]) / 2, 0],
        radius: Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2
    };
    return {
        id: cfg.id,
        name: cfg.name,
        emoji: '📦',
        description: cfg.desc,
        fit,
        model: {
            modelId: `geometry.${cfg.id}`,
            textureWidth: texW,
            textureHeight: texH,
            visibleBoundsWidth: Math.ceil(v.heightBlocks * 16 / 16) * 2,
            visibleBoundsHeight: Math.ceil(v.heightBlocks * 16 / 16) * 2,
            visibleBoundsOffset: [0, 0, 0],
            bones
        },
        animations
    };
}

// ---------------- public entry ----------------

/**
 * Voxelize dropped files (GLB or OBJ + optional MTL/texture) into a library mob.
 * @param {Map<string, ArrayBuffer>} files  name -> bytes (all dropped files)
 * @param {{name?: string, heightBlocks?: number, voxel?: number}} opts
 * @returns mob entry: { id, name, emoji, description, fit, model, animations }
 */
export async function voxelizeModel(files, opts = {}) {
    const name = (opts.name || 'MyModel').trim() || 'MyModel';
    const id = 'vox_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) + '_' + Math.random().toString(36).slice(2, 6);
    const heightBlocks = Math.max(0.5, Math.min(20, parseFloat(opts.heightBlocks) || 2));
    const voxel = [1, 2, 4].includes(parseInt(opts.voxel, 10)) ? parseInt(opts.voxel, 10) : 2;

    const entries = [...files.entries()];
    const glb = entries.find(([fn]) => fn.toLowerCase().endsWith('.glb'));
    const obj = entries.find(([fn]) => fn.toLowerCase().endsWith('.obj'));

    let tris;
    if (glb) {
        const bytes = new Uint8Array(glb[1]);
        const { json, bin } = parseGLB(bytes);
        tris = await collectTrianglesGLB(json, bin);
    } else if (obj) {
        const aux = entries.map(([fn, b]) => ({ name: fn, bytes: new Uint8Array(b) }));
        tris = await trisFromOBJ(new Uint8Array(obj[1]), aux);
    } else {
        throw new Error('No .glb or .obj file in the selection');
    }
    if (!tris.length) throw new Error('Mallissa ei ole kolmioita');

    const cfg = {
        id,
        name,
        emoji: '📦',
        desc: `Oma malli vokseloituna selaimessa (${name}) — ${tris.length.toLocaleString('fi')} kolmiota`,
        heightBlocks,
        voxel
    };
    return buildVoxelModel(cfg, tris);
}

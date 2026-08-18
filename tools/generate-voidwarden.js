/**
 * Void Warden generator — Deep Void -bossin näköinen olento: pitkä, tumma
 * luurankohumanoidi, hehkuvat valkoiset silmät ja suuret mustat siivet.
 * Generoi oman 128x128-tekstuurin (luu, hehku, musta siipikalvo) ja kirjoittaa
 * js/mobs/deepvoid.js kolmella animaatiolla: idle (leijunta), walk, attack.
 *
 * Usage: node tools/generate-voidwarden.js
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import zlib from 'zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEX_W = 128, TEX_H = 128;

// ---------------- tiny PNG encoder (8-bit RGBA) ----------------
function encodePNG(width, height, rgba) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body) >>> 0);
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const stride = width * 4 + 1;
    const raw = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        raw[y * stride] = 0;
        raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0))
    ]);
}
let crcTable = null;
function crc32(buf) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c;
        }
    }
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// ---------------- pixel canvas ----------------
const px = new Uint8Array(TEX_W * TEX_H * 4).fill(255);
function setPx(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= TEX_W || y >= TEX_H) return;
    const i = (y * TEX_W + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}
function fill(x, y, w, h, c, a = 255) {
    for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++)
            setPx(xx, yy, c[0], c[1], c[2], a);
}
function lerp(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }
function vgrad(x, y, w, h, top, bottom) {
    for (let yy = 0; yy < h; yy++)
        fill(x, y + yy, w, 1, lerp(top, bottom, h <= 1 ? 0 : yy / (h - 1)));
}
function rand(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function noise(x, y, w, h, c, amt, seed) {
    const r = rand(seed);
    for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++)
            if (r() < amt) setPx(xx, yy, c[0], c[1], c[2]);
}
function tatter(x, y, w, h, prob, seed) {
    const r = rand(seed);
    for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++)
            if (r() < prob) setPx(xx, yy, 0, 0, 0, 0);
}
function vline(x, y, h, c) { fill(x, y, 1, h, c); }
function hline(x, y, w, c) { fill(x, y, w, 1, c); }
function rect(x, y, w, h, c) {
    hline(x, y, w, c); hline(x, y + h - 1, w, c);
    vline(x, y, h, c); vline(x + w - 1, y, h, c);
}

// ---------------- box UV rects (mirror of js/utils/boxuv.js) ----------------
function rectsOf(size, offset) {
    const [w, h, d] = size;
    const [u0, v0] = offset;
    return {
        east:  { x: u0,             y: v0 + d,     w: d, h: h },
        up:    { x: u0 + d,         y: v0,         w: w, h: d },
        north: { x: u0 + d,         y: v0 + d,     w: w, h: h },
        down:  { x: u0 + d + w,     y: v0,         w: w, h: d },
        west:  { x: u0 + d + w,     y: v0 + d,     w: d, h: h },
        south: { x: u0 + 2 * d + w, y: v0 + d,     w: w, h: h }
    };
}

// ---------------- palette (Deep Void -bossi) ----------------
const C = {
    boneLight:  [236, 231, 222],
    bone:       [208, 200, 188],
    boneDark:   [134, 124, 112],
    boneDeep:   [76, 68, 58],
    voidBlack:  [9, 7, 15],
    robeDark:   [18, 13, 30],
    robeMid:    [34, 25, 50],
    robeLight:  [54, 40, 78],
    glowWhite:  [244, 250, 255],
    glowCyan:   [150, 224, 255],
    glowDeep:   [44, 120, 180],
    wingBlack:  [12, 12, 20],
    wingDark:   [5, 5, 9],
    vein:       [66, 56, 88]
};

// ---------------- model definition ----------------
// Each cube: bone, name, origin, size, rotation, drawer key.
const cubeDefs = [];

function cube(bone, name, origin, size, rotation, draw) {
    cubeDefs.push({ bone, name, origin, size, rotation, draw });
}

// ---- root: lantio, selkäranka, kylkiluut, riekaleinen viitta
cube('root', 'pelvis',   [-3, 10, -2], [6, 4, 4],   [0, 0, 0], 'bone');
cube('root', 'spine',    [-1, 14, -1], [2, 26, 2],  [0, 0, 0], 'bone');
cube('root', 'rib_l_1',  [-4, 18, -2], [3, 1, 1],   [0, 0, 0], 'rib');
cube('root', 'rib_r_1',  [1, 18, -2],  [3, 1, 1],   [0, 0, 0], 'rib');
cube('root', 'rib_l_2',  [-4, 22, -2], [3, 1, 1],   [0, 0, 0], 'rib');
cube('root', 'rib_r_2',  [1, 22, -2],  [3, 1, 1],   [0, 0, 0], 'rib');
cube('root', 'rib_l_3',  [-4, 26, -2], [3, 1, 1],   [0, 0, 0], 'rib');
cube('root', 'rib_r_3',  [1, 26, -2],  [3, 1, 1],   [0, 0, 0], 'rib');
cube('root', 'core',     [-1, 22, -3], [2, 2, 1],   [0, 0, 0], 'core');
cube('root', 'robe_l',   [-5, 4, -1],  [1, 9, 2],   [0, 0, 0], 'robe');
cube('root', 'robe_r',   [4, 4, -1],   [1, 9, 2],   [0, 0, 0], 'robe');
cube('root', 'robe_b',   [-2, 3, -2],  [4, 2, 1],   [0, 0, 0], 'robe');

// ---- head: paljas kallo, hehkuvat silmät
cube('head', 'skull',  [-3, 44, -3], [6, 6, 6], [0, 0, 0], 'skull');
cube('head', 'jaw',    [-2, 42, -3], [4, 2, 4], [0, 0, 0], 'bone');
cube('head', 'eye_l',  [-4, 46, -4], [1, 1, 1], [0, 0, 0], 'eye');
cube('head', 'eye_r',  [3, 46, -4],  [1, 1, 1], [0, 0, 0], 'eye');

// ---- arms: pitkät luurankokädet ja kynnet
cube('left_arm',  'upper_l',   [-7, 30, -1.5], [3, 10, 3], [0, 0, 0], 'bone');
cube('left_arm',  'forearm_l', [-7, 22, -1.5], [2, 9, 2],  [0, 0, 0], 'bone');
cube('left_arm',  'claw_l',    [-7, 19, -1.5], [2, 4, 2],  [0, 0, 0], 'claw');
cube('right_arm', 'upper_r',   [4, 30, -1.5],  [3, 10, 3], [0, 0, 0], 'bone');
cube('right_arm', 'forearm_r', [4, 22, -1.5],  [2, 9, 2],  [0, 0, 0], 'bone');
cube('right_arm', 'claw_r',    [4, 19, -1.5],  [2, 4, 2],  [0, 0, 0], 'claw');

// ---- legs: pitkät luut ja kynsijalat
cube('left_leg',  'femur_l', [-4, 4, -1.5], [3, 9, 3], [0, 0, 0], 'bone');
cube('left_leg',  'tibia_l', [-4, -2, -1.5], [2, 7, 2], [0, 0, 0], 'bone');
cube('left_leg',  'foot_l',  [-4, -4, -3],  [3, 2, 4], [0, 0, 0], 'claw');
cube('right_leg', 'femur_r', [1, 4, -1.5],  [3, 9, 3], [0, 0, 0], 'bone');
cube('right_leg', 'tibia_r', [1, -2, -1.5], [2, 7, 2], [0, 0, 0], 'bone');
cube('right_leg', 'foot_r',  [1, -4, -3],   [3, 2, 4], [0, 0, 0], 'claw');

// ---- wings: suuret mustat siivet (kalvo + luuvarsi)
cube('left_wing',  'wing_arm_l', [-11, 38, -1], [7, 2, 1],  [0, 0, 10],  'wingArm');
cube('left_wing',  'wing_web_l', [-15, 26, -1], [13, 16, 1], [0, 0, 0],   'wingWeb');
cube('right_wing', 'wing_arm_r', [4, 38, -1],   [7, 2, 1],  [0, 0, -10], 'wingArm');
cube('right_wing', 'wing_web_r', [2, 26, -1],   [13, 16, 1], [0, 0, 0],  'wingWeb');

// ---- back spines
cube('spines', 'spine_1', [-1, 32, 2], [2, 4, 2], [-15, 0, 0], 'bone');
cube('spines', 'spine_2', [-1, 27, 2], [2, 4, 2], [-20, 0, 0], 'bone');
cube('spines', 'spine_3', [-1, 22, 2], [2, 4, 2], [-25, 0, 0], 'bone');

// ---------------- texture drawing ----------------
function drawBone(r) {
    for (const f of ['north', 'south']) {
        vgrad(r[f].x, r[f].y, r[f].w, r[f].h, C.boneLight, C.boneDark);
        // nivelraita
        hline(r[f].x, r[f].y + Math.floor(r[f].h / 3), r[f].w, C.boneDeep);
        hline(r[f].x, r[f].y + Math.floor((r[f].h * 2) / 3), r[f].w, C.boneDeep);
        noise(r[f].x, r[f].y, r[f].w, r[f].h, C.boneDeep, 0.12, 7);
    }
    for (const f of ['east', 'west']) {
        vgrad(r[f].x, r[f].y, r[f].w, r[f].h, C.bone, C.boneDark);
    }
    vgrad(r.up.x, r.up.y, r.up.w, r.up.h, C.boneLight, C.bone);
    fill(r.down.x, r.down.y, r.down.w, r.down.h, C.boneDeep);
}

function drawRib(r) {
    fill(r.north.x, r.north.y, r.north.w, r.north.h, C.bone);
    hline(r.north.x, r.north.y, r.north.w, C.boneLight);
    hline(r.north.x, r.north.y + r.north.h - 1, r.north.w, C.boneDeep);
    fill(r.south.x, r.south.y, r.south.w, r.south.h, C.boneDark);
    for (const f of ['east', 'west', 'up', 'down']) fill(r[f].x, r[f].y, r[f].w, r[f].h, C.boneDeep);
}

function drawSkull(r) {
    vgrad(r.north.x, r.north.y, r.north.w, r.north.h, C.boneLight, C.boneDark);
    // hehkuvat silmäkuopat — tumma kuoppa, valkoinen hehku + syaanikehä
    fill(r.north.x + 1, r.north.y + 1, 2, 2, C.boneDeep);
    fill(r.north.x + 3, r.north.y + 1, 2, 2, C.boneDeep);
    fill(r.north.x + 1, r.north.y + 1, 2, 2, C.glowWhite);
    fill(r.north.x + 3, r.north.y + 1, 2, 2, C.glowWhite);
    setPx(r.north.x + 1, r.north.y + 1, C.glowCyan[0], C.glowCyan[1], C.glowCyan[2]);
    setPx(r.north.x + 4, r.north.y + 1, C.glowCyan[0], C.glowCyan[1], C.glowCyan[2]);
    // nenäontelo ja halkeamat
    fill(r.north.x + 2, r.north.y + 3, 2, 2, C.boneDeep);
    vline(r.north.x + 1, r.north.y + 4, 2, C.boneDeep);
    vline(r.north.x + 4, r.north.y + 3, 3, C.boneDeep);
    // hammasraita
    hline(r.north.x, r.north.y + r.north.h - 1, r.north.w, C.boneLight);
    for (const f of ['east', 'west']) {
        vgrad(r[f].x, r[f].y, r[f].w, r[f].h, C.bone, C.boneDark);
        vline(r[f].x + 2, r[f].y + 1, r[f].h - 2, C.boneDeep);
        noise(r[f].x, r[f].y, r[f].w, r[f].h, C.boneDeep, 0.12, 8);
    }
    vgrad(r.up.x, r.up.y, r.up.w, r.up.h, C.boneLight, C.bone);
    fill(r.down.x, r.down.y, r.down.w, r.down.h, C.boneDeep);
    vgrad(r.south.x, r.south.y, r.south.w, r.south.h, C.bone, C.boneDark);
    noise(r.south.x, r.south.y, r.south.w, r.south.h, C.boneDeep, 0.15, 9);
}

function drawEye(r) {
    for (const f of Object.keys(r)) {
        fill(r[f].x, r[f].y, r[f].w, r[f].h, C.glowWhite);
    }
    fill(r.north.x, r.north.y, r.north.w, r.north.h, C.glowCyan);
    setPx(r.north.x, r.north.y, 255, 255, 255);
}

function drawCore(r) {
    for (const f of Object.keys(r)) {
        vgrad(r[f].x, r[f].y, r[f].w, r[f].h, C.glowWhite, C.glowCyan);
        rect(r[f].x, r[f].y, r[f].w, r[f].h, C.glowDeep);
    }
    fill(r.north.x + 1, r.north.y + 1, 2, 2, [255, 255, 255]);
}

function drawClaw(r) {
    vgrad(r.north.x, r.north.y, r.north.w, r.north.h, C.boneDark, C.boneDeep);
    vline(r.north.x + 1, r.north.y, r.north.h, C.boneDeep);
    hline(r.north.x, r.north.y + r.north.h - 1, r.north.w, [30, 26, 22]);
    for (const f of ['south', 'east', 'west', 'up', 'down']) fill(r[f].x, r[f].y, r[f].w, r[f].h, C.boneDeep);
}

function drawRobe(r) {
    for (const f of ['north', 'south']) {
        vgrad(r[f].x, r[f].y, r[f].w, r[f].h, C.robeMid, C.robeDark);
        noise(r[f].x, r[f].y, r[f].w, r[f].h, C.robeLight, 0.1, 11);
        tatter(r[f].x, r[f].y + r[f].h - 3, r[f].w, 3, 0.3, 12);
    }
    for (const f of ['east', 'west', 'up', 'down']) fill(r[f].x, r[f].y, r[f].w, r[f].h, C.robeDark);
}

function drawWingArm(r) {
    for (const f of ['north', 'south']) {
        vgrad(r[f].x, r[f].y, r[f].w, r[f].h, C.vein, C.wingBlack);
        hline(r[f].x, r[f].y, r[f].w, C.boneDark);
        hline(r[f].x, r[f].y + r[f].h - 1, r[f].w, C.wingDark);
    }
    for (const f of ['east', 'west', 'up', 'down']) fill(r[f].x, r[f].y, r[f].w, r[f].h, C.wingDark);
}

function drawWingWeb(r) {
    for (const f of ['north', 'south']) {
        vgrad(r[f].x, r[f].y, r[f].w, r[f].h, C.wingBlack, C.wingDark);
        // kalvon suonet: vinot viivat yläreunasta
        const veinSeed = 13;
        const rr = rand(veinSeed);
        for (let i = 0; i < Math.floor(r[f].w / 3); i++) {
            const vx = r[f].x + Math.floor(rr() * r[f].w);
            const len = 3 + Math.floor(rr() * Math.max(4, r[f].h - 4));
            for (let yy = 0; yy < len; yy++) {
                const sway = Math.sin(yy * 0.9) * 1;
                setPx(vx + sway, r[f].y + yy, C.vein[0], C.vein[1], C.vein[2]);
            }
        }
        // rikkinäinen kalvon reuna
        tatter(r[f].x, r[f].y + r[f].h - 2, r[f].w, 2, 0.28, 14);
        tatter(r[f].x, r[f].y, r[f].w, 1, 0.2, 15);
    }
    for (const f of ['east', 'west']) fill(r[f].x, r[f].y, r[f].w, r[f].h, C.wingDark);
    fill(r.up.x, r.up.y, r.up.w, r.up.h, C.wingDark);
    fill(r.down.x, r.down.y, r.down.w, r.down.h, C.wingBlack);
}

// ---------------- UV packing (shelf packer) ----------------
function packOffsets(defs, texW, texH) {
    for (let attempt = 0; attempt < 6; attempt++) {
        let y = 0, rowH = 0, x = 0, ok = true;
        const offsets = [];
        for (const d of defs) {
            const [w, h, dep] = d.size;
            const extW = 2 * dep + 2 * w;
            const extH = dep + h;
            if (x + extW > texW) { x = 0; y += rowH; rowH = 0; }
            if (y + extH > texH) { ok = false; break; }
            offsets.push([x, y]);
            x += extW;
            rowH = Math.max(rowH, extH);
        }
        if (ok) return offsets;
        texW *= 2; texH *= 2;
    }
    throw new Error('UV packing failed');
}

// ---------------- build model ----------------
const offsets = packOffsets(cubeDefs, TEX_W, TEX_H);
const bones = new Map();
cubeDefs.forEach((d, i) => {
    if (!bones.has(d.bone)) bones.set(d.bone, []);
    bones.get(d.bone).push({ d, offset: offsets[i] });
});

const model = {
    modelId: 'geometry.void_warden',
    textureWidth: TEX_W,
    textureHeight: TEX_H,
    visibleBoundsWidth: 3.5,
    visibleBoundsHeight: 3.5,
    visibleBoundsOffset: [0, 1.5, 0],
    bones: []
};
const PIVOTS = {
    root: [0, 0, 0],
    head: [0, 44, 0],
    left_arm: [-5, 40, 0],
    right_arm: [5, 40, 0],
    left_leg: [-2.5, 12, 0],
    right_leg: [2.5, 12, 0],
    left_wing: [-5, 40, 0],
    right_wing: [5, 40, 0],
    spines: [0, 34, 3]
};
const DRAWERS = {
    bone: drawBone, rib: drawRib, skull: drawSkull, eye: drawEye,
    core: drawCore, claw: drawClaw, robe: drawRobe,
    wingArm: drawWingArm, wingWeb: drawWingWeb
};
for (const [boneName, items] of bones) {
    const cubes = items.map(({ d, offset }) => {
        DRAWERS[d.draw](rectsOf(d.size, offset));
        return {
            name: d.name,
            origin: d.origin,
            size: d.size,
            rotation: d.rotation,
            uv: { offset },
            mirror: false
        };
    });
    model.bones.push({
        name: boneName,
        pivot: PIVOTS[boneName] || [0, 0, 0],
        rotation: [0, 0, 0],
        cubes
    });
}

// ---------------- animations ----------------
function keyed(pairs) {
    const tracks = {};
    for (const [bone, frames] of pairs) tracks[bone] = frames;
    return tracks;
}

const animations = {
    idle: {
        loop: true,
        length: 80,
        tracks: keyed([
            ['root', { 0: [2, 0, 0], 40: [-2, 0, 0], 80: [2, 0, 0] }],
            ['head', { 0: [0, 12, 0], 20: [0, -12, 0], 40: [0, 12, 0], 60: [0, -12, 0], 80: [0, 12, 0] }],
            // Kädet hengittävät X-akselilla samassa vaiheessa (ei Z-heiluntaa)
            ['left_arm', { 0: [-5, 0, 0], 20: [5, 0, 0], 40: [-5, 0, 0], 60: [5, 0, 0], 80: [-5, 0, 0] }],
            ['right_arm', { 0: [-5, 0, 0], 20: [5, 0, 0], 40: [-5, 0, 0], 60: [5, 0, 0], 80: [-5, 0, 0] }],
            ['left_leg', { 0: [0, 0, 3], 40: [0, 0, -3], 80: [0, 0, 3] }],
            ['right_leg', { 0: [0, 0, -3], 40: [0, 0, 3], 80: [0, 0, -3] }],
            // Siivet lepattavat hitaasti (Z = lepatus)
            ['left_wing', { 0: [0, 0, 6], 20: [0, 0, -6], 40: [0, 0, 6], 60: [0, 0, -6], 80: [0, 0, 6] }],
            ['right_wing', { 0: [0, 0, -6], 20: [0, 0, 6], 40: [0, 0, -6], 60: [0, 0, 6], 80: [0, 0, -6] }],
            ['spines', { 0: [-14, 0, 0], 40: [-20, 0, 0], 80: [-14, 0, 0] }]
        ])
    },
    walk: {
        loop: true,
        length: 40,
        tracks: keyed([
            ['root', { 0: [7, 0, 0], 20: [4, 0, 0], 40: [7, 0, 0] }],
            ['head', { 0: [6, 0, 0], 10: [-2, 0, 0], 20: [6, 0, 0], 30: [-2, 0, 0], 40: [6, 0, 0] }],
            ['left_arm', { 0: [20, 0, 0], 10: [-18, 0, 0], 20: [20, 0, 0], 30: [-18, 0, 0], 40: [20, 0, 0] }],
            ['right_arm', { 0: [-18, 0, 0], 10: [20, 0, 0], 20: [-18, 0, 0], 30: [20, 0, 0], 40: [-18, 0, 0] }],
            ['left_leg', { 0: [26, 0, 0], 10: [-26, 0, 0], 20: [26, 0, 0], 30: [-26, 0, 0], 40: [26, 0, 0] }],
            ['right_leg', { 0: [-26, 0, 0], 10: [26, 0, 0], 20: [-26, 0, 0], 30: [26, 0, 0], 40: [-26, 0, 0] }],
            ['left_wing', { 0: [0, 0, 8], 10: [0, 0, -8], 20: [0, 0, 8], 30: [0, 0, -8], 40: [0, 0, 8] }],
            ['right_wing', { 0: [0, 0, -8], 10: [0, 0, 8], 20: [0, 0, -8], 30: [0, 0, 8], 40: [0, 0, -8] }],
            ['spines', { 0: [-16, 0, 0], 20: [-22, 0, 0], 40: [-16, 0, 0] }]
        ])
    },
    attack: {
        loop: false,
        length: 36,
        tracks: keyed([
            ['root', { 0: [0, 0, 0], 8: [-6, 0, 0], 16: [14, 0, 0], 24: [-4, 0, 0], 36: [0, 0, 0] }],
            ['head', { 0: [0, 0, 0], 8: [5, 0, 0], 16: [-16, 0, 0], 24: [5, 0, 0], 36: [0, 0, 0] }],
            ['right_arm', { 0: [10, 0, 0], 8: [-80, 0, 0], 16: [70, 0, 0], 24: [-20, 0, 0], 36: [10, 0, 0] }],
            ['left_arm', { 0: [0, 0, 0], 8: [25, 0, 0], 16: [-45, 0, 0], 24: [10, 0, 0], 36: [0, 0, 0] }],
            ['left_leg', { 0: [0, 0, 0], 16: [8, 0, 0], 36: [0, 0, 0] }],
            ['right_leg', { 0: [0, 0, 0], 16: [-10, 0, 0], 36: [0, 0, 0] }],
            // Suuri siiveniskaus hyökkäyksen mukana
            ['left_wing', { 0: [0, 0, 0], 8: [0, 0, 35], 16: [0, 0, -25], 24: [0, 0, 10], 36: [0, 0, 0] }],
            ['right_wing', { 0: [0, 0, 0], 8: [0, 0, -35], 16: [0, 0, 25], 24: [0, 0, -10], 36: [0, 0, 0] }],
            ['spines', { 0: [-14, 0, 0], 16: [-25, 0, 0], 36: [-14, 0, 0] }]
        ])
    }
};

// ---------------- output ----------------
const png = encodePNG(TEX_W, TEX_H, px);
const textureDataURL = 'data:image/png;base64,' + png.toString('base64');

const out = `/**
 * GENERATED by tools/generate-voidwarden.js — do not edit by hand.
 * Void Warden — Deep Void -bossin näköinen olento: pitkä luurankohumanoidi,
 * hehkuvat valkoiset silmät ja suuret mustat siivet. Kolme animaatiota:
 * idle (leijunta), walk (raskas kävely), attack (siivenisku + kynsisivalaisku).
 * Re-generate: node tools/generate-voidwarden.js
 */
export const DEEP_VOID_MOBS = [
    {
        id: 'void_warden',
        name: 'Void Warden',
        emoji: '🕳️',
        description: 'Deep Void -bossin näköinen: pitkä luurankohumanoidi, hehkuvat silmät ja suuret mustat siivet — idle/walk/attack-animaatioilla',
        model: ${JSON.stringify(model, null, 4)},
        textureDataURL: '${textureDataURL}',
        animation: ${JSON.stringify(animations.idle)},
        animations: ${JSON.stringify(animations, null, 4)}
    }
];
`;

writeFileSync(path.join(root, 'js/mobs/deepvoid.js'), out);
console.log('✅ js/mobs/deepvoid.js written (' + (out.length / 1024).toFixed(1) + ' KB)');
console.log('   cubes: ' + cubeDefs.length + ', bones: ' + model.bones.length + ', texture: ' + TEX_W + 'x' + TEX_H);

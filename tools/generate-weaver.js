/**
 * Weaver of Souls — The Deep Void -bossin OIKEA malli, tekstuuri ja animaatiot.
 *
 * Lähde: The Deep Void -modin (MIT-lisenssi) JARista puretut assetit
 *   assets/deepvoid/*.geo.json  — oikea Bedrock-geometria (GeckoLib)
 *   assets/deepvoid/*.png       — oikeat tekstuurit (+ glow-kerros)
 *   assets/deepvoid/*.animation.json — oikeat animaatiot (vector-keyframeja)
 *
 * Tämä generaattori ei keksi mitään: se kopioi pelin assetit sellaisinaan
 * (skaalattuna ja jalkoihin siirrettynä) editorin mob-formaattiin.
 *
 * Usage: node tools/generate-weaver.js
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import zlib from 'zlib';
import * as THREE from 'three';
import { parseBedrockGeometry } from '../js/formats/bedrock.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCALE = 0.1; // pelin boss on ~90 lohkoa raakadatassa → sopiva boss-koko

// ---------------- PNG decode (RGBA) ----------------
function decodePNG(buf) {
    let pos = 8; // signature
    let width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idat = [];
    const readU32 = () => { const v = buf.readUInt32BE(pos); pos += 4; return v; };
    while (pos < buf.length) {
        const len = readU32();
        const type = buf.toString('ascii', pos, pos + 4);
        pos += 4;
        const data = buf.subarray(pos, pos + len);
        pos += len + 4; // skip CRC
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') break;
    }
    if (colorType !== 6) throw new Error('Only RGBA PNG supported (colorType ' + colorType + ')');

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const px = Buffer.alloc(width * height * 4);
    // unfilter
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= 4 ? out[x - 4] : 0;
            const b = prev[x];
            const c = x >= 4 ? prev[x - 4] : 0;
            let v = line[x];
            switch (filter) {
                case 0: break;
                case 1: v = (v + a) & 0xff; break;
                case 2: v = (v + b) & 0xff; break;
                case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
                    break;
                }
                default: throw new Error('bad filter ' + filter);
            }
            out[x] = v;
        }
        out.copy(px, y * stride);
        prev = out;
    }
    return { width, height, px };
}

// ---------------- PNG encode (RGBA) ----------------
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
        rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
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

// ---------------- geometry ----------------
function loadModel(geoFile, modelId) {
    const json = JSON.parse(readFileSync(path.join(root, 'assets/deepvoid', geoFile), 'utf8'));
    const model = parseBedrockGeometry(json);
    model.modelId = modelId;
    return model;
}

function prepareModel(model) {
    // Skaalaa ja siirrä jalat tasoon y=0 (pelin koordinaatit → editori).
    // HUOM: UV-rectit on piirretty alkuperäisellä kuutiokoolla, joten
    // alkuperäinen koko säilytetään uvSize-kentässä (boxuv.js käyttää sitä).
    for (const bone of model.bones) {
        bone.pivot = bone.pivot.map(v => v * SCALE);
        for (const cube of bone.cubes) {
            cube.uvSize = cube.size.slice();
            cube.origin = cube.origin.map(v => v * SCALE);
            cube.size = cube.size.map(v => v * SCALE);
        }
    }
    let minY = Infinity, maxY = -Infinity;
    for (const bone of model.bones)
        for (const cube of bone.cubes) {
            minY = Math.min(minY, cube.origin[1]);
            maxY = Math.max(maxY, cube.origin[1] + cube.size[1]);
        }
    for (const bone of model.bones) {
        bone.pivot[1] -= minY;
        for (const cube of bone.cubes) cube.origin[1] -= minY;
    }
    model.visibleBoundsWidth = model.visibleBoundsWidth * SCALE;
    model.visibleBoundsHeight = (maxY - minY) * SCALE;
    model.visibleBoundsOffset = [0, (maxY - minY) * SCALE / 2, 0];
    return model;
}

// ---------------- animations ----------------
function convertKeys(keys) {
    const out = {};
    const entries = Object.entries(keys || {});
    if (entries.length === 1 && entries[0][0] === 'vector') {
        // Vakio-shorthand: {"vector": [...]} → sama arvo kaikilla framella
        out[0] = entries[0][1].map(v => Math.round(v * 1000) / 1000);
        return out;
    }
    for (const [t, v] of entries) {
        if (!v || !Array.isArray(v.vector)) continue; // Molang-kaavat ohitetaan
        const frame = Math.round(parseFloat(t) * 20);
        out[frame] = v.vector.map(x => Math.round(x * 1000) / 1000);
    }
    return out;
}

function convertAnimation(animJson) {
    const tracks = {}, posTracks = {};
    for (const [bone, data] of Object.entries(animJson.bones || {})) {
        if (data.rotation) tracks[bone] = convertKeys(data.rotation);
        if (data.position) posTracks[bone] = convertKeys(data.position);
    }
    // Positiot skaalataan samoin kuin geometria (raaka-arvot × SCALE)
    for (const bone of Object.keys(posTracks)) {
        for (const f of Object.keys(posTracks[bone])) {
            posTracks[bone][f] = posTracks[bone][f].map(v => v * SCALE);
        }
    }
    return {
        length: Math.round((animJson.animation_length || 1) * 20),
        tracks,
        posTracks
    };
}

// ---------------- kamera-sovitus (lasketaan generaattorissa) ----------------
const _euler = new THREE.Euler();
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
function eulerMat(r) {
    // Sama konventio kuin editorissa: THREE.Euler 'ZYX' (Bedrock/GeckoLib).
    _euler.set(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180, 'ZYX');
    _m4.makeRotationFromEuler(_euler);
    return _m4.elements.slice(0, 9); // 3x3 osa (row-major)
}
function mulVec(m, v) {
    _v3.set(v[0], v[1], v[2]).applyMatrix3(new THREE.Matrix3().fromArray(m));
    return [_v3.x, _v3.y, _v3.z];
}
function mulMat(a, b) {
    const r = new THREE.Matrix3().fromArray(a).multiply(new THREE.Matrix3().fromArray(b));
    return r.toArray().slice(0, 9);
}

/**
 * Kamera-sovitus lasketaan HIERARKKISESTI (luu vanhempansa sisällä),
 * samalla logiikalla kuin editorin renderöinti: lapsen pivot siirtyy
 * vanhemman rotaation mukana, ja positiotrackit ovat vanhemman avaruudessa.
 * GeckoLib-mobeilla animaatiorotaatio on additiivinen rest-rotaatioon.
 */
function computeFit(model, anim) {
    const byName = new Map(model.bones.map(b => [b.name, b]));
    const cache = new Map();
    const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    function worldOf(bone) {
        if (cache.has(bone.name)) return cache.get(bone.name);
        const pos = (anim.posTracks && anim.posTracks[bone.name] && anim.posTracks[bone.name][0]) || [0, 0, 0];
        const kf = (anim.tracks && anim.tracks[bone.name] && anim.tracks[bone.name][0]) || [0, 0, 0];
        const rot = model.additiveRotation
            ? [bone.rotation[0] + kf[0], bone.rotation[1] + kf[1], bone.rotation[2] + kf[2]]
            : kf;
        const m = eulerMat(rot);
        const parent = bone.parent ? byName.get(bone.parent) : null;
        let pw = [0, 0, 0], pm = ID;
        if (parent) {
            const w = worldOf(parent);
            pw = w.pivot;
            pm = w.rot;
        }
        const pp = parent ? parent.pivot : [0, 0, 0];
        // Lapsen paikallinen offset (pivot − parentPivot) + positiotrack,
        // sitten vanhemman rotaatio kohdistaa sen maailmaan.
        const local = [
            (bone.pivot[0] - pp[0]) + pos[0],
            (bone.pivot[1] - pp[1]) + pos[1],
            (bone.pivot[2] - pp[2]) + pos[2]
        ];
        const off = mulVec(pm, local);
        const w = { pivot: [pw[0] + off[0], pw[1] + off[1], pw[2] + off[2]], rot: mulMat(pm, m) };
        cache.set(bone.name, w);
        return w;
    }

    const pts = [];
    for (const bone of model.bones) {
        const w = worldOf(bone);
        for (const c of bone.cubes) {
            for (let i = 0; i < 8; i++) {
                const corner = [
                    c.origin[0] + (i & 1 ? c.size[0] : 0),
                    c.origin[1] + (i & 2 ? c.size[1] : 0),
                    c.origin[2] + (i & 4 ? c.size[2] : 0)
                ];
                const rel = mulVec(w.rot, [corner[0] - bone.pivot[0], corner[1] - bone.pivot[1], corner[2] - bone.pivot[2]]);
                pts.push([w.pivot[0] + rel[0], w.pivot[1] + rel[1], w.pivot[2] + rel[2]]);
            }
        }
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const pt of pts) for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], pt[i]);
        max[i] = Math.max(max[i], pt[i]);
    }
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    return { center: center.map(v => Math.round(v * 100) / 100), radius: Math.round(radius * 100) / 100 };
}

// ---------------- texture + glow ----------------
function loadTexture(pngFile) {
    const { width, height, px } = decodePNG(readFileSync(path.join(root, 'assets/deepvoid', pngFile)));
    return { width, height, px };
}

/**
 * Emissiivinen tekstuuri glow-kerroksesta (pelin oma overlay): glow-pikselit
 * (alfa ≥ 8) kopioidaan sellaisinaan, kaikki muu on mustaa. Pohjatekstuuri
 * pysyy PUHTAANA pelin PNG:nä — aivan kuten peli renderöi: pohja + hehkuva
 * kerros päällä. Editorin materiaali hehkuttaa emissiivisen kartan valosta
 * riippumatta (MeshStandardMaterial emissiveMap).
 */
function makeEmissive(glow) {
    const px = Buffer.from(glow.px); // kopio
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 8) {
            px[i] = px[i + 1] = px[i + 2] = 0;
        }
        px[i + 3] = 255; // peittävä musta tausta — emissiivinen kartta ei käytä alfa-kanavaa
    }
    return { width: glow.width, height: glow.height, px };
}

/**
 * Johda emissiivinen kartta POHJATEKSTUURIN kirkkaista pikseleistä
 * (luminanssi ≥ 0.75). Käytetään vain mobeille, joilla EI ole omaa
 * glow-kerrosta pelissä (esim. False Hydra): sen hehkuvat silmät ovat
 * valmiiksi valkoisina pohjatekstuurissa (varmistettu pikselianalyysillä —
 * 51 kirkasta pikseliä yhdessä silmäalueessa), ja peli renderöi ne
 * normaaleina kirkkaina pikseleinä. Emissiivisyys saa ne hohtamaan kuten
 * pelissä koetaan.
 */
function deriveEmissive(base, threshold = 0.75) {
    const px = Buffer.alloc(base.px.length);
    for (let i = 0; i < base.px.length; i += 4) {
        const r = base.px[i], g = base.px[i + 1], b = base.px[i + 2], a = base.px[i + 3];
        const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        if (lum >= threshold && a > 128) {
            px[i] = r; px[i + 1] = g; px[i + 2] = b;
        }
        px[i + 3] = 255;
    }
    return { width: base.width, height: base.height, px };
}

function textureDataURL(png) {
    return 'data:image/png;base64,' + encodePNG(png.width, png.height, png.px).toString('base64');
}

// ---------------- mob builders ----------------
function buildMob({ geoFile, modelId, pngFile, glowFile, animFile, id, name, emoji, description, defaultAnim, emissiveFromBase }) {
    const model = prepareModel(loadModel(geoFile, modelId));
    // GeckoLib (modin renderöijä) lisää animaatiorotaation GEOMETRIAN
    // rest-rotaatioon (initialSnapshot + keyframe) — ei korvaa sitä.
    // Useilla luilla (skeletonBody 90°, kynnet ±5–10°) on nollasta poikkeava
    // rest, joten tämä on välttämätöntä oikean asennon kannalta.
    model.additiveRotation = true;
    // Modin UV-pakkaus on ORIGINAALIA (päällekkäisyydet ja läpinäkyvät
    // koristeet ovat osa alkuperäistä dataa) — UV-varmentaja tarkistaa näille
    // vain rajat, tekstuurikoon ja naaman (ei overlap/läpinäkyvyysvirheitä).
    model.uvRelaxed = true;
    const base = loadTexture(pngFile);
    // Emissiivinen kartta: pelin oma glow-kerros (tai johdettu kirkkaista
    // pikseleistä, jos mobilla ei ole omaa kerrosta). Pohja pysyy puhtaana.
    let emissive = null;
    if (glowFile) emissive = makeEmissive(loadTexture(glowFile));
    else if (emissiveFromBase) emissive = deriveEmissive(base);
    const animJson = JSON.parse(readFileSync(path.join(root, 'assets/deepvoid', animFile), 'utf8')).animations;
    const animations = {};
    for (const [key, value] of Object.entries(animJson)) {
        const short = key.split('_').slice(1).join('_') || key;
        animations[short] = convertAnimation(value);
    }
    const idle = (defaultAnim && animations[defaultAnim]) || animations.idle || Object.values(animations)[0];
    const fit = computeFit(model, idle);
    return {
        id,
        name,
        emoji,
        description,
        model,
        textureDataURL: textureDataURL(base),
        emissiveDataURL: emissive ? textureDataURL(emissive) : null,
        animation: idle,
        animations,
        fit
    };
}

const fallen = buildMob({
    geoFile: 'fallenweaver.geo.json',
    modelId: 'geometry.weaver_of_souls',
    pngFile: 'fallenweaver.png',
    glowFile: 'fallen_weaver_glow.png',
    animFile: 'fallenweaver.animation.json',
    id: 'weaver_of_souls',
    name: 'Weaver of Souls',
    emoji: '🧵',
    description: 'Deep Voidin oikea pääbossi — oikea malli, tekstuuri ja animaatiot (MIT-lisenssi, The Deep Void -modista)'
});

const chained = buildMob({
    geoFile: 'chainedweaver.geo.json',
    modelId: 'geometry.chained_weaver',
    pngFile: 'chainedweaver.png',
    glowFile: null,
    animFile: 'chainedweaver.animation.json',
    id: 'chained_weaver',
    name: 'Chained Weaver',
    emoji: '⛓️',
    description: 'Weaver Of Souls kahlittuna Sepulcheriin — roikkuu kahleissa (9 osumaa rikkoo kahleet)'
});

// Deep Voidin ikoninen Stalker — sama hahmo kuin modin README/kuvituksessa:
// pitkä, tumma luurankomainen humanoidi, hehkuvat valkoiset silmät ja
// levitetyt (siipimäiset) raajat. Oikeat assetit modin JARista.
const stalker = buildMob({
    geoFile: 'stalker.geo.json',
    modelId: 'geometry.stalker_animated',
    pngFile: 'stalker_animated.png',
    glowFile: 'stalker_animated_eyes.png',
    animFile: 'stalker.animation.json',
    id: 'stalker',
    name: 'Stalker',
    emoji: '👁️',
    description: 'Deep Voidin ikoninen Stalker — pitkä tumma luurankohumanoidi, hehkuvat valkoiset silmät, siipimäiset raajat (oikeat assetit modin JARista, MIT)',
    defaultAnim: 'slowIdle'  // levitetty asento = referenssikuva
});

const stalkerNew = buildMob({
    geoFile: 'stalkernew.geo.json',
    modelId: 'geometry.stalker_new',
    pngFile: 'stalkernew.png',
    glowFile: 'stalkernew_eyesnsouls.png',
    animFile: 'stalkernew.animation.json',
    id: 'stalker_new',
    name: 'Stalker (New)',
    emoji: '🕷️',
    description: 'Modin nykyinen Stalker-versio — kyykkivä metsästäjä kynsiraajoineen (oikeat assetit modin JARista, MIT)'
});

// ---------------- loput Deep Void -otukset (isoimmat/hienoimmat) ----------------
// Kaikki pelin oikeita assetteja modin JARista (MIT): geometria + tekstuuri + animaatiot.
const MORE_MOBS = [
    {
        geoFile: 'primordialbonecrawler.geo.json',
        modelId: 'geometry.primordialBoneCrawler',
        pngFile: 'primordialbonecrawler.png',
        glowFile: null,
        animFile: 'primordialbonecrawler.animation.json',
        id: 'primordial_bone_crawler',
        name: 'Primordial Bone Crawler',
        emoji: '🦴',
        description: 'Jättiläinen luinen raato — Deep Voidin uumenien alkukantainen metsästäjä (14 animaatiota, lentää)'
    },
    {
        geoFile: 'falsehydra.geo.json',
        modelId: 'geometry.falseHydra',
        pngFile: 'falsehydra.png',
        glowFile: null,
        // Ei omaa glow-kerrosta pelissä — hehkuvat silmät johdetaan
        // tekstuurin kirkkaista pikseleistä (varmistettu: 51 valkoista
        // pikseliä yhdessä silmäalueessa, peli renderöi ne kirkkaina).
        emissiveFromBase: true,
        animFile: 'falsehydra.animation.json',
        id: 'false_hydra',
        name: 'False Hydra',
        emoji: '🐍',
        description: 'Kauhuklassikko: valtava monipäinen hydra, jonka laulu pyyhkii muistot (107 luuta)'
    },
    {
        geoFile: 'bringerofdespair.geo.json',
        modelId: 'geometry.bringerOfDespair',
        pngFile: 'bringerofdespair.png',
        glowFile: null,
        animFile: 'bringerofdespair.animation.json',
        id: 'bringer_of_despair',
        name: 'Bringer of Despair',
        emoji: '💀',
        description: 'Epätoivon tuoja — 64 luun bossi, jolla on omat guard/attack-asennot'
    },
    {
        geoFile: 'apostleofcatastrophe.geo.json',
        modelId: 'geometry.apostleOfCatastrophe',
        pngFile: 'apostleofcatastrophe.png',
        glowFile: null,
        animFile: 'apostleofcatastrophe.animation.json',
        id: 'apostle_of_catastrophe',
        name: 'Apostle of Catastrophe',
        emoji: '⚔️',
        description: 'Katastrofin apostoli — veitsiä heittelevä bossi, 23 animaatiota (block/pierce/spin/teleport…)'
    },
    {
        geoFile: 'executioner.geo.json',
        modelId: 'geometry.executioner',
        pngFile: 'executioner.png',
        glowFile: null,
        animFile: 'executioner.animation.json',
        id: 'executioner',
        name: 'Executioner',
        emoji: '🪓',
        description: 'Pyöveli — iso kirvestä heiluttava teloittaja (grab/slash/stunned)'
    },
    {
        geoFile: 'maniac.geo.json',
        modelId: 'geometry.maniac',
        pngFile: 'maniac.png',
        glowFile: 'maniac_glow.png',
        animFile: 'maniac.animation.json',
        id: 'maniac',
        name: 'Maniac',
        emoji: '🔪',
        description: 'Maniakki — juokseva veitsimies, hehkuvat silmät (6 animaatiota)'
    },
    {
        geoFile: 'hivewatcher.geo.json',
        modelId: 'geometry.hiveWatcher',
        pngFile: 'hivewatcher.png',
        glowFile: null,
        animFile: 'hivewatcher.animation.json',
        id: 'hive_watcher',
        name: 'Hive Watcher',
        emoji: '🐝',
        description: 'Pesän vartija — 56 luuta, liitää ja pyörii (spin/glide/spawn)'
    },
    {
        geoFile: 'eyecentipede.geo.json',
        modelId: 'geometry.eyeCentipede',
        pngFile: 'eyecentipede.png',
        // Pelin oma glow-kerros (CentigazeLayer → eye_centipede_glow.png)
        glowFile: 'eye_centipede_glow.png',
        animFile: 'eyecentipede.animation.json',
        id: 'eye_centipede',
        name: 'Eye Centipede',
        emoji: '🐛',
        description: 'Silmätuhatjalkainen — 66 luuta, kaivautuu ja käy kimppuun (idle/walk/aggressive/hidden/crawlOut)'
    },
    {
        geoFile: 'cavenightmare.geo.json',
        modelId: 'geometry.caveNightmare',
        pngFile: 'cavenightmare.png',
        glowFile: null,
        animFile: 'cavenightmare.animation.json',
        id: 'cave_nightmare',
        name: 'Cave Nightmare',
        emoji: '👁️',
        description: 'Luolan painajainen — varjoissa hiipivä peto stealth-idlellä (10 animaatiota)'
    },
    {
        geoFile: 'huntertrue.geo.json',
        modelId: 'geometry.hunterTrue',
        pngFile: 'huntertrue.png',
        glowFile: null,
        animFile: 'huntertrue.animation.json',
        id: 'hunter',
        name: 'Hunter',
        emoji: '🏹',
        description: 'Metsästäjä — jousella varustettu vainooja (52 luuta, shoot/jump/walk/aggressive)'
    }
].concat([
    // ---------------- loput Deep Void -entiteetit (kaikki oikeita assetteja) ----------------
    { geoFile: 'abductor.geo.json', modelId: 'geometry.abductor', pngFile: 'abductor.png', glowFile: null, animFile: 'abductor.animation.json', id: 'abductor', name: 'Abductor', emoji: '👽', description: 'Sieppaaja — nappaa uhrinsa ja kuljettaa pois (walk/idle)' },
    { geoFile: 'alphacrawlerremodel.geo.json', modelId: 'geometry.alphaCrawlerRemodel', pngFile: 'alphacrawlerremodelnew.png', glowFile: null, animFile: 'alphacrawlerremodel.animation.json', id: 'alpha_bone_crawler', name: 'Alpha Bone Crawler', emoji: '🐲', description: 'Alpha Bone Crawler — luurankopedin alfa (idle/walk/attack, 256×256)' },
    { geoFile: 'beholder.geo.json', modelId: 'geometry.beholder', pngFile: 'beholder.png', glowFile: null, animFile: 'beholder.animation.json', id: 'beholder', name: 'Beholder', emoji: '👁️', description: 'Beholder — leijuva silmäpallo (idle)' },
    { geoFile: 'bigeye.geo.json', modelId: 'geometry.bigEye', pngFile: 'bigeye.png', glowFile: null, animFile: 'bigeye.animation.json', id: 'big_eye', name: 'Big Eye', emoji: '👀', description: 'Big Eye — jättiläissilmä (spawn/idle)' },
    { geoFile: 'bogwalker.geo.json', modelId: 'geometry.bogWalker', pngFile: 'bog_walker.png', glowFile: null, animFile: 'bogwalker.animation.json', id: 'bog_walker', name: 'Bog Walker', emoji: '🧟', description: 'Bog Walker — suon kulkija (idle/walk)' },
    { geoFile: 'bone_cage.geo.json', modelId: 'geometry.boneCage', pngFile: 'bone_cage.png', glowFile: null, animFile: 'bone_cage.animation.json', id: 'bone_cage', name: 'Bone Cage', emoji: '🦴', description: 'Bone Cage — luinen häkki, joka nappaa uhrinsa (open/catch/close)', defaultAnim: 'open' },
    { geoFile: 'bonecrawlerremodel.geo.json', modelId: 'geometry.boneCrawlerRemodel', pngFile: 'bonecrawlerremodel.png', glowFile: null, animFile: 'bonecrawlerremodel.animation.json', id: 'bone_crawler', name: 'Bone Crawler', emoji: '🦴', description: 'Bone Crawler — luinen ryömijä (idle/walk/attack/dig/out)' },
    { geoFile: 'crosseye.geo.json', modelId: 'geometry.crossEyes', pngFile: 'crosseye.png', glowFile: null, animFile: 'crosseye.animation.json', id: 'cross_eyes', name: 'Cross Eyes', emoji: '👁️', description: 'Cross Eyes — ristisilmä (spawn/idle)' },
    { geoFile: 'damned.geo.json', modelId: 'geometry.damned', pngFile: 'damned.png', glowFile: null, animFile: 'damned.animation.json', id: 'damned', name: 'Damned', emoji: '😵', description: 'Damned — tuomittu (spawn/idle)' },
    { geoFile: 'deathmaw.geo.json', modelId: 'geometry.deathMaw', pngFile: 'death_maw.png', glowFile: 'death_maw_glow.png', animFile: 'deathmaw.animation.json', id: 'death_maw', name: 'Death Maw', emoji: '🦷', description: 'Death Maw — kuoleman kita, hehkuva kita (idle/attack/walk/aggressive)' },
    { geoFile: 'devourer.geo.json', modelId: 'geometry.devourer', pngFile: 'devourernew.png', glowFile: null, animFile: 'devourer.animation.json', id: 'devourer', name: 'Devourer', emoji: '🐲', description: 'Devourer — ahnas nielijä (idle/walk/attack)' },
    { geoFile: 'everhunger.geo.json', modelId: 'geometry.everhunger', pngFile: 'everhungernew.png', glowFile: null, animFile: 'everhunger.animation.json', id: 'everhunger', name: 'Everhunger', emoji: '🫦', description: 'Everhunger — ikuinen nälkä (idle/walk/attack)' },
    { geoFile: 'fleshcube.geo.json', modelId: 'geometry.fleshCube', pngFile: 'fleshcube.png', glowFile: null, animFile: 'fleshcube.animation.json', id: 'flesh_cube', name: 'Flesh Cube', emoji: '🟥', description: 'Flesh Cube — lihakuutio (idle/walk)' },
    { geoFile: 'fleshfangs.geo.json', modelId: 'geometry.fleshFangs', pngFile: 'flesh_fangs.png', glowFile: null, animFile: 'fleshfangs.animation.json', id: 'flesh_fangs', name: 'Flesh Fangs', emoji: '🦷', description: 'Flesh Fangs — lihahampaat (appear/idle/caught/death)' },
    { geoFile: 'fleshlamprey.geo.json', modelId: 'geometry.fleshLamprey', pngFile: 'fleshlamprey.png', glowFile: null, animFile: 'fleshlamprey.animation.json', id: 'flesh_lamprey', name: 'Flesh Lamprey', emoji: '🐟', description: 'Flesh Lamprey — lihanahkiainen (walk/swim/agressive/attack)' },
    { geoFile: 'fleshwormnew.geo.json', modelId: 'geometry.fleshWorm', pngFile: 'fleshwormnew.png', glowFile: null, animFile: 'fleshwormnew.animation.json', id: 'flesh_worm', name: 'Flesh Worm', emoji: '🪱', description: 'Flesh Worm — lihamato (10 animaatiota: eat/tail/swipe/air/dig)' },
    { geoFile: 'fool_eater.geo.json', modelId: 'geometry.foolEater', pngFile: 'fool_eater_newer.png', glowFile: 'fool_eater_newer_glow.png', animFile: 'fool_eater.animation.json', id: 'fool_eater', name: 'Fool Eater', emoji: '😈', description: 'Fool Eater — houkkien syöjä, hehkuvat silmät (idle/walk/attack)' },
    { geoFile: 'forsaken.geo.json', modelId: 'geometry.forsaken', pngFile: 'forsaken.png', glowFile: 'forsaken_glow.png', animFile: 'forsaken.animation.json', id: 'forsaken', name: 'Forsaken', emoji: '👤', description: 'Forsaken — hylätty, hehkuva (8 animaatiota: block/run/hide/dig)' },
    { geoFile: 'foureyes.geo.json', modelId: 'geometry.fourEyes', pngFile: 'foureyes.png', glowFile: null, animFile: 'foureyes.animation.json', id: 'four_eyes', name: 'Four Eyes', emoji: '👁️', description: 'Four Eyes — nelisilmä (spawn/idle)' },
    { geoFile: 'gaoler.geo.json', modelId: 'geometry.gaoler', pngFile: 'gaoler.png', glowFile: null, animFile: 'gaoler.animation.json', id: 'gaoler', name: 'Gaoler', emoji: '⛓️', description: 'Gaoler — vanginvartija (idle/attackCage/attack/walk/agressive)' },
    { geoFile: 'giantshadowhand.geo.json', modelId: 'geometry.giantShadowHand', pngFile: 'giantshadowhand.png', glowFile: 'giantshadowhand_glow.png', animFile: 'giantshadowhand.animation.json', id: 'giant_shadow_hand', name: 'Giant Shadow Hand', emoji: '🖐️', description: 'Giant Shadow Hand — jättiläiskäsi varjoista (beforeSpawn/spawn/despawn/idle/attack)' },
    { geoFile: 'gore_spitter.geo.json', modelId: 'geometry.goreSpitter', pngFile: 'gore_spitter.png', glowFile: null, animFile: 'gore_spitter.animation.json', id: 'gore_spitter', name: 'Gore Spitter', emoji: '🤮', description: 'Gore Spitter — kaaoksen sylkijä (aggressive/walk/idle)' },
    { geoFile: 'gravekeeper.geo.json', modelId: 'geometry.gravekeeper', pngFile: 'gravekeeper.png', glowFile: null, animFile: 'gravekeeper.animation.json', id: 'gravekeeper', name: 'Gravekeeper', emoji: '⚰️', description: 'Gravekeeper — haudanvartija (idle/walk/run/eat/dash/attack)' },
    { geoFile: 'harvestmen.geo.json', modelId: 'geometry.harvestmen', pngFile: 'harvestmen.png', glowFile: null, animFile: 'harvestmen.animation.json', id: 'harvestmen', name: 'Harvestmen', emoji: '🕷️', description: 'Harvestmen — pitkäjalkainen peto, myös ylösalaisin (7 animaatiota)' },
    { geoFile: 'hive_brain.geo.json', modelId: 'geometry.hiveBrain', pngFile: 'hive_brain.png', glowFile: null, animFile: 'hive_brain.animation.json', id: 'hive_brain', name: 'Hive Brain', emoji: '🧠', description: 'Hive Brain — pesän aivot (idle/death)' },
    { geoFile: 'hivefangs.geo.json', modelId: 'geometry.hiveFangs', pngFile: 'hivefangs.png', glowFile: null, animFile: 'hivefangs.animation.json', id: 'hive_fangs', name: 'Hive Fangs', emoji: '🐝', description: 'Hive Fangs — pesän hampaat (spawn/idle)' },
    { geoFile: 'hivemindrework.geo.json', modelId: 'geometry.hivemindRework', pngFile: 'hivemindrework.png', glowFile: null, animFile: 'hivemindrework.animation.json', id: 'hivemind', name: 'Hivemind', emoji: '🧠', description: 'Hivemind — yhteismieli (9 animaatiota: suck/digest/emerge/projectile)' },
    { geoFile: 'hollowed.geo.json', modelId: 'geometry.hollowed', pngFile: 'hollowed.png', glowFile: null, animFile: 'hollowed.animation.json', id: 'hollowed', name: 'Hollowed', emoji: '🕳️', description: 'Hollowed — onttoutunut (idle/walk/attack/summonVines/scream)' },
    { geoFile: 'lickerremodeled.geo.json', modelId: 'geometry.lickerRemodeled', pngFile: 'lickerremodeled.png', glowFile: null, animFile: 'lickerremodeled.animation.json', id: 'licker', name: 'Licker', emoji: '👅', description: 'Licker — nuolija (idle/stun/pull/eat)' },
    { geoFile: 'lurker.geo.json', modelId: 'geometry.lurker', pngFile: 'lurker_texture.png', glowFile: null, animFile: 'lurker.animation.json', id: 'lurker', name: 'Lurker', emoji: '🐾', description: 'Lurker — väijyjä (idle/attack/passive)' },
    { geoFile: 'madcultist.geo.json', modelId: 'geometry.madCultist', pngFile: 'madcultist.png', glowFile: null, animFile: 'madcultist.animation.json', id: 'mad_cultist', name: 'Mad Cultist', emoji: '🔮', description: 'Mad Cultist — hullu kultisti (10 animaatiota: slash/stab/block/shoot)' },
    { geoFile: 'maggot.geo.json', modelId: 'geometry.maggot', pngFile: 'void_fly_maggot.png', glowFile: null, animFile: 'maggot.animation.json', id: 'void_fly_maggot', name: 'Void Fly Maggot', emoji: '🪱', description: 'Void Fly Maggot — toukka (idle/walk/attack)' },
    { geoFile: 'mothercrawlerremodel.geo.json', modelId: 'geometry.motherCrawlerRemodel', pngFile: 'mothercrawlerremodel.png', glowFile: null, animFile: 'mothercrawlerremodel.animation.json', id: 'mother_bone_crawler', name: 'Mother Bone Crawler', emoji: '🦴', description: 'Mother Bone Crawler — luurankoemo (idle/walk/attack/hatch)' },
    { geoFile: 'mourner_animated.geo.json', modelId: 'geometry.mourner', pngFile: 'mourner_remodel.png', glowFile: null, animFile: 'mourner_animated.animation.json', id: 'mourner', name: 'Mourner', emoji: '🥀', description: 'Mourner — sureja (walk/idle)' },
    { geoFile: 'multipleeyes.geo.json', modelId: 'geometry.multipleEyes', pngFile: 'multipleeyes.png', glowFile: null, animFile: 'multipleeyes.animation.json', id: 'multiple_eyes', name: 'Multiple Eyes', emoji: '👁️', description: 'Multiple Eyes — silmäkimppu (spawn/idle)' },
    { geoFile: 'overseer.geo.json', modelId: 'geometry.overseer', pngFile: 'overseernew.png', glowFile: null, animFile: 'overseer.animation.json', id: 'overseer', name: 'Overseer', emoji: '👁️', description: 'Overseer — valvoja (idle/walk/aggressive/attack)' },
    { geoFile: 'penitent.geo.json', modelId: 'geometry.penitent', pngFile: 'penitent_and_shank.png', glowFile: null, animFile: 'penitent.animation.json', id: 'penitent', name: 'Penitent', emoji: '🙏', description: 'Penitent — katumuksentekijä (idle/agressive/walk/slash/pray)' },
    { geoFile: 'preserver.geo.json', modelId: 'geometry.preserver', pngFile: 'preserver_new.png', glowFile: null, animFile: 'preserver.animation.json', id: 'preserver', name: 'Preserver', emoji: '🧪', description: 'Preserver — säilöjä (idle/walk/aggressive/attackBlock/cling)' },
    { geoFile: 'prisonguard.geo.json', modelId: 'geometry.prisonGuard', pngFile: 'prison_guard.png', glowFile: null, animFile: 'prisonguard.animation.json', id: 'prison_guard', name: 'Prison Guard', emoji: '🪖', description: 'Prison Guard — vankilan vartija (9 animaatiota: dodge/lunge/roll/attack/push)' },
    { geoFile: 'rooted.geo.json', modelId: 'geometry.rooted', pngFile: 'rooted_rework.png', glowFile: 'rooted_rework_glow.png', animFile: 'rooted.animation.json', id: 'rooted', name: 'Rooted', emoji: '🌿', description: 'Rooted — juurtunut, hehkuva (idle/walk/attack)' },
    { geoFile: 'rottencorpse.geo.json', modelId: 'geometry.rottenCorpse', pngFile: 'rotten_corpse_new.png', glowFile: null, animFile: 'rottencorpse.animation.json', id: 'rotten_corpse', name: 'Rotten Corpse', emoji: '🧟', description: 'Rotten Corpse — mätä ruumis (idle/attack/walk)' },
    { geoFile: 'saw_thrower.geo.json', modelId: 'geometry.sawThrower', pngFile: 'saw_thrower.png', glowFile: null, animFile: 'saw_thrower.animation.json', id: 'saw_thrower', name: 'Saw Thrower', emoji: '🪚', description: 'Saw Thrower — sahanheittäjä (idle/spin/teleport/out/walk/shoot)' },
    { geoFile: 'scarecrow.geo.json', modelId: 'geometry.scarecrow', pngFile: 'scarecrow.png', glowFile: null, animFile: 'scarecrow.animation.json', id: 'scarecrow', name: 'Scarecrow', emoji: '🧑‍🌾', description: 'Scarecrow — variksenpelätin (idle/walk/aggressive)' },
    { geoFile: 'seeker.geo.json', modelId: 'geometry.seeker', pngFile: 'seeker.png', glowFile: 'seeker_glow.png', animFile: 'seeker.animation.json', id: 'soulseeker', name: 'Soulseeker (Seeker)', emoji: '🪽', description: 'Soulseeker — siipinen sielunmetsästäjä, hehkuvat silmät (idle/walk/attack/aggressive/hidden/out)' },
    { geoFile: 'shadowhand.geo.json', modelId: 'geometry.shadowHand', pngFile: 'shadowhand.png', glowFile: null, animFile: 'shadowhand.animation.json', id: 'shadow_hand', name: 'Shadow Hand', emoji: '✋', description: 'Shadow Hand — varjokäsi (idle/attack/exit/enter)' },
    { geoFile: 'skull_smasher.geo.json', modelId: 'geometry.skullSmasher', pngFile: 'skull_smasher.png', glowFile: null, animFile: 'skull_smasher.animation.json', id: 'skull_smasher', name: 'Skull Smasher', emoji: '💀', description: 'Skull Smasher — kallionmurskaaja (idle/walk/dash/attack/slash/out)' },
    { geoFile: 'smallfleshcube.geo.json', modelId: 'geometry.smallFleshCube', pngFile: 'small_flesh_cube.png', glowFile: null, animFile: 'smallfleshcube.animation.json', id: 'small_flesh_cube', name: 'Small Flesh Cube', emoji: '🟫', description: 'Small Flesh Cube — pieni lihakuutio (idle/walk)' },
    { geoFile: 'sporespewer.geo.json', modelId: 'geometry.sporeSpewer', pngFile: 'sporespewernew.png', glowFile: null, animFile: 'sporespewer.animation.json', id: 'spore_spewer', name: 'Spore Spewer', emoji: '🍄', description: 'Spore Spewer — itiöiden sylkijä (idle/walk/spew/attack)' },
    { geoFile: 'spittercrawlerremodel.geo.json', modelId: 'geometry.spitterCrawlerRemodel', pngFile: 'spittercrawlerremodel.png', glowFile: null, animFile: 'spittercrawlerremodel.animation.json', id: 'spitter_crawler', name: 'Spitter Crawler', emoji: '🦴', description: 'Spitter Crawler — sylkijäryömijä (idle/walk/attack/dig/out)' },
    { geoFile: 'swarmer.geo.json', modelId: 'geometry.swarmer', pngFile: 'swarmer.png', glowFile: null, animFile: 'swarmer.animation.json', id: 'swarmer', name: 'Swarmer', emoji: '🦟', description: 'Swarmer — parviötökkä (fly)' },
    { geoFile: 'thumper.geo.json', modelId: 'geometry.thumper', pngFile: 'thumper.png', glowFile: null, animFile: 'thumper.animation.json', id: 'thumper', name: 'Thumper', emoji: '🐘', description: 'Thumper — jyskyttäjä (idle)' },
    { geoFile: 'tombstone.geo.json', modelId: 'geometry.tombstone', pngFile: 'tombstone.png', glowFile: 'tombstone_glow.png', animFile: 'tombstone.animation.json', id: 'tombstone', name: 'Dooming Tombstone', emoji: '🪦', description: 'Dooming Tombstone — tuomitseva hautakivi, hehkuva (despawn/fall/idle)' },
    { geoFile: 'void_tentacle.geo.json', modelId: 'geometry.voidTentacle', pngFile: 'void_tentacle.png', glowFile: null, animFile: 'void_tentacle.animation.json', id: 'void_tentacle', name: 'Void Tentacle', emoji: '🐙', description: 'Void Tentacle — tyhjyyden lonkero (idle/aggressive/attack)' },
    { geoFile: 'voidborntentacles.geo.json', modelId: 'geometry.voidbornTentacles', pngFile: 'voidborntentacles.png', glowFile: null, animFile: 'voidborntentacles.animation.json', id: 'voidborn_tentacles', name: 'Voidborn Tentacles', emoji: '🦑', description: 'Voidborn Tentacles — tyhjyyssyntyiset lonkerot (spawn/despawn/idle)' },
    { geoFile: 'voidfly.geo.json', modelId: 'geometry.voidFly', pngFile: 'voidfly.png', glowFile: null, animFile: 'voidfly.animation.json', id: 'void_fly', name: 'Void Fly', emoji: '🪰', description: 'Void Fly — tyhjyyskärpänen (idle/attack/land)' },
    { geoFile: 'voidwatcher.geo.json', modelId: 'geometry.voidWatcher', pngFile: 'void_dweller_texture.png', glowFile: null, animFile: 'voidwatcher.animation.json', id: 'void_watcher', name: 'Void Watcher', emoji: '👁️', description: 'Void Watcher — tyhjyyden tarkkailija (idle/walk/attack)' },
    { geoFile: 'vulture.geo.json', modelId: 'geometry.deathVulture', pngFile: 'death_vulture.png', glowFile: 'death_vulture_glow.png', animFile: 'vulture.animation.json', id: 'death_vulture', name: 'Death Vulture', emoji: '🦅', description: 'Death Vulture — kuolonkorppikotka, hehkuva (idle/walk/aggressive/attack/dash)' },
    { geoFile: 'wanderer.geo.json', modelId: 'geometry.wanderer', pngFile: 'wanderer_texture.png', glowFile: null, animFile: 'wanderer.animation.json', id: 'wanderer', name: 'Wanderer', emoji: '🥾', description: 'Wanderer — vaeltaja (idle/walk/die)' }
]).map(cfg => buildMob(cfg));

// ---------------- output ----------------
const out = `/**
 * GENERATED by tools/generate-weaver.js — do not edit by hand.
 *
 * Weaver Of Souls / Chained Weaver — The Deep Void -modin (MIT) OIKEAT assetit:
 * geometria, tekstuuri (+glow) ja animaatiot suoraan pelin JARista.
 * Re-generate: node tools/generate-weaver.js
 */
export const DEEP_VOID_MOBS = ${JSON.stringify([fallen, chained, stalker, stalkerNew, ...MORE_MOBS], null, 4)};
`;

writeFileSync(path.join(root, 'js/mobs/deepvoid.js'), out);
console.log('✅ js/mobs/deepvoid.js written (' + (out.length / 1024).toFixed(1) + ' KB)');
console.log('   Weaver of Souls: bones=' + fallen.model.bones.length + ' cubes=' + fallen.model.bones.reduce((n, b) => n + b.cubes.length, 0) + ' anims=' + Object.keys(fallen.animations).join(','));
console.log('   Chained Weaver:  bones=' + chained.model.bones.length + ' cubes=' + chained.model.bones.reduce((n, b) => n + b.cubes.length, 0) + ' anims=' + Object.keys(chained.animations).join(','));
for (const m of MORE_MOBS) {
    console.log('   ' + m.name.padEnd(28) + ' bones=' + m.model.bones.length + ' cubes=' + m.model.bones.reduce((n, b) => n + b.cubes.length, 0) + ' anims=' + Object.keys(m.animations).join(','));
}

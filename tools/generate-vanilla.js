/**
 * Generates js/mobs/vanilla.js — real vanilla Minecraft mob models with their
 * real textures and walk animations, bundled as library entries.
 *
 * Usage: node tools/generate-vanilla.js
 * Source files: assets/vanilla/models/*.geo.json + assets/vanilla/textures/*.png
 * (download them from e.g. github.com/ZtechNetwork/MCBVanillaResourcePack).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseBedrockGeometry } from '../js/formats/bedrock.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.join(root, 'assets/vanilla/models');
const texDir = path.join(root, 'assets/vanilla/textures');
const animDir = path.join(root, 'assets/vanilla/animations');

// Per-mob metadata: display name, emoji, and the bones to animate.
// Mobs WITHOUT explicit legs/arms get them auto-derived from the bone names
// (see deriveLimbs) — the fetch script downloads everything from Mojang's
// bedrock-samples repo, so adding a mob here is all that's needed.
const MOB_CONFIG = {
    // --- humanoids ---
    zombie:   { name: 'Zombie',   emoji: '🧟', legs: ['leftLeg', 'rightLeg'],          arms: ['leftArm', 'rightArm'],    swing: 25 },
    skeleton: { name: 'Skeleton', emoji: '💀', legs: ['leftLeg', 'rightLeg'],          arms: ['leftArm', 'rightArm'],    swing: 25 },
    villager: { name: 'Villager', emoji: '🧔', legs: ['leg0', 'leg1'],                 arms: [],                        swing: 20 },
    warden:   { name: 'Warden',   emoji: '🫀', legs: ['left_leg', 'right_leg'],        arms: ['left_arm', 'right_arm'],  swing: 18, tendrils: ['left_tendril', 'right_tendril'] },
    drowned:  { name: 'Drowned',  emoji: '🧜', legs: ['rightLeg', 'leftLeg'],          arms: ['rightArm', 'leftArm'],    swing: 25 },
    husk:     { name: 'Husk',     emoji: '🏜️', legs: ['leftLeg', 'rightLeg'],          arms: ['leftArm', 'rightArm'],    swing: 25 },
    stray:    { name: 'Stray',    emoji: '❄️', legs: ['leftLeg', 'rightLeg'],          arms: ['leftArm', 'rightArm'],    swing: 25 },
    bogged:   { name: 'Bogged',   emoji: '🪵', legs: ['leftLeg', 'rightLeg'],          arms: ['leftArm', 'rightArm'],    swing: 25 },
    enderman: { name: 'Enderman', emoji: '🖤', legs: ['rightLeg', 'leftLeg'],          arms: ['rightArm', 'leftArm'],    swing: 22 },
    evoker:   { name: 'Evoker',   emoji: '🧙', legs: ['RightLeg', 'LeftLeg'],          arms: ['RightArm', 'LeftArm'],    swing: 25 },
    vindicator:{ name: 'Vindicator', emoji: '🪓', legs: ['RightLeg', 'LeftLeg'],       arms: ['RightArm', 'LeftArm'],    swing: 25 },
    pillager: { name: 'Pillager', emoji: '🏹', legs: ['RightLeg', 'LeftLeg'],          arms: ['rightarm', 'leftarm'],    swing: 25 },
    witch:    { name: 'Witch',    emoji: '🧙‍♀️', legs: ['leg0', 'leg1'],                arms: ['arms'],                  swing: 22 },
    vex:      { name: 'Vex',      emoji: '👿', arms: ['leftArm', 'rightArm', 'leftWing', 'rightWing'], swing: 20 },
    allay:    { name: 'Allay',    emoji: '🪽', arms: ['left_arm', 'right_arm', 'left_wing', 'right_wing'], swing: 18 },
    iron_golem: { name: 'Iron Golem', emoji: '🗿', legs: ['rightLeg', 'leftLeg'],      arms: ['rightArm', 'leftArm'],    swing: 16 },
    snow_golem:{ name: 'Snow Golem', emoji: '⛄', arms: ['rightArm', 'leftArm'],       swing: 14 },
    copper_golem: { name: 'Copper Golem', emoji: '🤖', legs: ['right_leg', 'left_leg'], arms: ['right_arm', 'left_arm'], swing: 20 },
    creaking: { name: 'Creaking', emoji: '🌲', legs: ['leftLeg', 'rightLeg'],          arms: ['leftArm', 'rightArm'],    swing: 22 },
    // --- quadrupeds ---
    pig:      { name: 'Pig',      emoji: '🐷', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 18 },
    cow:      { name: 'Cow',      emoji: '🐮', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 18 },
    sheep:    { name: 'Sheep',    emoji: '🐑', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 18, geometryKey: 'geometry.sheep.v1.8' },
    chicken:  { name: 'Chicken',  emoji: '🐔', legs: ['leg0', 'leg1'],                 arms: ['wing0', 'wing1'],         swing: 16 },
    rabbit:   { name: 'Rabbit',   emoji: '🐇', legs: ['rearFootLeft', 'rearFootRight', 'frontLegLeft', 'frontLegRight'], arms: [], swing: 28 },
    cat:      { name: 'Cat',      emoji: '🐱', legs: ['backLegL', 'backLegR', 'frontLegL', 'frontLegR'], arms: [], swing: 20 },
    wolf:     { name: 'Wolf',     emoji: '🐺', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 20 },
    fox:      { name: 'Fox',      emoji: '🦊', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 20 },
    goat:     { name: 'Goat',     emoji: '🐐', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 20 },
    panda:    { name: 'Panda',    emoji: '🐼', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 18 },
    polar_bear:{ name: 'Polar Bear', emoji: '🐻‍❄️', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [], swing: 18 },
    hoglin:   { name: 'Hoglin',   emoji: '🐗', legs: ['leg_front_right', 'leg_front_left', 'leg_back_right', 'leg_back_left'], arms: [], swing: 18 },
    zoglin:   { name: 'Zoglin',   emoji: '👹', legs: ['leg_front_right', 'leg_front_left', 'leg_back_right', 'leg_back_left'], arms: [], swing: 18 },
    camel:    { name: 'Camel',    emoji: '🐫', legs: ['right_front_leg', 'left_front_leg', 'right_hind_leg', 'left_hind_leg'], arms: [], swing: 18 },
    llama:    { name: 'Llama',    emoji: '🦙', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 20 },
    armadillo:{ name: 'Armadillo', emoji: '🦔', legs: ['right_hind_leg', 'left_hind_leg', 'right_front_leg', 'left_front_leg'], arms: [], swing: 18 },
    ocelot:   { name: 'Ocelot',   emoji: '🐆', legs: ['backLegL', 'backLegR', 'frontLegL', 'frontLegR'], arms: [], swing: 20 },
    // --- aquatic ---
    dolphin:  { name: 'Dolphin',  emoji: '🐬', swing: 0 },
    squid:    { name: 'Squid',    emoji: '🦑', swing: 0 },
    glow_squid:{ name: 'Glow Squid', emoji: '✨', swing: 0 },
    cod:      { name: 'Cod',      emoji: '🐟', swing: 0 },
    salmon:   { name: 'Salmon',   emoji: '🐟', swing: 0 },
    tropical_fish: { name: 'Tropical Fish', emoji: '🐠', swing: 0 },
    pufferfish:{ name: 'Pufferfish', emoji: '🐡', swing: 0 },
    turtle:   { name: 'Turtle',   emoji: '🐢', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 16 },
    tadpole:  { name: 'Tadpole',  emoji: '🐸', swing: 0 },
    axolotl:  { name: 'Axolotl',  emoji: '🦎', legs: ['right_leg', 'left_leg'],        arms: ['right_arm', 'left_arm'],   swing: 20 },
    frog:     { name: 'Frog',     emoji: '🐸', legs: ['left_leg', 'right_leg'],        arms: ['left_arm', 'right_arm'],   swing: 24 },
    // --- flying / misc ---
    bee:      { name: 'Bee',      emoji: '🐝', legs: ['leg_front', 'leg_mid', 'leg_back'], arms: ['rightwing_bone', 'leftwing_bone'], swing: 24 },
    bat:      { name: 'Bat',      emoji: '🦇', arms: ['rightWing', 'leftWing', 'rightWingTip', 'leftWingTip'], swing: 20 },
    parrot:   { name: 'Parrot',   emoji: '🦜', legs: ['leg0', 'leg1'],                 arms: ['wing0', 'wing1'],         swing: 20 },
    phantom:  { name: 'Phantom',  emoji: '👻', arms: ['rightWing', 'leftWing'],        swing: 18 },
    blaze:    { name: 'Blaze',    emoji: '🔥', swing: 0 },
    ghast:    { name: 'Ghast',    emoji: '🎈', swing: 0 },
    slime:    { name: 'Slime',    emoji: '🟢', swing: 0 },
    shulker:  { name: 'Shulker',  emoji: '🟪', swing: 0 },
    silverfish:{ name: 'Silverfish', emoji: '🐛', swing: 0 },
    endermite:{ name: 'Endermite', emoji: '🐜', swing: 0 },
    sniffer:  { name: 'Sniffer',  emoji: '🌸', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 18 },
    breeze:   { name: 'Breeze',   emoji: '🌪️', swing: 0 },
    creeper:  { name: 'Creeper',  emoji: '💥', legs: ['leg0', 'leg1', 'leg2', 'leg3'], arms: [],                        swing: 14 },
    spider:   { name: 'Spider',   emoji: '🕷️', legs: ['leg0', 'leg1', 'leg2', 'leg3', 'leg4', 'leg5', 'leg6', 'leg7'], arms: [], swing: 22 }
};

// Bone-name heuristics for mobs without explicit legs/arms in MOB_CONFIG.
function deriveLimbs(bones) {
    const legs = [];
    const arms = [];
    for (const b of bones) {
        if (/arm|wing/i.test(b.name)) {
            if (!/armor/i.test(b.name)) arms.push(b.name);
        } else if (/leg|foot|hind/i.test(b.name)) {
            legs.push(b.name);
        }
    }
    return { legs: [...new Set(legs)], arms: [...new Set(arms)] };
}

function walkCycle(legs, arms, length, swing, tendrils = []) {
    const tracks = {};
    const q = length / 4;
    // Jalat ja kädet kävelevät eteen–taakse (X-akseli), kuten oikeissa mobeissa
    // — sivusuuntainen Z-heilunta näyttäisi rikkinäiseltä "cancanilta".
    legs.forEach((name, i) => {
        const p = (i % 2 === 0) ? 1 : -1;
        tracks[name] = {
            0: [p * swing, 0, 0],
            [Math.round(q)]: [-p * swing, 0, 0],
            [Math.round(q * 2)]: [p * swing, 0, 0],
            [Math.round(q * 3)]: [-p * swing, 0, 0]
        };
    });
    arms.forEach((name, i) => {
        const p = -((i % 2 === 0) ? 1 : -1);
        tracks[name] = {
            0: [p * swing * 0.7, 0, 0],
            [Math.round(q)]: [-p * swing * 0.7, 0, 0],
            [Math.round(q * 2)]: [p * swing * 0.7, 0, 0],
            [Math.round(q * 3)]: [-p * swing * 0.7, 0, 0]
        };
    });
    // Lonkerot/siivet aaltoilevat sivusuunnassa (Z) — lepatus, ei kävely
    tendrils.forEach((name, i) => {
        const p = (i % 2 === 0) ? 1 : -1;
        tracks[name] = {
            0: [0, 0, p * swing * 1.2],
            [Math.round(q)]: [0, 0, -p * swing * 1.2],
            [Math.round(q * 2)]: [0, 0, p * swing * 1.2],
            [Math.round(q * 3)]: [0, 0, -p * swing * 1.2]
        };
    });
    return { length, tracks };
}

/**
 * Bedrock JSON files may contain // comments (JSONC). Strip them while
 * respecting string literals so JSON.parse can read the file.
 */
function stripJsonComments(src) {
    let out = '';
    let inStr = false, inLine = false, inBlock = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i], n = src[i + 1];
        if (inLine) {
            if (c === '\n') { inLine = false; out += c; }
            continue;
        }
        if (inBlock) {
            if (c === '*' && n === '/') { inBlock = false; i++; }
            continue;
        }
        if (inStr) {
            out += c;
            if (c === '\\') { out += n; i++; }
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; out += c; continue; }
        if (c === '/' && n === '/') { inLine = true; i++; continue; }
        if (c === '/' && n === '*') { inBlock = true; i++; continue; }
        out += c;
    }
    return out;
}

/**
 * Derives a short animation name from a Bedrock full name, e.g.
 *   animation.sheep.grazing.v2  → "grazing"
 *   animation.zombie.attack_bare_hand → "attack_bare_hand"
 *   animation.spider.walk        → "walk"
 */
function shortAnimName(fullName) {
    let n = fullName.replace(/^animation\./, '');
    n = n.replace(/\.v\d+(\.\d+)?$/, ''); // versionisuffiksi (v1.0, v2…)
    const parts = n.split('.');
    return parts[parts.length - 1];
}

/**
 * Converts an authored Bedrock animation (rotation keyframes) to the editor's
 * track format. 20 fps → frame = round(seconds * 20). MoLang-driven channels
 * (string arrays) and position channels are skipped.
 */
function convertAuthoredAnimation(anim) {
    const tracks = {};
    let maxT = 0;
    for (const [bone, ch] of Object.entries(anim.bones || {})) {
        const rot = ch && ch.rotation;
        if (!rot || Array.isArray(rot)) continue; // MoLang/staattinen — ei keyframeja
        const frames = {};
        for (const [t, kv] of Object.entries(rot)) {
            const sec = parseFloat(t);
            const v = Array.isArray(kv) ? kv : (kv && Array.isArray(kv.post) ? kv.post : null);
            if (!v) continue;
            maxT = Math.max(maxT, sec);
            frames[Math.round(sec * 20)] = [v[0] || 0, v[1] || 0, v[2] || 0];
        }
        if (Object.keys(frames).length) tracks[bone] = frames;
    }
    return { length: Math.max(1, Math.round(maxT * 20)), tracks };
}

/**
 * Wardenin oikea kävely — näytteistetty Mojangin client entity -pre_animation
 * -kaavoista (variable.anim_pos_mod = 49.388962, 57.2958 = rad->deg jne.).
 * Yksi askel / 48 framea, 20 fps.
 */
function wardenMove() {
    const length = 48, N = 12, speed = 0.45;
    const tracks = { head: {}, body: {}, left_leg: {}, right_leg: {}, left_arm: {}, right_arm: {} };
    for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2;
        const f = Math.round(i * (length / N));
        tracks.head[f] = [68.7549 * Math.cos(t + Math.PI / 2) * Math.min(0.35, speed), 0, 17.1887 * Math.sin(t) * speed];
        tracks.body[f] = [57.2958 * Math.cos(t) * Math.min(0.35, speed), 0, 5.72958 * Math.sin(t) * speed];
        tracks.left_leg[f] = [57.2958 * Math.cos(t) * speed, 0, 0];
        tracks.right_leg[f] = [57.2958 * Math.cos(t + Math.PI) * speed, 0, 0];
        tracks.left_arm[f] = [-45.8366 * Math.cos(t) * speed, 0, 0];
        tracks.right_arm[f] = [-45.8366 * Math.sin(t) * speed, 0, 0];
    }
    return { length, tracks };
}

/**
 * Wardenin leijunta-idle — vaniljan animation.warden.bob: vartalo ja pää
 * huojuvat (amplitudit 1.43° / 3.43°, yksi huojunta n. 3.14 s).
 */
function wardenBob() {
    const length = 63, step = 7;
    const tracks = { body: {}, head: {} };
    for (let f = 0; f <= length; f += step) {
        const mb = (f / 20) * ((2 * Math.PI) / 3.14);
        const s = Math.sin(mb), c = Math.cos(mb);
        tracks.body[f] = [c * 1.43, 0, s * 1.43];
        tracks.head[f] = [s * 3.43, 0, c * 3.43];
    }
    return { length, tracks };
}

const mobs = [];
for (const file of readdirSync(modelsDir).filter(f => f.endsWith('.geo.json')).sort()) {
    const id = file.replace('.geo.json', '');
    const cfg = MOB_CONFIG[id];
    if (!cfg) {
        console.log('  (skip ' + id + ' — no config)');
        continue;
    }
    const json = JSON.parse(readFileSync(path.join(modelsDir, file), 'utf8'));
    // Monilla mobeilla on useita geometrioita (esim. sheep: sheared + woolly).
    // geometryKey valitsee oikean — parseri ottaisi muuten ensimmäisen.
    let geoJson = json;
    if (cfg.geometryKey) {
        // Vanilla-tiedostoissa on usein alias-syntaksi "a:b" (a on varsinainen, b peritty).
        // Etsitään avain, joka alkaa halutulla nimellä.
        const key = Object.keys(json).find(k => k === cfg.geometryKey || k.startsWith(cfg.geometryKey + ':'));
        const geo = key ? json[key] : null;
        if (geo) {
            geoJson = { format_version: json.format_version, [cfg.geometryKey]: geo };
        } else {
            console.log('  (warning: geometryKey ' + cfg.geometryKey + ' not found for ' + id + ')');
        }
    }
    let model = parseBedrockGeometry(geoJson);

    // --- erikoistapaukset: korjaa oikeat data-bugit ----------------------
    if (id === 'witch') {
        // Noidan oma geometria on vain hattu (Mojangin tiedostossa). Oikea
        // noita = villager-runko + noidan hattu/nenä. Yhdistetään ne, jotta
        // kirjaston Witch ei ole pelkkä leijuva hattu.
        const villager = parseBedrockGeometry(JSON.parse(readFileSync(path.join(modelsDir, 'villager.geo.json'), 'utf8')));
        const hatBones = model.bones.filter(b => ['nose', 'hat', 'hat2', 'hat3', 'hat4'].includes(b.name));
        model = {
            ...villager,
            modelId: 'geometry.villager.witch',
            textureHeight: 128, // noidan tekstuuri on 64x128 (hattu y-64..128)
            bones: villager.bones.filter(b => b.name !== 'nose').concat(hatBones)
        };
    }
    if (id === 'pillager') {
        // Mojangin datassa rightItem/leftItem viittaavat isokirjaimisiin
        // olemattomiin luihin (oikeat luut ovat rightarm/leftarm).
        const fixParent = (name, real) => {
            const b = model.bones.find(x => x.name === name);
            if (b && b.parent !== real) b.parent = real;
        };
        fixParent('rightItem', 'rightarm');
        fixParent('leftItem', 'leftarm');
    }
    const parsed = model;

    let textureDataURL = null;
    try {
        const png = readFileSync(path.join(texDir, id + '.png'));
        textureDataURL = 'data:image/png;base64,' + png.toString('base64');
    } catch {
        console.log('  (skip ' + id + ' — no texture)');
        continue; // tekstuuriton mobi ei ole kirjastossa käyttökelpoinen
    }

    // Auto-derive legs/arms from the bone names when the config doesn't
    // specify them (e.g. newly fetched mobs).
    const derived = deriveLimbs(parsed.bones.map(b => b.name));
    const legs = cfg.legs ?? derived.legs;
    const arms = cfg.arms ?? derived.arms;

    let animation = walkCycle(legs, arms, 40, cfg.swing, cfg.tendrils || []);
    let animations = null;

    // Oikeat Bedrock-animaatiot (assets/vanilla/animations/<id>.json) jos saatavilla
    const animPath = path.join(animDir, id + '.json');
    if (existsSync(animPath)) {
        const animFile = JSON.parse(stripJsonComments(readFileSync(animPath, 'utf8')));
        const raw = animFile.animations || {};
        const conv = {};
        for (const [fullName, a] of Object.entries(raw)) {
            // Vauva-animaatiot (baby_transform) eivät sovi aikuisiin malleihin,
            // setup/general ovat staattisia poseja ilman keyframeja.
            if (fullName.includes('baby_transform')) continue;
            const short = shortAnimName(fullName);
            if (!short || short === 'setup' || short === 'general' || short === 'default_leg_pose') continue;
            const c = convertAuthoredAnimation(a);
            if (c && Object.keys(c.tracks).length) conv[short] = c;
        }
        if (id === 'warden') {
            // Wardenin kävely/idle ovat proseduraalisia MoLang-kaavoja —
            // näytteistetään tarkat vaniljakaavat (client entity pre_animation).
            // Loput (emerge, dig, roar, sniff, attack, sonic_boom) ovat oikeita
            // keyframe-animaatioita vanilla-animaatiotiedostosta.
            animations = {
                idle: wardenBob(),
                walk: wardenMove(),
                ...conv
            };
        } else if (Object.keys(conv).length) {
            // Oletus pysyy generoidussa kävelyssä; oikeat animaatiot lisätään
            // valitsimeen (ja korvaavat samannimiset, kuten hämähäkin walk).
            animations = { walk: walkCycle(legs, arms, 40, cfg.swing, cfg.tendrils || []), ...conv };
        }
        if (animations) {
            const pref = ['walk', 'move', 'legs', 'swelling', 'attack'];
            const def = pref.find(k => animations[k]) || Object.keys(animations)[0];
            animation = animations[def];
            console.log('  (real animations for ' + id + ': ' + Object.keys(animations).join(', ') + ')');
        }
    }

    mobs.push({
        id,
        name: cfg.name,
        emoji: cfg.emoji,
        description: `Real vanilla ${cfg.name} — geometry, texture and ${animations ? 'real' : 'walk'} animation`,
        model: parsed,
        textureDataURL,
        animation,
        ...(animations ? { animations } : {})
    });
    console.log('  ✓ ' + cfg.name + ' (' + parsed.bones.reduce((n, b) => n + b.cubes.length, 0) + ' cubes)' + (cfg.legs || cfg.arms ? '' : ' [auto limbs]'));
}

const out = `/**
 * GENERATED by tools/generate-vanilla.js — do not edit by hand.
 * Real vanilla Minecraft mob models + textures + walk animations.
 * Re-generate: node tools/generate-vanilla.js
 */
export const VANILLA_MOBS = ${JSON.stringify(mobs, null, 2)};
`;

writeFileSync(path.join(root, 'js/mobs/vanilla.js'), out);
console.log('✅ js/mobs/vanilla.js written (' + (out.length / 1024).toFixed(1) + ' KB)');

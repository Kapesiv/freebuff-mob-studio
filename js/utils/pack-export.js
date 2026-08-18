/**
 * Resurssipaketin kokoaja — kokoaa mallin, tekstuurit ja animaatiot
 * valmiiksi kansiorakenteeksi, joka menee suoraan peliin:
 *
 *   ☕ Java (GeckoLib-modit):
 *     pack.mcmeta
 *     assets/<ns>/geo/<id>.geo.json
 *     assets/<ns>/animations/<id>.animation.json
 *     assets/<ns>/textures/entity/<id>.png
 *     assets/<ns>/textures/entity/<id>_glow.png         (jos glow)
 *     assets/freebuff/models/item/<id>.json            (Java-edition item-malli)
 *     assets/freebuff/textures/item/<id>.png
 *
 *   🎮 Bedrock (addon — resource_pack + behavior_pack, tuodaan suoraan
 *      Minecraftiin; mobi spawnaa heti):
 *     resource_pack/manifest.json
 *     resource_pack/entity/<id>.entity.json            (client-entity)
 *     resource_pack/models/entity/<id>.geo.json
 *     resource_pack/render_controllers/<id>.render_controllers.json
 *     resource_pack/textures/entity/<id>.png
 *     resource_pack/textures/entity/<id>_glow.png      (jos glow)
 *     resource_pack/animations/<id>.animation.json     (jos animaatioita)
 *     behavior_pack/manifest.json                      (riippuvuus RP:stä)
 *     behavior_pack/entities/<id>.json                 (behavior-entity)
 *     behavior_pack/spawn_rules/<id>.json              (spawn-säännöt)
 */
import { exportBedrockGeometry } from '../formats/bedrock.js';
import { exportJavaModel } from '../formats/java.js';
import { exportJavaAnimations } from '../formats/animation.js';

const enc = new TextEncoder();

function jsonBytes(obj) {
    return enc.encode(JSON.stringify(obj, null, 2));
}

/** PNG-kuva Uint8Array:na canvasista tai dataURL:stä. */
export function pngBytesFromTexture(textureCanvas) {
    if (!textureCanvas) return null;
    let dataUrl = typeof textureCanvas.toDataURL === 'function'
        ? textureCanvas.toDataURL('image/png')
        : textureCanvas;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return null;
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

function bedrockManifest(name, moduleUuid) {
    return {
        format_version: 2,
        header: {
            name: `${name} (Freebuff Mob Studio)`,
            description: 'Malli, tekstuurit ja animaatiot — Freebuff Mob Studio',
            uuid: uuid(),
            version: [1, 0, 0],
            min_engine_version: [1, 16, 0],
        },
        modules: [
            { type: 'resources', uuid: moduleUuid || uuid(), version: [1, 0, 0] },
        ],
    };
}

function behaviorManifest(name, rpModuleUuid) {
    return {
        format_version: 2,
        header: {
            name: `${name} Behavior (Freebuff Mob Studio)`,
            description: 'Mobin käyttäytyminen ja spawn — Freebuff Mob Studio',
            uuid: uuid(),
            version: [1, 0, 0],
            min_engine_version: [1, 16, 0],
        },
        modules: [
            { type: 'data', uuid: uuid(), version: [1, 0, 0] },
        ],
        dependencies: [
            { uuid: rpModuleUuid, version: [1, 0, 0] },
        ],
    };
}

function packMcmeta(name) {
    return {
        pack: {
            pack_format: 15,
            description: `Freebuff Mob Studio — ${name}`,
        },
    };
}

/** Mallin maailmankoordinaattien ulottuvuus → törmäyslaatikko. */
function modelBounds(model) {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const bone of model.bones || []) {
        for (const cube of bone.cubes || []) {
            const o = cube.origin, s = cube.size;
            if (!o || !s) continue;
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], o[i]);
                max[i] = Math.max(max[i], o[i] + s[i]);
            }
        }
    }
    if (!isFinite(min[0])) return { width: 1, height: 1 };
    const w = Math.max(0.2, Math.min(8, Math.max(max[0] - min[0], max[2] - min[2])));
    const h = Math.max(0.2, Math.min(12, max[1] - min[1]));
    return { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 };
}

/** Animaatioiden lyhyet nimet + viittaukset client-entityä varten. */
function animationEntries(animations) {
    const map = animations && animations.tracks ? { animation: animations } : (animations || {});
    const entries = {};
    const animate = [];
    for (const key of Object.keys(map)) {
        const short = key.replace(/^animation\.[^.]+\./, '') || key;
        entries[short] = key;
        animate.push(short);
    }
    return { entries, animate };
}

/** RP:n client-entity — sitoo geometrian, tekstuurit, animaatiot ja spawn-eggin. */
function bedrockEntityFile(model, id, ns, animations, eggColors) {
    const { entries, animate } = animationEntries(animations);
    const desc = {
        identifier: `${ns}:${id}`,
        materials: { default: 'entity_alphatest' },
        textures: { default: `textures/entity/${id}` },
        geometry: { default: `geometry.${id}` },
        render_controllers: ['controller.render.default'],
        spawn_egg: {
            base_color: (eggColors && eggColors.base) || '#7da06a',
            overlay_color: (eggColors && eggColors.overlay) || '#4a5f3f',
        },
    };
    if (Object.keys(entries).length) {
        desc.animations = entries;
        desc.scripts = { animate };
    }
    return {
        format_version: '1.10.0',
        'minecraft:client_entity': { description: desc },
    };
}

/** BP:n behavior-entity — peruskomponentit, joilla mobi toimii ja taistelee. */
function bedrockEntityBehavior(model, id, ns) {
    const box = modelBounds(model);
    return {
        format_version: '1.16.0',
        'minecraft:entity': {
            description: {
                identifier: `${ns}:${id}`,
                is_spawnable: true,
                is_summonable: true,
                is_experimental: false,
            },
            components: {
                'minecraft:type_family': { family: ['freebuff', 'mob'] },
                'minecraft:health': { value: 20, max: 20 },
                'minecraft:movement': { value: 0.25 },
                'minecraft:movement.basic': {},
                'minecraft:jump.static': {},
                'minecraft:collision_box': { width: box.width, height: box.height },
                'minecraft:physics': {},
                'minecraft:pushable': { is_pushable: true, is_pushable_by_piston: true },
                'minecraft:nameable': {},
                'minecraft:despawn': {
                    despawn_from_distance: { min_distance: 32, max_distance: 128 },
                },
                'minecraft:behavior.float': { priority: 0 },
                'minecraft:behavior.random_stroll': { priority: 4, speed_multiplier: 1.0 },
                'minecraft:behavior.look_at_player': { priority: 5, probability: 0.02 },
                'minecraft:behavior.hurt_by_target': { priority: 2 },
                'minecraft:behavior.melee_attack': { priority: 3, speed_multiplier: 1.0 },
                'minecraft:attack': { damage: 4 },
                'minecraft:damage_sensor': {
                    triggers: [{ cause: 'fall', deals_damage: false }],
                },
                'minecraft:scale': { value: 1.0 },
            },
        },
    };
}

/** BP:n spawn-säännöt — mobi ilmestyy overworldin pinnalle. */
function bedrockSpawnRules(id, ns) {
    return {
        format_version: '1.8.0',
        'minecraft:spawn_rules': {
            description: {
                identifier: `${ns}:${id}`,
                population_control: 'misc',
            },
            conditions: [
                {
                    'minecraft:spawns_on_surface': {},
                    'minecraft:brightness_filter': {
                        min: 0, max: 15, adjust_for_weather: false,
                    },
                    'minecraft:height_filter': { min: 0, max: 256 },
                    'minecraft:weight': { default: 10 },
                    'minecraft:herd': { min_size: 1, max_size: 3 },
                    'minecraft:biome_filter': {
                        test: 'has_biome_tag', operator: '==', value: 'overworld',
                    },
                },
            ],
        },
    };
}

function bedrockRenderControllers() {
    return {
        format_version: '1.8.0',
        render_controllers: {
            'controller.render.default': {
                geometry: 'Geometry.default',
                materials: [{ '*': 'Material.default' }],
                textures: ['Texture.default'],
            },
        },
    };
}

/** Kevyt tiedostolista esikatseluun (ei generoi PNG:tä). */
export function previewPackFiles(formats, id, ns, hasAnims, hasGlow) {
    const out = [];
    if (formats.includes('bedrock')) {
        out.push(
            'resource_pack/manifest.json',
            `resource_pack/entity/${id}.entity.json`,
            `resource_pack/models/entity/${id}.geo.json`,
            `resource_pack/textures/entity/${id}.png`,
        );
        if (hasGlow) out.push(`resource_pack/textures/entity/${id}_glow.png`);
        out.push(`resource_pack/render_controllers/${id}.render_controllers.json`);
        if (hasAnims) out.push(`resource_pack/animations/${id}.animation.json`);
        out.push(
            'behavior_pack/manifest.json',
            `behavior_pack/entities/${id}.json`,
            `behavior_pack/spawn_rules/${id}.json`,
        );
    }
    if (formats.includes('java')) {
        out.push('pack.mcmeta', `assets/${ns}/geo/${id}.geo.json`, `assets/${ns}/textures/entity/${id}.png`);
        if (hasGlow) out.push(`assets/${ns}/textures/entity/${id}_glow.png`);
        if (hasAnims) out.push(`assets/${ns}/animations/${id}.animation.json`);
        out.push(`assets/freebuff/models/item/${id}.json`, `assets/freebuff/textures/item/${id}.png`);
    }
    return out;
}

/**
 * @param model        editorin malli ({ modelId, textureWidth, textureHeight, bones })
 * @param opts.formats      ['java'] | ['bedrock'] | ['java','bedrock']
 * @param opts.namespace    modin namespace (oletus: modelId:n perusosa)
 * @param opts.projectName  paketin nimi (manifest/pack.mcmeta)
 * @param opts.animations   exportBedrockAnimations-objekti tai null (ei animaatioita)
 * @param opts.textureCanvas 2D-canvas (tai dataURL-merkkijono) tekstuurista
 * @param opts.emissiveDataURL   glow-kerroksen PNG dataURL-merkkijono (tai null)
 * @param opts.eggColors    { base, overlay } spawn-eggin värit (tai null → oletus)
 * @returns { files: [{path, data}], filePaths: [string] }
 */
export function buildResourcePack(model, opts = {}) {
    const formats = opts.formats && opts.formats.length ? opts.formats : ['java'];
    const id = (model.modelId || 'custom_mob').replace('geometry.', '');
    const ns = String(opts.namespace || id).replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/gi, '').toLowerCase() || id;
    const name = opts.projectName || id;

    const files = [];
    const png = pngBytesFromTexture(opts.textureCanvas);
    const glow = opts.emissiveDataURL ? pngBytesFromTexture(opts.emissiveDataURL) : null;
    const hasAnims = opts.animations && Object.keys(opts.animations).length > 0;

    if (formats.includes('bedrock')) {
        const rpModuleUuid = uuid();
        files.push({ path: 'resource_pack/manifest.json', data: jsonBytes(bedrockManifest(name, rpModuleUuid)) });
        files.push({ path: `resource_pack/entity/${id}.entity.json`, data: jsonBytes(bedrockEntityFile(model, id, ns, opts.animations, opts.eggColors)) });
        files.push({ path: `resource_pack/models/entity/${id}.geo.json`, data: jsonBytes(exportBedrockGeometry(model)) });
        files.push({ path: `resource_pack/render_controllers/${id}.render_controllers.json`, data: jsonBytes(bedrockRenderControllers()) });
        if (png) files.push({ path: `resource_pack/textures/entity/${id}.png`, data: png });
        if (glow) files.push({ path: `resource_pack/textures/entity/${id}_glow.png`, data: glow });
        if (hasAnims) files.push({ path: `resource_pack/animations/${id}.animation.json`, data: jsonBytes(exportJavaAnimations(model, opts.animations)) });
        // Behavior pack — mobi spawnaa pelissä
        files.push({ path: 'behavior_pack/manifest.json', data: jsonBytes(behaviorManifest(name, rpModuleUuid)) });
        files.push({ path: `behavior_pack/entities/${id}.json`, data: jsonBytes(bedrockEntityBehavior(model, id, ns)) });
        files.push({ path: `behavior_pack/spawn_rules/${id}.json`, data: jsonBytes(bedrockSpawnRules(id, ns)) });
    }

    if (formats.includes('java')) {
        files.push({ path: 'pack.mcmeta', data: jsonBytes(packMcmeta(name)) });
        files.push({ path: `assets/${ns}/geo/${id}.geo.json`, data: jsonBytes(exportBedrockGeometry(model)) });
        if (png) files.push({ path: `assets/${ns}/textures/entity/${id}.png`, data: png });
        if (glow) files.push({ path: `assets/${ns}/textures/entity/${id}_glow.png`, data: glow });
        if (hasAnims) files.push({ path: `assets/${ns}/animations/${id}.animation.json`, data: jsonBytes(exportJavaAnimations(model, opts.animations)) });
        // Vanilla Java-edition item-malli (tekstuuriviittaukset ovat freebuff-namespacessa)
        files.push({ path: `assets/freebuff/models/item/${id}.json`, data: jsonBytes(exportJavaModel(model, id)) });
        if (png) files.push({ path: `assets/freebuff/textures/item/${id}.png`, data: png });
    }

    return { files, filePaths: files.map((f) => f.path) };
}

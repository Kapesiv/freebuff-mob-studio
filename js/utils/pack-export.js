/**
 * Resurssipaketin kokoaja — kokoaa mallin, tekstuurit ja animaatiot
 * valmiiksi kansiorakenteeksi, joka menee suoraan peliin:
 *
 *   ☕ Java (GeckoLib-modit):
 *     pack.mcmeta
 *     assets/<ns>/geo/<id>.geo.json
 *     assets/<ns>/animations/<id>.animation.json
 *     assets/<ns>/textures/entity/<id>.png
 *     assets/freebuff/models/item/<id>.json        (Java-edition item-malli)
 *     assets/freebuff/textures/item/<id>.png
 *
 *   🎮 Bedrock (resurssipaketti):
 *     manifest.json
 *     models/entity/<id>.geo.json
 *     textures/entity/<id>.png
 *     animations/<id>.animation.json
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

function bedrockManifest(name) {
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
            { type: 'resources', uuid: uuid(), version: [1, 0, 0] },
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

/** Kevyt tiedostolista esikatseluun (ei generoi PNG:tä). */
export function previewPackFiles(formats, id, ns, hasAnims) {
    const out = [];
    if (formats.includes('bedrock')) {
        out.push('manifest.json', `models/entity/${id}.geo.json`, `textures/entity/${id}.png`);
        if (hasAnims) out.push(`animations/${id}.animation.json`);
    }
    if (formats.includes('java')) {
        out.push('pack.mcmeta', `assets/${ns}/geo/${id}.geo.json`, `assets/${ns}/textures/entity/${id}.png`);
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
 * @returns { files: [{path, data}], filePaths: [string] }
 */
export function buildResourcePack(model, opts = {}) {
    const formats = opts.formats && opts.formats.length ? opts.formats : ['java'];
    const id = (model.modelId || 'custom_mob').replace('geometry.', '');
    const ns = String(opts.namespace || id).replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/gi, '').toLowerCase() || id;
    const name = opts.projectName || id;

    const files = [];
    const png = pngBytesFromTexture(opts.textureCanvas);
    const hasAnims = opts.animations && Object.keys(opts.animations).length > 0;

    if (formats.includes('bedrock')) {
        files.push({ path: 'manifest.json', data: jsonBytes(bedrockManifest(name)) });
        files.push({ path: `models/entity/${id}.geo.json`, data: jsonBytes(exportBedrockGeometry(model)) });
        if (png) files.push({ path: `textures/entity/${id}.png`, data: png });
        if (hasAnims) files.push({ path: `animations/${id}.animation.json`, data: jsonBytes(exportJavaAnimations(model, opts.animations)) });
    }

    if (formats.includes('java')) {
        files.push({ path: 'pack.mcmeta', data: jsonBytes(packMcmeta(name)) });
        files.push({ path: `assets/${ns}/geo/${id}.geo.json`, data: jsonBytes(exportBedrockGeometry(model)) });
        if (png) files.push({ path: `assets/${ns}/textures/entity/${id}.png`, data: png });
        if (hasAnims) files.push({ path: `assets/${ns}/animations/${id}.animation.json`, data: jsonBytes(exportJavaAnimations(model, opts.animations)) });
        // Vanilla Java-edition item-malli (tekstuuriviittaukset ovat freebuff-namespacessa)
        files.push({ path: `assets/freebuff/models/item/${id}.json`, data: jsonBytes(exportJavaModel(model, id)) });
        if (png) files.push({ path: `assets/freebuff/textures/item/${id}.png`, data: png });
    }

    return { files, filePaths: files.map((f) => f.path) };
}

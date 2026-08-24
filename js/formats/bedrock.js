/**
 * Bedrock Edition geometry format parser and exporter.
 *
 * Supports both the classic layout (geometry.<id> with texturewidth) and the
 * modern layout (minecraft:geometry array with description).
 *
 * Coordinate convention: cube origins in .geometry.json files are absolute
 * world coordinates (this matches Mojang's vanilla files and Blockbench
 * exports). The editor stores world-space origins too, so no conversion is
 * needed — round trips are lossless.
 */

function normalizeUV(uv) {
    if (Array.isArray(uv)) {
        return { offset: [uv[0] || 0, uv[1] || 0] };
    }
    if (uv && typeof uv === 'object') {
        if (Array.isArray(uv.offset)) return { offset: uv.offset.slice() };
        // Per-face uv (modern vanilla, e.g. ghast): each face carries its own
        // { uv, uv_size }. Preserve them — computeFaceRects uses them directly.
        const faces = {};
        let perFace = false;
        for (const f of ['north', 'south', 'east', 'west', 'up', 'down']) {
            const fc = uv[f];
            if (fc && Array.isArray(fc.uv)) {
                faces[f] = { uv: fc.uv.slice(), uv_size: fc.uv_size ? fc.uv_size.slice() : null };
                perFace = true;
            }
        }
        if (perFace) return { offset: [0, 0], perFace: faces };
    }
    return { offset: [0, 0] };
}

export function parseBedrockGeometry(json) {
    let geometry = null;
    let modelId = null;

    if (Array.isArray(json['minecraft:geometry']) && json['minecraft:geometry'][0]) {
        geometry = json['minecraft:geometry'][0];
        modelId = geometry.description && geometry.description.identifier;
    } else {
        modelId = Object.keys(json).find(k => k.startsWith('geometry.')) || Object.keys(json)[0];
        geometry = json[modelId];
    }
    if (!geometry) throw new Error('No geometry found in file');

    const texW = geometry.texturewidth
        ?? geometry.texture_width
        ?? (geometry.description && geometry.description.texture_width)
        ?? 64;
    const texH = geometry.textureheight
        ?? geometry.texture_height
        ?? (geometry.description && geometry.description.texture_height)
        ?? 64;

    // Per-luu locatorit: { name: [x,y,z] } (myös rivinä [x,y,z] voi olla
    // { offset: [x,y,z] } tai rivi [x,y,z,rot]). Yksinkertaistetaan riviin.
    const locators = [];
    for (const bone of (geometry.bones || [])) {
        const ls = bone.locators || {};
        for (const [name, raw] of Object.entries(ls)) {
            const pos = Array.isArray(raw) ? raw.slice(0, 3) : (raw && raw.offset ? raw.offset.slice(0, 3) : [0, 0, 0]);
            locators.push({ name, bone: bone.name, position: pos });
        }
    }

    const bones = (geometry.bones || []).map(bone => ({
        name: bone.name,
        parent: bone.parent || null,
        pivot: bone.pivot || [0, 0, 0],
        rotation: bone.rotation || [0, 0, 0],
        cubes: (bone.cubes || [])
            .filter(c => Array.isArray(c.origin) && Array.isArray(c.size))
            .map((cube, ci) => {
                // Bedrock "inflate" laajentaa laatikkoa joka sivulta annetun määrän
                // (pelkästään renderöinnissä — tekstuuri venytetään base-mittojen
                // päälle, joten UV-laskenta käyttää edelleen base-kokoa).
                const inflate = (typeof cube.inflate === 'number' && cube.inflate !== 0) ? cube.inflate : 0;
                const parsed = {
                    name: cube.name || `${bone.name}_${ci}`,
                    origin: [cube.origin[0] - inflate, cube.origin[1] - inflate, cube.origin[2] - inflate],
                    size: [cube.size[0] + 2 * inflate, cube.size[1] + 2 * inflate, cube.size[2] + 2 * inflate],
                    rotation: cube.rotation || [0, 0, 0],
                    uv: normalizeUV(cube.uv),
                    mirror: !!cube.mirror
                };
                if (inflate) parsed.inflate = inflate;
                return parsed;
            })
    }));

    return {
        modelId,
        textureWidth: texW,
        textureHeight: texH,
        visibleBoundsWidth: geometry.visible_bounds_width || 2,
        visibleBoundsHeight: geometry.visible_bounds_height || 2,
        visibleBoundsOffset: geometry.visible_bounds_offset || [0, 0, 0],
        locators,
        bones
    };
}

export function exportBedrockGeometry(model) {
    const geometry = {
        texturewidth: model.textureWidth,
        textureheight: model.textureHeight,
        visible_bounds_width: model.visibleBoundsWidth || 2,
        visible_bounds_height: model.visibleBoundsHeight || 2,
        visible_bounds_offset: model.visibleBoundsOffset || [0, 0, 0],
        bones: model.bones.map(bone => {
            const out = {
                name: bone.name,
                ...(bone.parent ? { parent: bone.parent } : {}),
                pivot: bone.pivot,
                rotation: bone.rotation
            };
            // Locatorit: ryhmitellään luun nimen mukaan
            const boneLocators = (model.locators || []).filter(l => (l.bone || 'root') === bone.name);
            if (boneLocators.length) {
                out.locators = {};
                for (const l of boneLocators) {
                    out.locators[l.name] = [(l.position || [0, 0, 0])[0], (l.position || [0, 0, 0])[1], (l.position || [0, 0, 0])[2]];
                }
            }
            out.cubes = bone.cubes.map(cube => {
                const c = {
                    name: cube.name,
                    origin: cube.origin,       // absolute world coordinates
                    size: cube.size,
                    rotation: cube.rotation
                };
                if (cube.pivot) c.pivot = cube.pivot;
                if (cube.mirror) c.mirror = true;
                // Round-trip "inflate": kirjoita base-mitat + inflate, jotta
                // exportattu tiedosto vastaa alkuperäistä formaattia ja
                // renderöityy pelissä saman kokoisena.
                if (cube.inflate) {
                    c.origin = cube.origin.map(v => v + cube.inflate);
                    c.size = cube.size.map(v => v - 2 * cube.inflate);
                    c.inflate = cube.inflate;
                }
                if (cube.uv && (Array.isArray(cube.uv.offset) || Object.keys(cube.uv).length)) {
                    c.uv = cube.uv;
                }
                return c;
            });
            return out;
        })
    };

    return {
        [model.modelId || 'geometry.custom_mob']: geometry
    };
}

export function createEmptyModel() {
    return {
        modelId: 'geometry.custom_mob',
        textureWidth: 64,
        textureHeight: 64,
        visibleBoundsWidth: 2,
        visibleBoundsHeight: 2,
        visibleBoundsOffset: [0, 0, 0],
        locators: [],  // [{ name, bone, position: [x,y,z] }] — kiinnityspisteet
        bones: [
            {
                name: 'root',
                pivot: [0, 0, 0],
                rotation: [0, 0, 0],
                cubes: []
            }
        ]
    };
}

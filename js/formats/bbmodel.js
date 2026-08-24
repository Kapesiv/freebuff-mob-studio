/**
 * Blockbench .bbmodel importer — the format modders share on GitHub and
 * forums. Converts elements/outliner → bones & cubes, textures → data URL,
 * and animations → rotation keyframe tracks.
 *
 * Best effort: box_uv offsets, single-axis element rotations, the first
 * animation, and the first texture are imported. Enough to bring real
 * modded models in and edit them.
 */

// ==================== EXPORT (.bbmodel) ====================

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Kuution UV-offset (box_uv): cube.uv.offset tai north-rectin yläkulma. */
function cubeUVOffset(cube) {
    if (cube.uv && Array.isArray(cube.uv.offset)) return [cube.uv.offset[0], cube.uv.offset[1]];
    try {
        const rects = computeFaceRects(cube);
        const north = rects.find((r) => r.face === 'north');
        if (north) return [north.x, north.y];
    } catch { /* jätetään [0,0] */ }
    return [0, 0];
}

function cubeToElement(cube) {
    const half = cube.size.map((s) => s / 2);
    const from = cube.origin.map((o, i) => round2(o - half[i]));
    const to = cube.origin.map((o, i) => round2(o + half[i]));
    const el = {
        name: cube.name || 'cube',
        box_uv: true,
        rescale: false,
        locked: false,
        from,
        to,
        faces: {},
        type: 'cube',
        uuid: uuid(),
        mirror: !!cube.mirror,
        // Materiaali: läpinäkyvyys + emissive (Blockbenchin color-kenttä + omat)
        color: cube.color || '#ffffff',
        ...(typeof cube.opacity === 'number' ? { opacity: cube.opacity } : {}),
        ...(typeof cube.emissive === 'number' ? { emissive: cube.emissive } : {}),
    };
    const [u, v] = cubeUVOffset(cube);
    for (const f of ['north', 'east', 'south', 'west', 'up', 'down']) {
        el.faces[f] = { uv: [round2(u), round2(v)] };
    }
    // Bedrock-kuution yksiakselinen rotaatio → bbmodel-rot (origin = pivot)
    if (cube.rotation && cube.rotation.some((x) => x !== 0)) {
        const axisIdx = [0, 1, 2].find((i) => (cube.rotation[i] || 0) !== 0);
        el.rotation = {
            origin: (cube.pivot || [0, 0, 0]).map(round2),
            axis: ['x', 'y', 'z'][axisIdx],
            angle: round2(cube.rotation[axisIdx] || 0),
        };
    }
    return el;
}

/** Projektin animaatiot (frame → sekunti, 20 fps) → bbmodel-animaattorit. */
function animationsToBB(animations) {
    const out = [];
    for (const [name, anim] of Object.entries(animations || {})) {
        const animators = {};
        for (const [bone, track] of Object.entries(anim.tracks || {})) {
            const keys = {};
            for (const [frame, val] of Object.entries(track)) {
                keys[round2(parseFloat(frame) / 20)] = val.map(round2);
            }
            if (Object.keys(keys).length) animators[bone] = { rotation: keys };
        }
        if (anim.posTracks) {
            for (const [bone, track] of Object.entries(anim.posTracks)) {
                const keys = {};
                for (const [frame, val] of Object.entries(track)) {
                    keys[round2(parseFloat(frame) / 20)] = val.map(round2);
                }
                if (Object.keys(keys).length) {
                    animators[bone] = animators[bone] || {};
                    animators[bone].position = keys;
                }
            }
        }
        out.push({
            name,
            loop: 'loop',
            length: round2((anim.length || 40) / 20),
            anim_time_update: 'query.anim_time + query.delta_time',
            animators,
        });
    }
    return out;
}

/**
 * Vie mallin Blockbench .bbmodel-formaattiin (bedrock, box_uv) —
 * outliner luina + pivotit, elementit kuutioina, tekstuuri dataURL:na
 * ja animaatiot rot-/pos-keyframeina. Yhteensopiva oman importerin
 * kanssa (round-trip) ja avautuu Blockbenchissä.
 */
export function exportBBModel(model, opts = {}) {
    const id = (model.modelId || 'custom_mob').replace('geometry.', '');
    const elements = [];
    const outliner = [];
    for (const bone of model.bones || []) {
        const children = [];
        for (const cube of bone.cubes || []) {
            const el = cubeToElement(cube);
            elements.push(el);
            children.push(el.uuid);
        }
        const node = { name: bone.name, uuid: uuid(), origin: (bone.pivot || [0, 0, 0]).map(round2) };
        if (bone.rotation && bone.rotation.some((x) => x !== 0)) node.rotation = bone.rotation.map(round2);
        if (children.length) node.children = children;
        outliner.push(node);
    }
    // Locatorit: Blockbench-tyyliset outliner-solmut, joilla on pos/rot.
    // Ne eivät ole elementtejä — vain nimetyt kiinnityspisteet.
    for (const loc of model.locators || []) {
        outliner.push({
            name: loc.name,
            uuid: uuid(),
            origin: (loc.position || [0, 0, 0]).map(round2),
            locator: true,
            parent: loc.bone || 'root'
        });
    }
    return {
        meta: { format_version: '4.9', model_format: 'bedrock', box_uv: true },
        name: opts.projectName || id,
        resolution: { width: model.textureWidth || 64, height: model.textureHeight || 64 },
        elements,
        outliner,
        textures: opts.textureDataURL ? [{
            name: id,
            id: uuid(),
            source: opts.textureDataURL,
            resolution: { width: model.textureWidth || 64, height: model.textureHeight || 64 },
            uv_width: model.textureWidth || 64,
            uv_height: model.textureHeight || 64,
        }] : [],
        animations: animationsToBB(opts.animations),
        id: uuid(),
    };
}

export function parseBBModel(json) {
    const model = {
        modelId: json.name ? `geometry.${json.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : 'geometry.imported_mob',
        textureWidth: (json.resolution && json.resolution.width) || 64,
        textureHeight: (json.resolution && json.resolution.height) || 64,
        bones: [],
        source: 'bbmodel'
    };

    const elements = new Map();
    for (const el of (json.elements || [])) {
        if (el.uuid) elements.set(el.uuid, el);
    }

    // ---- outliner → bones + cubes ------------------------------------
    const rootPivot = [0, 0, 0];

    function buildNode(node, parentPivot) {
        if (typeof node === 'string') return null;  // uuid reference
        const nodeName = node.name || 'bone';
        const isGroup = Array.isArray(node.children) && node.children.length > 0;
        const pivot = Array.isArray(node.origin) ? node.origin.slice() : parentPivot.slice();

        if (!isGroup) {
            // A single element as its own node → cube in a generated bone
            const el = elements.get(node.uuid);
            if (!el) return null;
            const bone = { name: nodeName, pivot, rotation: [0, 0, 0], cubes: [] };
            const cube = elementToCube(el, pivot);
            if (cube) bone.cubes.push(cube);
            return bone;
        }

        const bone = { name: nodeName, pivot, rotation: [0, 0, 0], cubes: [] };
        for (const child of node.children) {
            const resolved = resolveChild(child, elements);
            if (resolved && resolved.element) {
                const cube = elementToCube(resolved.element, pivot);
                if (cube) bone.cubes.push(cube);
            } else if (resolved && resolved.node) {
                const sub = buildNode(resolved.node, pivot);
                if (sub) {
                    // Flatten nested groups into this bone's cubes by merging
                    if (sub.cubes.length) bone.cubes.push(...sub.cubes);
                }
            }
        }
        return bone;
    }

    // Walk the outliner; a bone may contain elements directly or via uuid refs
    function resolveChild(child, elementMap) {
        if (typeof child === 'string') {
            const el = elementMap.get(child);
            return el ? { element: el } : { node: null };
        }
        if (child && typeof child === 'object') {
            if (child.uuid && elementMap.has(child.uuid) && !Array.isArray(child.children)) {
                return { element: elementMap.get(child.uuid) };
            }
            return { node: child };
        }
        return null;
    }

    for (const node of (json.outliner || [])) {
        const bone = buildNode(node, rootPivot);
        if (bone && (bone.cubes.length || json.outliner.length === 1)) {
            model.bones.push(bone);
        }
    }

    // Fallback: elements not placed in the outliner → all in root
    if (model.bones.length === 0) {
        model.bones.push({ name: 'root', pivot: rootPivot, rotation: [0, 0, 0], cubes: [] });
        for (const el of (json.elements || [])) {
            const cube = elementToCube(el, rootPivot);
            if (cube) model.bones[0].cubes.push(cube);
        }
    }

    // ---- locators ----------------------------------------------------
    // Blockbench-tyyliset outliner-solmut { locator: true, origin, parent }
    model.locators = [];
    for (const node of (json.outliner || [])) {
        if (node && node.locator) {
            model.locators.push({
                name: node.name || 'locator',
                bone: node.parent || 'root',
                position: Array.isArray(node.origin) ? node.origin.slice(0, 3) : [0, 0, 0]
            });
        }
    }

    // ---- texture ------------------------------------------------------
    const texture = (json.textures || []).find(t => t.source);
    let textureDataURL = null;
    if (texture && typeof texture.source === 'string') {
        textureDataURL = texture.source;
    }

    // ---- animation (first one) ---------------------------------------
    let animation = null;
    const anim = (json.animations || [])[0];
    if (anim && anim.animators) {
        const tracks = {};
        for (const [boneName, animator] of Object.entries(anim.animators)) {
            const rotKeys = animator.rotation;
            if (!rotKeys || typeof rotKeys !== 'object') continue;
            const track = {};
            for (const [timeStr, val] of Object.entries(rotKeys)) {
                if (!Array.isArray(val)) continue;
                const frame = Math.round(parseFloat(timeStr) * 20);
                track[frame] = [val[0] || 0, val[1] || 0, val[2] || 0];
            }
            if (Object.keys(track).length) tracks[boneName] = track;
        }
        if (Object.keys(tracks).length) {
            animation = {
                length: Math.max(1, Math.round((anim.length || 2) * 20)),
                tracks
            };
        }
    }

    return { model, textureDataURL, animation };
}

function elementToCube(el, bonePivot) {
    if (!Array.isArray(el.from) || !Array.isArray(el.to)) return null;
    const from = el.from.map(Number);
    const to = el.to.map(Number);
    const size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    if (size.some(s => s <= 0)) return null;

    // Center in world space (bedrock format)
    const center = [
        (from[0] + to[0]) / 2,
        (from[1] + to[1]) / 2,
        (from[2] + to[2]) / 2
    ];

    // Single-axis element rotation
    let rotation = [0, 0, 0];
    let pivot = null;
    if (el.rotation && typeof el.rotation.angle === 'number' && el.rotation.angle !== 0) {
        const axis = (el.rotation.axis || 'x').toLowerCase();
        const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        rotation[idx] = el.rotation.angle;
        if (Array.isArray(el.rotation.origin)) {
            pivot = el.rotation.origin.map(Number);
        }
    }

    // UV offset from the box (box_uv layout); fallback to north face
    let uvOffset = [0, 0];
    if (el.faces) {
        const probe = el.faces.north || el.faces.east || el.faces.south || el.faces.up;
        if (probe && Array.isArray(probe.uv)) {
            uvOffset = [probe.uv[0] || 0, probe.uv[1] || 0];
        }
    }

    const cube = {
        name: (el.name || 'cube').replace(/[^a-zA-Z0-9_]+/g, '_'),
        origin: center.map(v => Math.round(v * 100) / 100),
        size,
        rotation,
        uv: { offset: uvOffset },
        mirror: !!el.mirror,
        color: el.color || '#ffffff'
    };
    if (typeof el.opacity === 'number') cube.opacity = Math.max(0.05, Math.min(1, el.opacity));
    if (typeof el.emissive === 'number') cube.emissive = Math.max(0, Math.min(3, el.emissive));
    if (pivot) cube.pivot = pivot;
    return cube;
}

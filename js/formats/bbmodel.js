/**
 * Blockbench .bbmodel importer — the format modders share on GitHub and
 * forums. Converts elements/outliner → bones & cubes, textures → data URL,
 * and animations → rotation keyframe tracks.
 *
 * Best effort: box_uv offsets, single-axis element rotations, the first
 * animation, and the first texture are imported. Enough to bring real
 * modded models in and edit them.
 */

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
        mirror: !!el.mirror
    };
    if (pivot) cube.pivot = pivot;
    return cube;
}

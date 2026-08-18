/**
 * Box UV layout shared between the 3D view and the 2D UV editor.
 *
 * Uses the exact Minecraft/Blockbench box UV layout (Blockbench
 * `face_data`), which is what vanilla Bedrock geometry expects. For a cube
 * of size (w, h, d) with UV origin (u0, v0) in texture pixels:
 *
 *   east  -> (u0,         v0 + d)     d x h
 *   up    -> (u0 + d,     v0)         w x d
 *   north -> (u0 + d,     v0 + d)     w x h
 *   down  -> (u0 + d + w, v0)         w x d
 *   west  -> (u0 + d + w, v0 + d)     d x h
 *   south -> (u0 + 2d + w, v0 + d)    w x h
 *
 * This matches the vanilla steve skin layout (right, front, left, back in
 * a row, with top above and bottom to the right of top).
 */

export const FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north'];

/**
 * Returns the 6 face rects for a cube, in texture pixel coordinates.
 * Each rect: { face, x, y, w, h }.
 * If the cube carries per-face offsets (cube.uv.faces), they are applied.
 */
export function computeFaceRects(cube) {
    // Bedrock "inflate" kasvattaa renderöityä laatikkoa, mutta tekstuurin
    // asettelu on tehty base-mitoilla — siksi UV-rectit lasketaan base-koosta
    // ja peli/3D-näkymä venyttää tekstuurin inflated-laatikon päälle.
    const inf = cube.inflate || 0;
    // UV-rectit on piirretty alkuperäisen (skaalaamattoman) kuution koolle —
    // uvSize säilyttää sen, kun mallia on skaalattu (esim. Weaver of Souls).
    const size = cube.uvSize || cube.size;
    const w = size[0] - 2 * inf;
    const h = size[1] - 2 * inf;
    const d = size[2] - 2 * inf;
    const u0 = (cube.uv && cube.uv.offset) ? cube.uv.offset[0] : 0;
    const v0 = (cube.uv && cube.uv.offset) ? cube.uv.offset[1] : 0;

    const base = {
        east:  { x: u0,             y: v0 + d,     w: d, h: h },
        up:    { x: u0 + d,         y: v0,         w: w, h: d },
        north: { x: u0 + d,         y: v0 + d,     w: w, h: h },
        down:  { x: u0 + d + w,     y: v0,         w: w, h: d },
        west:  { x: u0 + d + w,     y: v0 + d,     w: d, h: h },
        south: { x: u0 + 2 * d + w, y: v0 + d,     w: w, h: h }
    };

    // Modern vanilla per-face UVs: each face has an explicit uv + uv_size.
    // Use those directly (they may differ from the cube size, e.g. ghast).
    const perFace = (cube.uv && cube.uv.perFace) ? cube.uv.perFace : null;
    if (perFace) {
        return FACE_ORDER.map(face => {
            const fc = perFace[face];
            if (!fc) return { ...base[face], face };
            const [uw, uh] = fc.uv_size || [w, h];
            const rw = Math.abs(uw);
            const rh = Math.abs(uh);
            const rx = uw >= 0 ? fc.uv[0] : fc.uv[0] + uw;
            const ry = uh >= 0 ? fc.uv[1] : fc.uv[1] + uh;
            return { face, x: rx, y: ry, w: rw, h: rh };
        });
    }

    // Apply per-face offsets
    const faceOffsets = (cube.uv && cube.uv.faces) ? cube.uv.faces : {};
    return FACE_ORDER.map(face => {
        const r = { ...base[face], face };
        const off = faceOffsets[face];
        if (off) {
            r.x += off[0];
            r.y += off[1];
        }
        return r;
    });
}

/**
 * three.js BoxGeometry vertex layout (indexed, 1 segment per face):
 * each face group has 4 unique vertices at index offsets [0, 2, 1, 4]
 * (the two triangles are (A,C,B) and (C,D,B)), at local positions:
 *   A = (-w/2, -h/2)   B = (+w/2, -h/2)   C = (-w/2, +h/2)   D = (+w/2, +h/2)
 *
 * Verified empirically against the Minecraft/vanilla box UV convention:
 * the rect corner TL goes to A, TR to B, BL to C, BR to D on every face
 * (three.js's vertex layout plus the flipY texture already handle the
 * per-face world orientation, so no per-face table is needed).
 */

/**
 * Reassigns the UVs of a BoxGeometry so each face maps to its rect.
 * The UV attribute is indexed the same way as the position attribute, so
 * we must write through the INDEX array, not the group start.
 */
export function applyBoxTextureUVs(geo, cube, texW, texH) {
    const rects = computeFaceRects(cube);
    const uvAttr = geo.attributes.uv;
    const idx = geo.index ? geo.index.array : null;

    // Vertex index offsets within one face group (unique vertices A, B, C, D).
    const GROUP_VERTS = [0, 2, 1, 4];

    for (let gi = 0; gi < geo.groups.length && gi < rects.length; gi++) {
        const g = geo.groups[gi];
        const r = rects[gi];
        // A->TL, B->TR, C->BL, D->BR
        const corners = [
            [r.x, r.y],
            [r.x + r.w, r.y],
            [r.x, r.y + r.h],
            [r.x + r.w, r.y + r.h]
        ];
        for (let k = 0; k < 4; k++) {
            const vid = idx ? idx[g.start + GROUP_VERTS[k]] : g.start + k;
            const c = corners[k];
            uvAttr.setXY(vid, c[0] / texW, 1 - c[1] / texH);
        }
    }
    uvAttr.needsUpdate = true;
}

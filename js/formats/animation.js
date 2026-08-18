/**
 * Animation exporters.
 *
 * - Bedrock: .animation.json (format_version 1.8.0) — the exact format the
 *   Bedrock engine reads for entity animations (bones + rotation keyframes
 *   in seconds).
 * - Java: GeckoLib-compatible animation file. GeckoLib (the standard Java
 *   mod animation library) loads the SAME .animation.json structure, so a
 *   single JSON works for both — this exporter just re-exports it under the
 *   Java/GeckoLib convention.
 *
 * Keyframes are stored in frames at 20 fps (Minecraft standard); the export
 * converts them to seconds.
 */

const FPS = 20;

function toSeconds(frame) {
    return Math.round((frame / FPS) * 1000) / 1000;
}

/** One animation object (state.animation): { length, tracks, loop? } -> keyframes in seconds. */
function bonesFromTracks(tracks) {
    const bones = {};
    for (const [boneName, track] of Object.entries(tracks || {})) {
        const frames = Object.keys(track).map(Number).sort((a, b) => a - b);
        if (frames.length === 0) continue;
        const rotation = {};
        for (const frame of frames) {
            const values = track[frame] || [0, 0, 0];
            rotation[String(toSeconds(frame))] = values.map(v => Math.round(v * 1000) / 1000);
        }
        bones[boneName] = { rotation };
    }
    return bones;
}

/**
 * Convert one editor animation to a Bedrock-style animation entry.
 * @param {object} animation editor animation ({ length, tracks, loop? })
 */
function bedrockAnimationEntry(animation) {
    return {
        loop: animation.loop !== undefined ? !!animation.loop : true,
        animation_length: toSeconds(animation.length || 0),
        bones: bonesFromTracks(animation.tracks)
    };
}

/**
 * Export one or more animations as a single .animation.json file.
 *
 * @param model       editor model ({ modelId })
 * @param animations  map of name -> animation ({ length, tracks, loop? })
 *                    OR a single animation object (exported under `animation`)
 * @returns the .animation.json object
 */
export function exportBedrockAnimations(model, animations) {
    const base = (model.modelId || 'custom_mob').replace('geometry.', '');
    const map = {};
    if (animations && animations.tracks) {
        // Single animation object
        map[`animation.${base}.animation`] = bedrockAnimationEntry(animations);
    } else {
        for (const [name, anim] of Object.entries(animations || {})) {
            map[`animation.${base}.${name}`] = bedrockAnimationEntry(anim);
        }
    }
    return {
        format_version: '1.8.0',
        animations: map
    };
}

/** Java/GeckoLib — same JSON format as Bedrock. */
export function exportJavaAnimations(model, animations) {
    return exportBedrockAnimations(model, animations);
}

/** Backwards-compatible single-animation export. */
export function exportBedrockAnimation(model, animation, name = 'idle') {
    const base = (model.modelId || 'custom_mob').replace('geometry.', '');
    return {
        format_version: '1.8.0',
        animations: {
            [`animation.${base}.${name}`]: bedrockAnimationEntry(animation)
        }
    };
}

/** Java/GeckoLib — same JSON format as Bedrock. */
export function exportJavaAnimation(model, animation, name = 'idle') {
    return exportBedrockAnimation(model, animation, name);
}

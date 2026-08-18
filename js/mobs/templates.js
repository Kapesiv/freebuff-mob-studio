/**
 * New-mob templates — ready-made skeletons to start building from.
 * Each template is a plain model ({ modelId, textureWidth/Height, bones })
 * with per-part base colors. The texture is auto-generated from cube colors
 * by ensureTexture(), so no image data is needed.
 */

/** Helper to build a bone with cubes. */
function bone(name, pivot, cubes, parent) {
    return { name, pivot, rotation: [0, 0, 0], cubes, ...(parent ? { parent } : {}) };
}

/** Helper to build a cube. */
function c(name, origin, size, uv, color, mirror) {
    return {
        name, origin, size,
        rotation: [0, 0, 0],
        uv: { offset: uv },
        color,
        ...(mirror ? { mirror: true } : {})
    };
}

export const MOB_TEMPLATES = [
    {
        id: 'humanoid',
        name: 'Humanoid',
        emoji: '🧍',
        description: 'Ihmishahmo — steve-tyylinen perusta, 5 osaa',
        model: {
            modelId: 'geometry.template_humanoid',
            textureWidth: 64,
            textureHeight: 64,
            visibleBoundsWidth: 1,
            visibleBoundsHeight: 2,
            visibleBoundsOffset: [0, 0, 0],
            bones: [
                bone('body', [0, 12, 0], [
                    c('body', [-4, 12, -2], [8, 12, 4], [16, 16], '#3b8eea'),
                    c('head', [-4, 24, -4], [8, 8, 8], [0, 0], '#c68642'),
                    c('right_arm', [-8, 12, -2], [4, 12, 4], [40, 16], '#3b8eea'),
                    c('left_arm', [4, 12, -2], [4, 12, 4], [40, 16], '#3b8eea', true),
                    c('right_leg', [-4, 0, -2], [4, 12, 4], [0, 16], '#2f5d94'),
                    c('left_leg', [0, 0, -2], [4, 12, 4], [0, 16], '#2f5d94', true)
                ])
            ]
        }
    },
    {
        id: 'quadruped',
        name: 'Quadruped',
        emoji: '🐄',
        description: 'Nelijalkainen — lehmä/sika-tyylinen, 6 osaa',
        model: {
            modelId: 'geometry.template_quadruped',
            textureWidth: 64,
            textureHeight: 32,
            visibleBoundsWidth: 1,
            visibleBoundsHeight: 1,
            visibleBoundsOffset: [0, 0, 0],
            bones: [
                bone('body', [0, 10, 0], [
                    c('body', [-5, 8, -6], [10, 8, 14], [0, 8], '#c98a4b'),
                    c('head', [-3, 9, -8], [6, 6, 6], [0, 0], '#c98a4b'),
                    c('right_front_leg', [-5, 1, -4], [4, 6, 4], [0, 22], '#9a6832'),
                    c('left_front_leg', [1, 1, -4], [4, 6, 4], [0, 22], '#9a6832', true),
                    c('right_back_leg', [-5, 1, 2], [4, 6, 4], [20, 22], '#9a6832'),
                    c('left_back_leg', [1, 1, 2], [4, 6, 4], [20, 22], '#9a6832', true)
                ])
            ]
        }
    },
    {
        id: 'bird',
        name: 'Bird',
        emoji: '🐔',
        description: 'Lintu — kana-tyylinen, 7 osaa',
        model: {
            modelId: 'geometry.template_bird',
            textureWidth: 64,
            textureHeight: 32,
            visibleBoundsWidth: 1,
            visibleBoundsHeight: 1,
            visibleBoundsOffset: [0, 0, 0],
            bones: [
                bone('body', [0, 7, 0], [
                    c('body', [-3, 7, -3], [6, 7, 6], [0, 8], '#f4f4f4'),
                    c('head', [-2, 10, -2], [4, 4, 4], [0, 0], '#f4f4f4'),
                    c('beak', [-1, 9, -4], [2, 1, 1], [20, 0], '#e8a33d'),
                    c('comb', [-1, 14, -1], [2, 1, 2], [14, 0], '#d1495b'),
                    c('right_wing', [-5, 7, -3], [2, 5, 6], [28, 0], '#e8e8e8', true),
                    c('left_wing', [3, 7, -3], [2, 5, 6], [28, 0], '#e8e8e8'),
                    c('right_leg', [-1, 0, -1], [1, 4, 1], [0, 22], '#e8a33d'),
                    c('left_leg', [1, 0, -1], [1, 4, 1], [4, 22], '#e8a33d')
                ])
            ]
        }
    },
    {
        id: 'fish',
        name: 'Fish',
        emoji: '🐟',
        description: 'Kala — turska-tyylinen, 4 osaa',
        model: {
            modelId: 'geometry.template_fish',
            textureWidth: 32,
            textureHeight: 32,
            visibleBoundsWidth: 1,
            visibleBoundsHeight: 1,
            visibleBoundsOffset: [0, 0, 0],
            bones: [
                bone('body', [0, 2, 0], [
                    c('body', [-2, 0, -4], [4, 3, 8], [0, 0], '#8d6e63'),
                    c('tail', [-2, 0, 4], [4, 3, 2], [0, 11], '#8d6e63'),
                    c('top_fin', [-1, 3, -3], [2, 1, 6], [12, 0], '#a1887f'),
                    c('side_fin', [-3, 1, 0], [1, 2, 2], [12, 7], '#a1887f')
                ])
            ]
        }
    },
    {
        id: 'spider',
        name: 'Spider',
        emoji: '🕷️',
        description: 'Hämähäkki — 3 osaa, 8 jalkaa',
        model: {
            modelId: 'geometry.template_spider',
            textureWidth: 64,
            textureHeight: 32,
            visibleBoundsWidth: 1,
            visibleBoundsHeight: 1,
            visibleBoundsOffset: [0, 0, 0],
            bones: [
                bone('body', [0, 4, 0], [
                    c('cephalothorax', [-2, 3, -3], [4, 3, 4], [0, 0], '#2b2b2b'),
                    c('abdomen', [-3, 3, 1], [6, 4, 6], [0, 7], '#1f1f1f')
                ]),
                bone('legs', [0, 3, 0], [
                    c('right_leg0', [-4, 2, -3], [1, 1, 5], [18, 0], '#1c1c1c'),
                    c('right_leg1', [-4, 2, -1], [1, 1, 5], [18, 6], '#1c1c1c'),
                    c('right_leg2', [-4, 2, 1], [1, 1, 5], [18, 12], '#1c1c1c'),
                    c('right_leg3', [-4, 2, 3], [1, 1, 5], [18, 18], '#1c1c1c'),
                    c('left_leg0', [3, 2, -3], [1, 1, 5], [24, 0], '#1c1c1c'),
                    c('left_leg1', [3, 2, -1], [1, 1, 5], [24, 6], '#1c1c1c'),
                    c('left_leg2', [3, 2, 1], [1, 1, 5], [24, 12], '#1c1c1c'),
                    c('left_leg3', [3, 2, 3], [1, 1, 5], [24, 18], '#1c1c1c')
                ])
            ]
        }
    }
];

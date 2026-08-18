/**
 * A starter example mob — a small humanoid built with bones and cubes,
 * ready to be posed, recolored and exported.
 *
 * All cube origins are world-space. Y is up; ground at y = 0.
 * Each cube gets a distinct UV offset so faces don't overlap in the
 * 64x64 texture (like Blockbench auto-layouts new cubes).
 */
export function createExampleMob() {
    return {
        modelId: 'geometry.example_mob',
        textureWidth: 64,
        textureHeight: 64,
        visibleBoundsWidth: 2,
        visibleBoundsHeight: 2,
        visibleBoundsOffset: [0, 0, 0],
        bones: [
            {
                name: 'root',
                pivot: [0, 0, 0],
                rotation: [0, 0, 0],
                cubes: [
                    {
                        name: 'body',
                        origin: [0, 16, 0],
                        size: [8, 8, 4],
                        rotation: [0, 0, 0],
                        color: '#3fb950',
                        uv: { offset: [0, 0] },
                        mirror: false
                    }
                ]
            },
            {
                name: 'head',
                pivot: [0, 28, 0],
                rotation: [0, 0, 0],
                cubes: [
                    {
                        name: 'head',
                        origin: [0, 24, 0],
                        size: [8, 8, 8],
                        rotation: [0, 0, 0],
                        color: '#d29922',
                        uv: { offset: [32, 0] },
                        mirror: false
                    }
                ]
            },
            {
                name: 'left_arm',
                pivot: [-6, 22, 0],
                rotation: [0, 0, 0],
                cubes: [
                    {
                        name: 'left_arm',
                        origin: [-6, 16, 0],
                        size: [4, 8, 4],
                        rotation: [0, 0, 0],
                        color: '#58a6ff',
                        uv: { offset: [0, 16] },
                        mirror: false
                    }
                ]
            },
            {
                name: 'right_arm',
                pivot: [6, 22, 0],
                rotation: [0, 0, 0],
                cubes: [
                    {
                        name: 'right_arm',
                        origin: [6, 16, 0],
                        size: [4, 8, 4],
                        rotation: [0, 0, 0],
                        color: '#58a6ff',
                        uv: { offset: [20, 16] },
                        mirror: false
                    }
                ]
            },
            {
                name: 'left_leg',
                pivot: [-3, 8, 0],
                rotation: [0, 0, 0],
                cubes: [
                    {
                        name: 'left_leg',
                        origin: [-3, 4, 0],
                        size: [4, 8, 4],
                        rotation: [0, 0, 0],
                        color: '#f85149',
                        uv: { offset: [0, 32] },
                        mirror: false
                    }
                ]
            },
            {
                name: 'right_leg',
                pivot: [3, 8, 0],
                rotation: [0, 0, 0],
                cubes: [
                    {
                        name: 'right_leg',
                        origin: [3, 4, 0],
                        size: [4, 8, 4],
                        rotation: [0, 0, 0],
                        color: '#f85149',
                        uv: { offset: [20, 32] },
                        mirror: false
                    }
                ]
            }
        ]
    };
}

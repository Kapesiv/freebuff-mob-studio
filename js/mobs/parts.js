/**
 * Spore-tyylinen osapaletti — valmiita osia (jalat, päät, hännät, siivet…),
 * jotka voi kiinnittää mihin tahansa malliin yhdellä klikkauksella.
 *
 * Osat on määritelty paikallisessa koordinaatistossa: kiinnityspiste on
 * origossa (0,0,0) ja osa "roikkuu" siitä. `attach` kertoo mihin luuhun
 * (`bone`) ja mihin kohtaan (`at`: bottom/top/front/back/side) se kiinnittyy.
 * `symmetric: true` lisää osan myös peilikuvana vastakkaiselle puolelle.
 */

function pb(name, pivot, cubes, extra = {}) {
    return { name, pivot, rotation: [0, 0, 0], cubes, ...extra };
}

function pc(name, origin, size, color, rotation = [0, 0, 0]) {
    return { name, origin, size, rotation, uv: { offset: [0, 0] }, color };
}

export const MOB_PARTS = [
    // ==================== JALAT ====================
    {
        id: 'leg_short', name: 'Lyhyt jalka', emoji: '🦵', category: 'jalat',
        symmetric: true, attach: { bone: 'body', at: 'bottom' },
        bones: [
            pb('leg', [0, 0, 0], [
                pc('leg', [-1.5, -5, -1.5], [3, 5, 3], '#8a6f4d')
            ])
        ]
    },
    {
        id: 'leg_long', name: 'Pitkä jalka', emoji: '🦿', category: 'jalat',
        symmetric: true, attach: { bone: 'body', at: 'bottom' },
        bones: [
            pb('leg', [0, 0, 0], [
                pc('leg', [-1, -9, -1], [2, 9, 2], '#7a5c3e')
            ])
        ]
    },
    {
        id: 'leg_paw', name: 'Tassu', emoji: '🐾', category: 'jalat',
        symmetric: true, attach: { bone: 'body', at: 'bottom' },
        // Nivelöity: jalka + tassu (pivot nilkassa) — tassu koukistuu kävelyssä
        bones: [
            pb('leg', [0, 0, 0], [
                pc('leg', [-1.5, -4, -1.5], [3, 4, 3], '#8a6f4d')
            ]),
            pb('foot', [0, -4, 0], [
                pc('foot', [-2, -6, -3], [4, 2, 4], '#6e553a')
            ])
        ]
    },
    {
        id: 'leg_bird', name: 'Lintujalka', emoji: '🦩', category: 'jalat',
        symmetric: true, attach: { bone: 'body', at: 'bottom' },
        // Nivelöity: reisi + jalkaterä (pivot nilkassa)
        bones: [
            pb('leg', [0, 0, 0], [
                pc('leg', [-0.5, -6, -0.5], [1, 6, 1], '#d9a04a')
            ]),
            pb('foot', [0, -6, 0], [
                pc('foot', [-1.5, -7, -3], [3, 1, 3], '#d9a04a')
            ])
        ]
    },
    {
        id: 'leg_spider', name: 'Hämähäkkijalka', emoji: '🕷️', category: 'jalat',
        symmetric: true, attach: { bone: 'body', at: 'side' },
        // Nivelöity: reisi + sääri — sääri ojentuu hiipimisessä
        bones: [
            pb('leg', [0, 0, 0], [
                pc('leg', [-0.5, -1, -0.5], [1, 2, 1], '#2b2b2b')
            ]),
            pb('leg2', [0, -1, 0], [
                pc('leg2', [-0.5, -2, -4], [1, 1.5, 4], '#1f1f1f', [-15, 0, 0])
            ])
        ]
    },
    {
        id: 'tentacle', name: 'Lonkero', emoji: '🐙', category: 'jalat',
        symmetric: false, attach: { bone: 'body', at: 'bottom' },
        // Nivelöity: lonkero taipuu kahdesta nivelenpäästä — idlessä aaltoilee
        bones: [
            pb('tentacle', [0, 0, 0], [
                pc('t1', [-1, -3, -1], [2, 3, 2], '#b06a4a')
            ]),
            pb('t2', [0, -3, 0], [
                pc('t2', [-0.75, -6, -0.75], [1.5, 3, 1.5], '#9a5a3e')
            ])
        ]
    },

    // ==================== KÄDET ====================
    {
        id: 'arm', name: 'Käsi', emoji: '💪', category: 'kädet',
        symmetric: true, attach: { bone: 'body', at: 'side' },
        bones: [
            pb('arm', [0, 0, 0], [
                pc('arm', [-1.5, -5, -1.5], [3, 5, 3], '#3b8eea')
            ])
        ]
    },
    {
        id: 'arm_claw', name: 'Kynsikäsi', emoji: '🦞', category: 'kädet',
        symmetric: true, attach: { bone: 'body', at: 'side' },
        // Nivelöity: käsivarsi + kynsi (pivot ranteessa) — kynsi nytkähtää iskussa
        bones: [
            pb('arm', [0, 0, 0], [
                pc('arm', [-1, -4, -1], [2, 4, 2], '#7a5c3e')
            ]),
            pb('claw', [0, -4, 0], [
                pc('claw', [-1, -5.5, -2.5], [2, 1.5, 2], '#d8d0c0', [0, 0, -20])
            ])
        ]
    },

    // ==================== PÄÄT & KASVOT ====================
    {
        id: 'head_round', name: 'Pyöreä pää', emoji: '🗿', category: 'päät',
        symmetric: false, attach: { bone: 'head', at: 'top' },
        bones: [
            pb('head', [0, 0, 0], [
                pc('head', [-4, 0, -4], [8, 8, 8], '#c68642')
            ])
        ]
    },
    {
        id: 'snout', name: 'Kuono', emoji: '👃', category: 'päät',
        symmetric: false, attach: { bone: 'head', at: 'front' },
        bones: [
            pb('snout', [0, 0, 0], [
                pc('snout', [-2, 1, -3], [4, 2, 3], '#c68642')
            ])
        ]
    },
    {
        id: 'horn', name: 'Sarvet', emoji: '🐐', category: 'päät',
        symmetric: true, attach: { bone: 'head', at: 'top' },
        // Nivelöity: sarvi + kärki (pivot kärjen tyvessä) — kärki huojuu kevyesti
        bones: [
            pb('horn', [0, 0, 0], [
                pc('horn', [0.5, 0, -0.5], [1, 4, 1], '#d8d0c0', [0, 0, -8])
            ]),
            pb('horn_tip', [0, 4, 0], [
                pc('horn_tip', [0.5, 4, -0.5], [0.75, 2, 0.75], '#e8e0d0', [0, 0, -8])
            ])
        ]
    },
    {
        id: 'eye_big', name: 'Isot silmät', emoji: '👀', category: 'päät',
        symmetric: true, attach: { bone: 'head', at: 'front' },
        bones: [
            pb('eye', [0, 0, 0], [
                pc('eye', [0.5, 1.5, -1], [1.5, 1.5, 1], '#f5f5f5'),
                pc('pupil', [1, 2, -1.75], [0.5, 0.5, 0.75], '#1a1a1a')
            ])
        ]
    },
    {
        id: 'fangs', name: 'Kulmahampaat', emoji: '🦷', category: 'päät',
        symmetric: false, attach: { bone: 'head', at: 'front' },
        bones: [
            pb('fang', [0, 0, 0], [
                pc('fang_l', [-2, -0.5, -0.75], [0.75, 1.5, 0.75], '#f5f5f0'),
                pc('fang_r', [1.25, -0.5, -0.75], [0.75, 1.5, 0.75], '#f5f5f0')
            ])
        ]
    },
    {
        id: 'beak', name: 'Nokka', emoji: '🐤', category: 'päät',
        symmetric: false, attach: { bone: 'head', at: 'front' },
        bones: [
            pb('beak', [0, 0, 0], [
                pc('beak', [-1.5, 1, -3], [3, 1.5, 3], '#e8a33d', [0, 0, 0])
            ])
        ]
    },

    // ==================== HÄNNÄT ====================
    {
        id: 'tail_short', name: 'Töpöhäntä', emoji: '🐰', category: 'hännät',
        symmetric: false, attach: { bone: 'body', at: 'back' },
        bones: [
            pb('tail', [0, 0, 0], [
                pc('tail', [-1.5, -1, 0], [3, 3, 3], '#c9a27b')
            ])
        ]
    },
    {
        id: 'tail_long', name: 'Pitkä häntä', emoji: '🐍', category: 'hännät',
        symmetric: false, attach: { bone: 'body', at: 'back' },
        // Nivelöity: tyvi + kärkiosa — aalto kulkee pitkin häntää
        bones: [
            pb('tail', [0, 0, 0], [
                pc('tail1', [-1, -1, 0], [2, 2, 3], '#8a6f4d')
            ]),
            pb('tail_tip', [0, 0, 3], [
                pc('tail2', [-0.75, 0.5, 3], [1.5, 1.5, 3], '#7a5c3e', [0, 0, 12])
            ])
        ]
    },
    {
        id: 'tail_spike', name: 'Piikkihäntä', emoji: '🦖', category: 'hännät',
        symmetric: false, attach: { bone: 'body', at: 'back' },
        // Nivelöity: tyvi + piikit — piikit huojuvat hännän heilunnan mukaan
        bones: [
            pb('tail', [0, 0, 0], [
                pc('tail1', [-1.5, -1.5, 0], [3, 3, 2.5], '#6b7a3a')
            ]),
            pb('spikes', [0, 1.5, 0], [
                pc('spike1', [-0.5, 1.5, 0], [1, 3, 1], '#d8d0c0', [0, 0, 10]),
                pc('spike2', [-0.5, 0.5, 2], [1, 2.5, 1], '#d8d0c0', [0, 0, 10])
            ])
        ]
  },

    // ==================== SIIVET ====================
    {
        id: 'wing_bat', name: 'Lepakkosiipi', emoji: '🦇', category: 'siivet',
        symmetric: true, attach: { bone: 'body', at: 'side' },
        bones: [
            pb('wing', [0, 0, 0], [
                pc('wing', [0, -0.5, -5], [1.5, 0.75, 6], '#3a3550', [0, 0, -18]),
                pc('wing2', [0, -0.75, -8], [1.25, 0.6, 3.5], '#3a3550', [0, 0, -30])
            ])
        ]
    },
    {
        id: 'wing_bird', name: 'Lintusiipi', emoji: '🪽', category: 'siivet',
        symmetric: true, attach: { bone: 'body', at: 'side' },
        bones: [
            pb('wing', [0, 0, 0], [
                pc('wing', [0, -0.5, -3], [1.5, 0.75, 4], '#e8e8e8', [0, 0, -12]),
                pc('feather', [0, -0.75, -4.5], [1.25, 0.5, 2], '#d0d0d0', [0, 0, -20])
            ])
        ]
    },
    {
        id: 'fin', name: 'Evä', emoji: '🐠', category: 'siivet',
        symmetric: true, attach: { bone: 'body', at: 'side' },
        bones: [
            pb('fin', [0, 0, 0], [
                pc('fin', [0, 0, -2], [1, 2.5, 3], '#a1887f', [0, 0, -15])
            ])
        ]
    },

    // ==================== MUUT ====================
    {
        id: 'spike_back', name: 'Selkäpiikit', emoji: '🦔', category: 'muut',
        symmetric: false, attach: { bone: 'body', at: 'top' },
        bones: [
            pb('spike', [0, 0, 0], [
                pc('s1', [-0.5, 0, -4], [1, 3, 1], '#d8d0c0', [0, 0, -8]),
                pc('s2', [-0.5, 0, -1], [1, 3.5, 1], '#d8d0c0'),
                pc('s3', [-0.5, 0, 2], [1, 3, 1], '#d8d0c0', [0, 0, 8])
            ])
        ]
    },
    {
        id: 'ear', name: 'Korvat', emoji: '🐰', category: 'muut',
        symmetric: true, attach: { bone: 'head', at: 'top' },
        bones: [
            pb('ear', [0, 0, 0], [
                pc('ear', [0.5, 0, -0.5], [1.5, 2.5, 1], '#c68642', [0, 0, -10])
            ])
        ]
    }
];

export const PART_CATEGORIES = [
    { id: 'jalat', name: 'Jalat', emoji: '🦵' },
    { id: 'kädet', name: 'Kädet', emoji: '💪' },
    { id: 'päät', name: 'Päät & Kasvot', emoji: '🗿' },
    { id: 'hännät', name: 'Hännät', emoji: '🐍' },
    { id: 'siivet', name: 'Siivet & Evät', emoji: '🪽' },
    { id: 'muut', name: 'Muut', emoji: '✨' }
];

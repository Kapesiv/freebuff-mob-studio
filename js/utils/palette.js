/**
 * Väripaletit UV-editoria varten — Minecraft-tyyliset esiasetetut värit
 * (ihonsävyt, villa-värit, luonto) + käyttäjän omat värit (localStorage).
 */

export const PALETTE_CATEGORIES = [
    {
        id: 'skin',
        name: 'Ihonsävyt',
        colors: [
            '#FFF0E1', '#FFDDB8', '#F1C27D', '#E0AC69',
            '#C68642', '#A5662D', '#8D5524', '#6B4226',
            '#4A2F1D', '#2E1B10',
        ],
    },
    {
        id: 'wool',
        name: 'Villa',
        colors: [
            '#E9ECEC', '#F07613', '#BD44B3', '#3AAFD9',
            '#F8C627', '#70B919', '#ED8DAC', '#3E4447',
            '#8E8E86', '#158991', '#792AAC', '#35399D',
            '#724728', '#546D1B', '#A12722', '#141519',
        ],
    },
    {
        id: 'nature',
        name: 'Luonto',
        colors: [
            '#7CBD4B', '#3D8B37', '#2F6B2F', '#8B5A2B',
            '#6B4F2F', '#E8D9A0', '#7E7E7E', '#3F76E4',
            '#F9FAFE', '#E25822', '#E3DAC9', '#7A2A23',
            '#4E342E', '#A0D6E1', '#5D8C2B', '#C9A66B',
        ],
    },
];

const STORAGE_KEY = 'fms_custom_palette';

export function loadCustomColors() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return arr.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
    } catch {
        return [];
    }
}

export function saveCustomColors(colors) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
    } catch {
        // private mode / storage full — ignore
    }
}

/** Normalisoi värin hex-muotoon (#rrggbb, pienaakkoset) tai null. */
export function normalizeHex(v) {
    if (typeof v !== 'string') return null;
    const m = v.match(/^#?([0-9a-fA-F]{6})$/);
    return m ? '#' + m[1].toLowerCase() : null;
}

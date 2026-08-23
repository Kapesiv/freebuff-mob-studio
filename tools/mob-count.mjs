/**
 * Laskee mob-kirjaston mobien määrän ja kirjoittaa sen shields.io
 * -endpoint-formatissa badges/mobs.json-tiedostoon. GitHub Actions
 * -workflow (mob-count.yml) ajaa tämän joka kirjastopushilla ja
 * committaa tiedoston takaisin, jolloin README-badge pysyy ajan tasalla.
 *
 * Usage:
 *   node tools/mob-count.mjs          # kirjoittaa badges/mobs.json
 *   node tools/mob-count.mjs --check  # varmistaa että badge on ajan tasalla
 *                                     # (epäonnistuu jos kirjasto on muuttunut)
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { LIBRARY_MOBS } from '../js/mobs/library.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const badgeFile = path.join(root, 'badges', 'mobs.json');
const count = LIBRARY_MOBS.length;

if (process.argv.includes('--check')) {
    let current;
    try {
        current = JSON.parse(readFileSync(badgeFile, 'utf8')).message;
    } catch (e) {
        console.error(`✗ ${badgeFile} puuttuu tai on rikki — aja "node tools/mob-count.mjs"`);
        process.exit(1);
    }
    if (String(current) !== String(count)) {
        console.error(`✗ mobi-määrä-badge on vanhentunut: badge sanoo ${current}, kirjastossa on ${count}. Aja "node tools/mob-count.mjs" ja committaa badges/mobs.json.`);
        process.exit(1);
    }
    console.log(`✓ mobi-määrä-badge on ajan tasalla (${count} mobia)`);
    process.exit(0);
}

const badge = {
    schemaVersion: 1,
    label: 'mobit',
    message: String(count),
    color: 'blue'
};
writeFileSync(badgeFile, JSON.stringify(badge, null, 2) + '\n');
console.log(`mobit: ${count} → badges/mobs.json`);

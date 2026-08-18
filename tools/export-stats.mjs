#!/usr/bin/env node
// Extract per-mob stats from the Deep Void entity .class files (via the
// verified scan-attributes.py logic) and print a JS object for the library.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const out = execFileSync('python3', ['tools/scan-attributes.py'], { encoding: 'utf8' });
const lines = out.split('\n');
const classes = {};
for (const line of lines) {
  const m = line.match(/^(\S+)\s+\[(.*)\]$/);
  if (!m) continue;
  const entries = [];
  for (const part of m[2].match(/'f_222\d+_', [\d.]+\)/g) || []) {
    const mm = part.match(/'([^']+)', ([\d.]+)\)/);
    entries.push([mm[1], parseFloat(mm[2])]);
  }
  classes[m[1]] = entries;
}

const ATTR = {
  f_22279_: 'speed',
  f_22276_: 'health',
  f_22284_: 'armor',
  f_22281_: 'toughness',
  f_22277_: 'follow',
  f_22278_: 'knockback',
  f_22282_: 'damage',
  f_22280_: 'flySpeed',
};

const SPECIAL = {
  weaver_of_souls: 'WeaverOfSoulsBossEntity',
  stalker_new: 'WatchingStalkerEntity',
  apostle_of_catastrophe: 'ApostleBossEntity',
  eye_centipede: 'CentigazeEntity',
  cave_nightmare: 'GhostlyNightmareEntity',
  hunter: 'MaskedHunterEntity',
  gore_spitter: 'GoreExpectoratorEntity',
  harvestmen: 'GoreLurkerEntity',
  hivemind: 'MisanthropicHivemindEntity',
  void_fly_maggot: 'MaggotEntity',
  soulseeker: 'SeekerEntity',
  spitter_crawler: 'GooSpitterEntity',
  thumper: 'ThumperEntityEntity',
  tombstone: 'DoomingTombstoneEntity',
  void_fly: 'BlackFlyEntity',
  void_watcher: 'EyeOfTheWatcherEntity',
  chained_weaver: 'ChainedWeaverEntity',
};

function toClass(id) {
  if (SPECIAL[id]) return SPECIAL[id];
  return id.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join('') + 'Entity';
}

const src = readFileSync('js/mobs/deepvoid.js', 'utf8');
const ids = [...src.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]);
const unique = [...new Set(ids)];

const stats = {};
for (const id of unique) {
  const cls = toClass(id);
  const entries = classes[cls];
  if (!entries) {
    stats[id] = { cls, found: false };
    continue;
  }
  const s = { cls };
  for (const [ref, v] of entries) {
    const k = ATTR[ref];
    if (k) s[k] = v;
  }
  stats[id] = s;
}

// pretty print
console.log(JSON.stringify(stats, null, 1).replace(/"([a-zA-Z_]+)":/g, '$1:'));
console.error(`\n# mobs: ${unique.length}, found: ${Object.values(stats).filter((s) => s.found !== false).length}`);

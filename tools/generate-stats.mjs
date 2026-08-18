#!/usr/bin/env node
// Generate js/mobs/stats.js — faktapohjaiset statit Deep Void 1.98.1 -JARin
// bytecodesta (createAttributes + registerGoals + <init>-bossbar) ja
// lang-tiedoston rekisteri-id:istä. Ei arvauksia.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const scanOut = execFileSync('python3', ['tools/scan-attributes.py'], { encoding: 'utf8' });
const attrs = {};
for (const line of scanOut.split('\n')) {
  const m = line.match(/^(\S+)\s+\[(.*)\]$/);
  if (!m) continue;
  const pairs = {};
  for (const part of m[2].match(/'f_222\d+_', [\d.]+\)/g) || []) {
    const mm = part.match(/'([^']+)', ([\d.]+)\)/);
    pairs[mm[1]] = parseFloat(mm[2]);
  }
  attrs[m[1]] = pairs;
}

const factsOut = execFileSync('python3', ['tools/scan-entity-facts.py', 'run'], { encoding: 'utf8' });
const facts = {};
for (const block of factsOut.split('### ').slice(1)) {
  const [head, ...rest] = block.split('\n');
  const mobId = head.split(' ')[0];
  const jsonPart = rest.join('\n').trim();
  try {
    facts[mobId] = JSON.parse(jsonPart);
  } catch { facts[mobId] = {}; }
}

const ATTR = {
  f_22279_: 'speed', f_22276_: 'hp', f_22284_: 'armor', f_22281_: 'toughness',
  f_22277_: 'follow', f_22278_: 'knockback', f_22282_: 'damage', f_22280_: 'flySpeed',
};

// kirjasto-id -> { cls: entity-luokka, registry: rekisteri-id }
const SPECIAL = {
  weaver_of_souls: { cls: 'WeaverOfSoulsBossEntity', registry: 'weaver_of_souls_boss' },
  chained_weaver: { cls: 'ChainedWeaverEntity', registry: 'chained_weaver' },
  stalker_new: { cls: 'WatchingStalkerEntity', registry: 'watching_stalker' },
  apostle_of_catastrophe: { cls: 'ApostleBossEntity', registry: 'apostle_boss' },
  eye_centipede: { cls: 'CentigazeEntity', registry: 'centigaze' },
  cave_nightmare: { cls: 'GhostlyNightmareEntity', registry: 'ghostly_nightmare' },
  hunter: { cls: 'MaskedHunterEntity', registry: 'masked_hunter' },
  gore_spitter: { cls: 'GoreExpectoratorEntity', registry: 'gore_expectorator' },
  harvestmen: { cls: 'GoreLurkerEntity', registry: 'gore_lurker' },
  hivemind: { cls: 'MisanthropicHivemindEntity', registry: 'misanthropic_hivemind' },
  void_fly_maggot: { cls: 'MaggotEntity', registry: 'maggot' },
  soulseeker: { cls: 'SeekerEntity', registry: 'seeker' },
  spitter_crawler: { cls: 'GooSpitterEntity', registry: 'goo_spitter' },
  thumper: { cls: 'ThumperEntityEntity', registry: 'thumper_entity' },
  tombstone: { cls: 'DoomingTombstoneEntity', registry: 'dooming_tombstone' },
  void_fly: { cls: 'BlackFlyEntity', registry: 'black_fly' },
  void_watcher: { cls: 'EyeOfTheWatcherEntity', registry: 'eye_of_the_watcher' },
};

const SPECIAL_REGISTRY = Object.fromEntries(Object.entries(SPECIAL).map(([k, v]) => [k, v.registry]));

const GOAL_LABELS = {
  HurtByTargetGoal: 'Kostaa vahingon aiheuttajalle',
  NearestAttackableTargetGoal: 'Hyökkää lähimmän vihollisen kimppuun',
  RandomStrollGoal: 'Vaeltelee satunnaisesti',
  WaterAvoidingRandomStrollGoal: 'Vaeltelee (välttää vettä)',
  RandomLookAroundGoal: 'Katselee ympärilleen',
  FloatGoal: 'Kelluu veden pinnalla',
  LeapAtTargetGoal: 'Loikkaa kohti kohdetta',
  AvoidEntityGoal: 'Väistelee tiettyjä entiteettejä',
  OwnerHurtTargetGoal: 'Hyökkää omistajansa vihollisia vastaan',
  OwnerHurtByTargetGoal: 'Kostaa omistajalle tehdyn vahingon',
  LookAtPlayerGoal: 'Katsoo pelaajaa',
  RandomSwimmingGoal: 'Ui satunnaisesti',
  RemoveBlockGoal: 'Tuhoaa lohkoja',
  TemptGoal: 'Seuraa syöttiä',
  FollowMobGoal: 'Seuraa toista mobia',
  MeleeAttackGoal: 'Lähitaisteluhyökkäys',
  RangedAttackGoal: 'Etäisyyshyökkäys',
  PanicGoal: 'Panikoi ja pakenee',
  CrossbowAttackGoal: 'Jousipyssyllä ampuminen',
  RangedBowAttackGoal: 'Jousella ampuminen',
  BreakDoorGoal: 'Rikkoo ovia',
};

const src = readFileSync('js/mobs/deepvoid.js', 'utf8');
const ids = [...new Set([...src.matchAll(/"id": "([^"]+)"/g)].map((m) => m[1]))];

const stats = {};
for (const id of ids) {
  const clsName = SPECIAL[id] ? SPECIAL[id].cls
    : id.split('_').map((s) => s[0].toUpperCase() + s.slice(1)).join('') + 'Entity';
  const entry = attrs[clsName] || {};
  const f = facts[id] || {};
  const goals = (f.goals || []).map((g) => {
    const short = g.split('/').pop();
    return { id: short, label: GOAL_LABELS[short] || short };
  });
  stats[id] = {
    registry: SPECIAL_REGISTRY[id] || id,
    summon: `/summon the_deep_void:${SPECIAL_REGISTRY[id] || id}`,
    hp: entry.f_22276_ ?? null,
    armor: entry.f_22284_ ?? null,
    toughness: entry.f_22281_ ?? null,
    speed: entry.f_22279_ ?? null,
    follow: entry.f_22277_ ?? null,
    knockback: entry.f_22278_ ?? null,
    damage: entry.f_22282_ ?? null,
    flySpeed: entry.f_22280_ ?? null,
    bossbar: !!f.bossbar,
    goals,
  };
}

const header = `// Auto-generoitu: tools/generate-stats.mjs (Deep Void 1.98.1 -JARin bytecode +
// assets/the_deep_void/lang/en_us.json rekisteri-id:t). EI MUOKKAA KÄSIN.
// Päivitä komennolla: node tools/generate-stats.mjs

export const MOB_STATS = `;
writeFileSync('js/mobs/stats.js', header + JSON.stringify(stats, null, 1) + ';\n');
console.log('wrote js/mobs/stats.js —', Object.keys(stats).length, 'mobs');
const withHp = Object.values(stats).filter((s) => s.hp != null).length;
console.log('HP löytyi:', withHp, '/', Object.keys(stats).length);
console.log('bossbar:', Object.entries(stats).filter(([, s]) => s.bossbar).map(([k]) => k).join(', '));

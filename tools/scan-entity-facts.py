#!/usr/bin/env python3
"""Extract factual per-entity data from Deep Void .class files:
- goals (AI goal class names, from registerGoals bytecode)
- registry id / spawn egg RegistryObject name (from <init>/<clinit> getstatic refs)
- animation names (strings in movementPredicate/procedurePredicate)
- bosses: whether a BossEvent (ServerBossEvent) is constructed in <init>
"""
import sys, os, glob, struct, json, importlib.util

spec = importlib.util.spec_from_file_location('rms', os.path.join(os.path.dirname(__file__), 'read-mob-stats.py'))
rms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rms)

ENTITY_DIR = '/tmp/dv/entities'

def cname(cp, idx):
    if not idx or idx >= len(cp) or not cp[idx]:
        return None
    e = cp[idx]
    if e[0] == 'utf8':
        return e[1]
    if e[0] in (9, 10, 7):
        return cname(cp, e[1])
    if e[0] == 12:
        return cname(cp, e[1])
    return None

def method_body(c, name):
    for m in c['methods']:
        if m['name'] == name and m['code']:
            clen = rms.u4(m['code'], 4)
            return m['code'][8:8+clen]
    return None

def scan(path):
    c = rms.parse_class(path)
    if not c:
        return None
    cp = c['cp']
    out = {'goals': [], 'registry': [], 'animations': [], 'bossbar': False, 'summon_method': False}

    # <init>: look for BossEvent construction + registry getstatic (scan ALL <init>s)
    for m in c['methods']:
        if m['name'] != '<init>' or not m['code']:
            continue
        clen = rms.u4(m['code'], 4)
        body = m['code'][8:8+clen]
        for op, oper in (rms.walk_code(body) or []):
            if op == 0xbb:  # new
                cls = cname(cp, rms.u2(oper, 0))
                if cls and 'BossEvent' in cls:
                    out['bossbar'] = True
            if op == 0xb2:  # getstatic
                idx = rms.u2(oper, 0)
                if idx < len(cp) and cp[idx] and cp[idx][0] == 9:
                    nat = cp[idx][2]
                    if nat < len(cp) and cp[nat] and cp[nat][0] == 12:
                        name = cp[cp[nat][1]][1] if cp[nat][1] < len(cp) and cp[cp[nat][1]] else None
                        if name and name.isupper() and len(name) > 3 and '_' not in name and not name.startswith('DATA') and not name.startswith('SOUND') and not name.startswith('ANIM') and not name.startswith('TEXT'):
                            out['registry'].append(name)

    # goals: registerGoals (m_8099_) -> new class names ending in Goal
    for mname in ('m_8099_', 'registerGoals'):
        body = method_body(c, mname)
        if not body:
            continue
        for op, oper in (rms.walk_code(body) or []):
            if op == 0xbb:
                cls = cname(cp, rms.u2(oper, 0))
                if cls and ('Goal' in cls or 'Behaviour' in cls or 'Behavior' in cls):
                    if cls not in out['goals']:
                        out['goals'].append(cls.split('.')[-1].split('$')[0])

    # animations: strings in movementPredicate / procedurePredicate / registerControllers
    for mname in ('movementPredicate', 'procedurePredicate', 'registerControllers'):
        body = method_body(c, mname)
        if not body:
            continue
        for op, oper in (rms.walk_code(body) or []):
            if op in (0x12, 0x13):
                idx = oper[0] if op == 0x12 else rms.u2(oper, 0)
                s = None
                if idx < len(cp) and cp[idx]:
                    e = cp[idx]
                    if e[0] == 8:  # String -> points to utf8
                        vi = e[1]
                        if vi < len(cp) and cp[vi] and cp[vi][0] == 'utf8':
                            s = cp[vi][1]
                    elif e[0] == 'utf8':
                        s = e[1]
                if s and s.isidentifier() and len(s) > 1 and not s[0].isupper() and 'Minecraft' not in s:
                    if s not in out['animations']:
                        out['animations'].append(s)

    # summon: check if class references SpawnEggItem or a summoning procedure
    return out

def main():
    ids = None
    if len(sys.argv) > 1:
        import re
        src = open(os.path.join(os.path.dirname(__file__), '..', 'js', 'mobs', 'deepvoid.js')).read()
        ids = re.findall(r'"id": "([^"]+)"', src)
        SPECIAL = {
            'weaver_of_souls': 'WeaverOfSoulsBossEntity', 'stalker_new': 'WatchingStalkerEntity',
            'apostle_of_catastrophe': 'ApostleBossEntity', 'eye_centipede': 'CentigazeEntity',
            'cave_nightmare': 'GhostlyNightmareEntity', 'hunter': 'MaskedHunterEntity',
            'gore_spitter': 'GoreExpectoratorEntity', 'harvestmen': 'GoreLurkerEntity',
            'hivemind': 'MisanthropicHivemindEntity', 'void_fly_maggot': 'MaggotEntity',
            'soulseeker': 'SeekerEntity', 'spitter_crawler': 'GooSpitterEntity',
            'thumper': 'ThumperEntityEntity', 'tombstone': 'DoomingTombstoneEntity',
            'void_fly': 'BlackFlyEntity', 'void_watcher': 'EyeOfTheWatcherEntity',
            'chained_weaver': 'ChainedWeaverEntity',
        }
        to_class = lambda i: SPECIAL.get(i, ''.join(s.capitalize() for s in i.split('_')) + 'Entity')
        targets = {to_class(i): i for i in ids}
        for path in sorted(glob.glob(os.path.join(ENTITY_DIR, '*.class'))):
            cls = os.path.basename(path)[:-6]
            if cls not in targets:
                continue
            mob = targets[cls]
            d = scan(path)
            print(f"### {mob} ({cls})")
            if d:
                print(json.dumps(d))
            else:
                print("(no data)")
    else:
        # all entity classes, just goals+bossbar
        for path in sorted(glob.glob(os.path.join(ENTITY_DIR, '*.class'))):
            cls = os.path.basename(path)[:-6]
            if '$' in cls:
                continue
            d = scan(path)
            if d and (d['goals'] or d['bossbar']):
                print(f"{cls:45s} bossbar={d['bossbar']} goals={d['goals'][:6]}")

if __name__ == '__main__':
    main()

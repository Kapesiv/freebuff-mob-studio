#!/usr/bin/env python3
"""Parse Deep Void entity .class files without a JVM and extract MAX_HEALTH.

Strategy (anchored, not heuristic): find the constant-pool index of the
"MAX_HEALTH" attribute name, then all Fieldrefs whose NameAndType points to
it. In each method's bytecode, whenever a `getstatic` loads one of those
fieldrefs (the attribute holder), the NEXT pushed constant (ldc/ldc_w/ldc2_w/
bipush/sipush/iconst) is the health value passed to `add(...)`.

Fallback: the largest plausible float/int constant inside `createAttributes`
or `<init>` (covers setBaseValue-style code and older MCreator templates).

Special class mappings (registry ids verified from the classes themselves):
   weaver_of_souls    -> WeaverOfSoulsBossEntity   (fallenweaver)
   stalker_new        -> WatchingStalkerEntity     (stalkernew)
   apostle_of_catastrophe -> ApostleBossEntity     (apostleofcatastrophe)
   eye_centipede      -> CentigazeEntity           (centigaze)
   cave_nightmare     -> GhostlyNightmareEntity
   hunter             -> MaskedHunterEntity
   gore_spitter       -> GoreExpectoratorEntity    (gore_spitter)
   harvestmen         -> GoreLurkerEntity          (harvestmen)
   hivemind           -> MisanthropicHivemindEntity
   void_fly_maggot    -> MaggotEntity              (void_fly_maggot)
   soulseeker         -> SeekerEntity              (seeker)
   spitter_crawler    -> GooSpitterEntity
   thumper            -> ThumperEntityEntity
   tombstone          -> DoomingTombstoneEntity
   void_fly           -> BlackFlyEntity
   void_watcher       -> EyeOfTheWatcherEntity
   bringer_of_despair -> (ei entity-luokkaa tässä versiossa — ei dataa)
"""
import struct, sys, glob, os, json

ENTITY_DIR = sys.argv[1] if len(sys.argv) > 1 else '/tmp/dv/entities'

SPECIAL = {
    'weaver_of_souls': 'WeaverOfSoulsBossEntity',
    'stalker_new': 'WatchingStalkerEntity',
    'apostle_of_catastrophe': 'ApostleBossEntity',
    'eye_centipede': 'CentigazeEntity',
    'cave_nightmare': 'GhostlyNightmareEntity',
    'hunter': 'MaskedHunterEntity',
    'gore_spitter': 'GoreExpectoratorEntity',
    'harvestmen': 'GoreLurkerEntity',
    'hivemind': 'MisanthropicHivemindEntity',
    'void_fly_maggot': 'MaggotEntity',
    'soulseeker': 'SeekerEntity',
    'spitter_crawler': 'GooSpitterEntity',
    'thumper': 'ThumperEntityEntity',
    'tombstone': 'DoomingTombstoneEntity',
    'void_fly': 'BlackFlyEntity',
    'void_watcher': 'EyeOfTheWatcherEntity',
}

def u1(b, o): return b[o]
def u2(b, o): return struct.unpack('>H', b[o:o+2])[0]
def u4(b, o): return struct.unpack('>I', b[o:o+4])[0]
def s8(b, o): return struct.unpack('>q', b[o:o+8])[0]
def f4(b, o): return struct.unpack('>f', b[o:o+4])[0]
def d8(b, o): return struct.unpack('>d', b[o:o+8])[0]

def parse_class(path):
    b = open(path, 'rb').read()
    if b[:4] != b'\xca\xfe\xba\xbe':
        return None
    o = 8
    cp_count = u2(b, o); o += 2
    cp = [None] * cp_count
    i = 1
    while i < cp_count:
        tag = b[o]; o += 1
        if tag == 1:
            ln = u2(b, o); o += 2
            cp[i] = ('utf8', b[o:o+ln].decode('utf-8', 'replace')); o += ln
        elif tag == 3:
            cp[i] = ('int', struct.unpack('>i', b[o:o+4])[0]); o += 4
        elif tag == 4:
            cp[i] = ('float', struct.unpack('>f', b[o:o+4])[0]); o += 4
        elif tag == 5:
            cp[i] = ('long', s8(b, o)); o += 8; i += 1
        elif tag == 6:
            cp[i] = ('double', d8(b, o)); o += 8; i += 1
        elif tag in (7, 8, 16, 19, 20):
            cp[i] = (tag, u2(b, o)); o += 2
        elif tag in (9, 10, 11, 12, 18):
            cp[i] = (tag, u2(b, o), u2(b, o+2)); o += 4
        elif tag == 15:
            cp[i] = (15, b[o], u2(b, o+1)); o += 3
        elif tag == 17:
            cp[i] = (17, u2(b, o), u2(b, o+2)); o += 4
        else:
            return None
        i += 1
    o += 2  # access
    o += 2  # this
    o += 2  # super
    ic = u2(b, o); o += 2
    o += ic * 2
    fc = u2(b, o); o += 2
    for _ in range(fc):
        o += 6
        ac = u2(b, o); o += 2
        for _ in range(ac):
            o += 2
            ln = u4(b, o); o += 4 + ln
    mc = u2(b, o); o += 2
    methods = []
    for _ in range(mc):
        o += 2
        mname = cp[u2(b, o)][1]; o += 2
        mdesc = cp[u2(b, o)][1]; o += 2
        ac = u2(b, o); o += 2
        code = None
        for _ in range(ac):
            aname = cp[u2(b, o)][1]; o += 2
            aln = u4(b, o); o += 4
            adata = b[o:o+aln]; o += aln
            if aname == 'Code':
                code = adata
        methods.append({'name': mname, 'desc': mdesc, 'code': code})
    return {'cp': cp, 'methods': methods}

SIZES = {}
for i in list(range(0x01, 0x0d)) + list(range(0x0e, 0x16)): SIZES[i] = 1
SIZES[0x10] = 2   # bipush
SIZES[0x11] = 3   # sipush
SIZES[0x12] = 2   # ldc
SIZES[0x13] = 3   # ldc_w
SIZES[0x14] = 3   # ldc2_w
for i in range(0x15, 0x36): SIZES[i] = 1          # loads
for i in range(0x36, 0x56): SIZES[i] = 1          # stores
for i in range(0x56, 0x84): SIZES[i] = 1          # stack/arith
SIZES[0x84] = 3   # iinc
for i in range(0x85, 0x94): SIZES[i] = 1
for i in range(0x99, 0xaa): SIZES[i] = 3          # branches
SIZES[0xaa] = 0   # tableswitch
SIZES[0xab] = 0   # lookupswitch
for i in (0xac, 0xad, 0xae, 0xaf, 0xb0, 0xb1): SIZES[i] = 1
for i in (0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xbb, 0xbd, 0xbf,
          0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc7, 0xc8): SIZES[i] = 3
SIZES[0xba] = 5   # invokedynamic
SIZES[0xbc] = 2   # newarray
SIZES[0xc5] = 4   # multianewarray
SIZES[0xc6] = 3   # checkcast
SIZES[0xc9] = 3   # ifnull
for i in (0xca, 0xfe, 0xff): SIZES[i] = 1

def walk_code(body):
    i = 0
    n = len(body)
    while i < n:
        op = body[i]
        size = SIZES.get(op)
        if size is None:
            return None
        if op == 0xaa:
            j = i + 1
            while j % 4 != 0: j += 1
            size = 1 + (j - i - 1) + 12 + 4 * u4(body, j + 8)
        elif op == 0xab:
            j = i + 1
            while j % 4 != 0: j += 1
            size = 1 + (j - i - 1) + 8 + 8 * u4(body, j + 4)
        if i + size > n:
            return None
        yield (op, body[i+1:i+size])
        i += size

def utf8_of(cp, idx):
    if idx and idx < len(cp) and cp[idx]:
        e = cp[idx]
        return e[1] if e[0] == 1 else None
    return None

def find_health(path):
    c = parse_class(path)
    if not c:
        return None
    cp = c['cp']
    maxh = next((i for i, e in enumerate(cp) if e and e[0] == 1 and e[1] == 'MAX_HEALTH'), None)
    if maxh is None:
        return None
    frefs = set()
    for i, e in enumerate(cp):
        if e and e[0] == 9 and e[2] < len(cp):
            nt = cp[e[2]]
            if nt and nt[0] == 12 and nt[1] == maxh:
                frefs.add(i)

    def pushed_value(op, oper):
        if op in (0x12, 0x13):  # ldc / ldc_w
            idx = oper[0] if op == 0x12 else u2(oper, 0)
            if idx < len(cp) and cp[idx] and cp[idx][0] == 'float':
                return cp[idx][1]
        elif op == 0x14:  # ldc2_w (double)
            idx = u2(oper, 0)
            if idx < len(cp) and cp[idx] and cp[idx][0] == 'double':
                return cp[idx][1]
        elif op == 0x10:  # bipush
            return struct.unpack('>b', oper[:1])[0]
        elif op == 0x11:  # sipush
            return struct.unpack('>h', oper[:2])[0]
        elif 0x02 <= op <= 0x08:  # iconst_m1..iconst_5
            return op - 0x03
        return None

    plausible = lambda v: v is not None and 1 < v < 100000
    found = None
    for m in c['methods']:
        code = m['code']
        if not code:
            continue
        clen = u4(code, 4)
        body = code[8:8+clen]
        pending = False
        for op, oper in (walk_code(body) or []):
            if op == 0xb2:  # getstatic
                idx = u2(oper, 0)
                if idx in frefs:
                    pending = True
                    continue
                pending = False
            elif pending:
                v = pushed_value(op, oper)
                if v is not None:
                    if plausible(v):
                        found = (v, m['name'])
                    break
                pending = False
    if found:
        return found
    # fallback: max plausible constant in createAttributes / <init>
    best = None
    for m in c['methods']:
        if m['name'] not in ('createAttributes', '<init>'):
            continue
        code = m['code']
        if not code:
            continue
        clen = u4(code, 4)
        body = code[8:8+clen]
        for op, oper in (walk_code(body) or []):
            v = pushed_value(op, oper)
            if plausible(v) and (best is None or v > best):
                best = v
    if best:
        return (best, 'createAttributes/<init>')
    return None

def to_class(mob_id):
    if mob_id in SPECIAL:
        return SPECIAL[mob_id]
    return ''.join(s.capitalize() for s in mob_id.split('_')) + 'Entity'

def main():
    # read the 72 mob ids from js/mobs/deepvoid.js
    src = open(os.path.join(os.path.dirname(__file__), '..', 'js', 'mobs', 'deepvoid.js')).read()
    import re
    ids = re.findall(r'"id": "([^"]+)"', src)
    out = {}
    for mob_id in ids:
        cls = to_class(mob_id)
        path = os.path.join(ENTITY_DIR, cls + '.class')
        if not os.path.exists(path):
            out[mob_id] = {'class': cls, 'health': None, 'why': 'no class'}
            continue
        h = find_health(path)
        if h:
            out[mob_id] = {'class': cls, 'health': h[0], 'method': h[1]}
        else:
            out[mob_id] = {'class': cls, 'health': None, 'why': 'no MAX_HEALTH constant found'}
    print(json.dumps(out, indent=0, sort_keys=True))

if __name__ == '__main__':
    main()

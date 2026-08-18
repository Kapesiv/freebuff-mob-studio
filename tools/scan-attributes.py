#!/usr/bin/env python3
"""Bulk-parse `createAttributes` from every Deep Void entity .class file.

MCreator generates the SAME attribute order in every entity's
createAttributes(), so the value distribution per slot identifies which
attribute each slot holds (MAX_HEALTH spans a huge range, MOVEMENT_SPEED
clusters ~0.1-0.5, KNOCKBACK_RESISTANCE is 0 or 999 for bosses, ...).
"""
import sys, os, glob, struct, json, importlib.util

spec = importlib.util.spec_from_file_location('rms', os.path.join(os.path.dirname(__file__), 'read-mob-stats.py'))
rms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rms)

ENTITY_DIR = '/tmp/dv/entities'

def push_val(op, oper, cp):
    """Return the numeric constant pushed by op, or None."""
    if op in (0x12, 0x13):  # ldc / ldc_w
        idx = oper[0] if op == 0x12 else rms.u2(oper, 0)
        if idx < len(cp) and cp[idx] and cp[idx][0] == 'float':
            return cp[idx][1]
        if idx < len(cp) and cp[idx] and cp[idx][0] == 'int':
            return float(cp[idx][1])
    elif op == 0x14:  # ldc2_w double
        idx = rms.u2(oper, 0)
        if idx < len(cp) and cp[idx] and cp[idx][0] == 'double':
            return cp[idx][1]
    elif op == 0x10:  # bipush
        return float(struct.unpack('>b', oper[:1])[0])
    elif op == 0x11:  # sipush
        return float(struct.unpack('>h', oper[:2])[0])
    elif op == 0x0e:  # dconst_0
        return 0.0
    elif op == 0x0f:  # dconst_1
        return 1.0
    elif 0x02 <= op <= 0x08:  # iconst_m1..5
        return float(op - 0x03)
    return None

def parse_attributes(path):
    c = rms.parse_class(path)
    if not c:
        return None
    cp = c['cp']
    for m in c['methods']:
        if m['name'] != 'createAttributes':
            continue
        code = m['code']
        if not code:
            continue
        clen = rms.u4(code, 4)
        body = code[8:8+clen]
        entries = []
        for op, oper in (rms.walk_code(body) or []):
            if op == 0xb2:  # getstatic
                # remember which attribute holder is on the stack
                entries.append({'ref': rms.u2(oper, 0), 'val': None})
            else:
                v = push_val(op, oper, cp)
                if v is not None and entries and entries[-1]['val'] is None:
                    entries[-1]['val'] = v
        # resolve the ref name (the obfuscated field name like f_22276_)
        out = []
        for e in entries:
            idx = e['ref']
            name = None
            if idx < len(cp) and cp[idx] and cp[idx][0] == 9:
                nt = cp[idx][2]
                if nt < len(cp) and cp[nt] and cp[nt][0] == 12:
                    name = cp[cp[nt][1]][1] if cp[nt][1] < len(cp) and cp[cp[nt][1]] else None
            out.append((name, e['val']))
        return out
    return None

def main():
    classes = {}
    for path in sorted(glob.glob(os.path.join(ENTITY_DIR, '*.class'))):
        cls = os.path.basename(path)[:-6]
        if cls.endswith('$') or '$' in cls:
            continue
        attrs = parse_attributes(path)
        if attrs:
            classes[cls] = attrs
    # print all
    for cls in sorted(classes):
        print(f"{cls:40s} {classes[cls]}")
    print()
    print(f"=== {len(classes)} entity classes with createAttributes ===")

    # per-slot distribution
    n = max(len(v) for v in classes.values())
    for slot in range(n):
        vals = [v[slot][1] for v in classes.values() if len(v) > slot and v[slot][1] is not None]
        names = sorted(set(v[slot][0] for v in classes.values() if len(v) > slot))
        print(f"\nslot {slot}: refs={names}")
        print(f"  vals: {sorted(set(round(x,3) for x in vals))}")

if __name__ == '__main__':
    main()

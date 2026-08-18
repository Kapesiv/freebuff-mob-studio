#!/usr/bin/env python3
"""Parse Deep Void entity .class files without a JVM.

Walks the constant pool and each method's Code attribute, finds the
byte sequence: ldc <float> ; invokestatic/invokespecial ...add(...MAX_HEALTH)
and reports the numeric health. Falls back to any float constant in a
method whose constant pool mentions MAX_HEALTH.
"""
import struct, sys, glob, os, json

def u1(b, o): return b[o]
def u2(b, o): return struct.unpack('>H', b[o:o+2])[0]
def u4(b, o): return struct.unpack('>I', b[o:o+4])[0]
def s8(b, o): return struct.unpack('>d', b[o:o+8])[0]
def f4(b, o): return struct.unpack('>f', b[o:o+4])[0]

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
        if tag == 1:  # Utf8
            ln = u2(b, o); o += 2
            cp[i] = ('utf8', b[o:o+ln].decode('utf-8', 'replace')); o += ln
        elif tag == 3:  # Integer
            cp[i] = ('int', struct.unpack('>i', b[o:o+4])[0]); o += 4
        elif tag == 4:  # Float
            cp[i] = ('float', struct.unpack('>f', b[o:o+4])[0]); o += 4
        elif tag == 5:  # Long (takes 2 slots)
            cp[i] = ('long', struct.unpack('>q', b[o:o+8])[0]); o += 8; i += 1
        elif tag == 6:  # Double (takes 2 slots)
            cp[i] = ('double', struct.unpack('>d', b[o:o+8])[0]); o += 8; i += 1
        elif tag in (7, 8, 16, 19, 20):  # Class / String / MethodType / Module / Package
            cp[i] = (tag, u2(b, o)); o += 2
        elif tag in (9, 10, 11, 12, 18):  # refs / NameAndType / InvokeDynamic
            cp[i] = (tag, u2(b, o), u2(b, o+2)); o += 4
        elif tag == 15:  # MethodHandle
            cp[i] = (15, b[o], u2(b, o+1)); o += 3
        elif tag == 17:  # Dynamic
            cp[i] = (17, u2(b, o), u2(b, o+2)); o += 4
        else:
            return None
        i += 1
    access = u2(b, o); o += 2
    this = u2(b, o); o += 2
    superc = u2(b, o); o += 2
    ic = u2(b, o); o += 2  # interfaces_count
    o += ic * 2
    fc = u2(b, o); o += 2
    for _ in range(fc):
        o += 6  # access, name, desc
        ac = u2(b, o); o += 2
        for _ in range(ac):
            o += 2  # attribute name index
            ln = u4(b, o); o += 4 + ln
    mc = u2(b, o); o += 2
    methods = []
    for _ in range(mc):
        o += 2  # access
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
    return {'cp': cp, 'this': this, 'superc': superc, 'methods': methods}

def utf8_of(cp, idx):
    if idx and idx < len(cp) and cp[idx]:
        e = cp[idx]
        return e[1] if e[0] == 1 else None
    return None

def name_of_ref(cp, idx):
    if idx and idx < len(cp) and cp[idx]:
        e = cp[idx]
        if e[0] in (9, 10, 11):
            nt = cp[e[2]]
            if nt and nt[0] == 12:
                return utf8_of(cp, nt[1])
    return None

# JVM opcode -> instruction size (0 = variable)
SIZES = {}
def _t():
    for i in range(0x01, 0x0d): SIZES[i] = 1          # const pushes
    for i in range(0x0e, 0x16): SIZES[i] = 1          # const pushes
    for i in (0x10,): SIZES[i] = 2                     # bipush
    for i in (0x11,): SIZES[i] = 3                     # sipush
    for i in (0x12,): SIZES[i] = 2                     # ldc
    for i in (0x13, 0x14): SIZES[i] = 3                # ldc_w / ldc2_w
    for i in (0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
              0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29,
              0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33,
              0x34, 0x35): SIZES[i] = 1               # loads
    for i in (0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
              0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
              0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52, 0x53,
              0x54, 0x55): SIZES[i] = 1               # stores
    for i in (0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f,
              0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
              0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73,
              0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d,
              0x7e, 0x7f, 0x80, 0x81, 0x82, 0x83): SIZES[i] = 1  # stack/arith
    for i in (0x84,): SIZES[i] = 3                     # iinc
    for i in (0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e,
              0x8f, 0x90, 0x91, 0x92, 0x93): SIZES[i] = 1
    for i in (0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f, 0xa0, 0xa1, 0xa2,
              0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9): SIZES[i] = 3  # branches
    for i in (0xaa,): SIZES[i] = 0                     # tableswitch
    for i in (0xab,): SIZES[i] = 0                     # lookupswitch
    for i in (0xac, 0xad, 0xae, 0xaf, 0xb0, 0xb1): SIZES[i] = 1
    for i in (0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xbb, 0xbd,
              0xbf, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc7, 0xc8): SIZES[i] = 3
    for i in (0xba,): SIZES[i] = 5                     # invokedynamic
    for i in (0xbc,): SIZES[i] = 2                     # newarray
    for i in (0xc5,): SIZES[i] = 4                     # multianewarray
    for i in (0xc6, 0xc9): SIZES[i] = 3                # checkcast / ifnull
    for i in (0xca, 0xfe, 0xff): SIZES[i] = 1
_t()

def walk_code(body, cp):
    """Yield (opcode, operands) with correct lengths. Returns None on misalignment."""
    i = 0
    n = len(body)
    while i < n:
        op = body[i]
        size = SIZES.get(op)
        if size is None:
            return None
        if op == 0xaa:  # tableswitch: pad to 4-byte boundary
            j = i + 1
            while j % 4 != 0: j += 1
            size = 1 + (j - i - 1) + 12 + 4 * u4(body, j + 8)
        elif op == 0xab:  # lookupswitch
            j = i + 1
            while j % 4 != 0: j += 1
            size = 1 + (j - i - 1) + 8 + 8 * u4(body, j + 4)
        if i + size > n:
            return None
        yield (op, body[i+1:i+size])
        i += size

def find_health(path):
    c = parse_class(path)
    if not c:
        return None
    cp = c['cp']
    maxh_idx = None
    for i, e in enumerate(cp):
        if e and e[0] == 1 and e[1] == 'MAX_HEALTH':
            maxh_idx = i
            break
    results = []
    for m in c['methods']:
        code = m['code']
        if not code:
            continue
        clen = u4(code, 4)
        body = code[8:8+clen]
        for op, oper in walk_code(body, cp) or []:
            if op in (0x12, 0x13):  # ldc / ldc_w
                idx = oper[0] if op == 0x12 else u2(oper, 0)
                if idx < len(cp) and cp[idx] and cp[idx][0] == 4:
                    results.append((m['name'], cp[idx][1]))
            elif op == 0x14:  # ldc2_w
                idx = u2(oper, 0)
                if idx < len(cp) and cp[idx] and cp[idx][0] in (5, 6):
                    results.append((m['name'], cp[idx][1]))
    if not results:
        return None
    health = None
    for mname, val in results:
        if mname in ('createAttributes', '<init>') and 1 < val < 100000:
            health = val
            break
    if health is None:
        floats = [v for _, v in results if isinstance(v, (int, float)) and 1 < v < 100000]
        if floats:
            health = max(floats)
    return health

if __name__ == '__main__':
    out = {}
    for path in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else 'entities/*.class')):
        name = os.path.basename(path).replace('.class', '')
        h = find_health(path)
        out[name] = h
    print(json.dumps(out, indent=1, sort_keys=True))

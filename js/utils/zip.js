/**
 * Minimaalinen ZIP-arkiston kirjoittaja (STORE-metodi, ei pakkausta).
 * Toimii selaimessa ja Node:ssa — riittää resurssipaketin lataamiseen.
 *
 * @param files [{ path: string, data: Uint8Array }]
 * @returns Uint8Array (valmis .zip-tiedosto)
 */

function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let k = 0; k < 8; k++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function zipFiles(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
        const nameBytes = encoder.encode(f.path);
        const data = f.data;
        const crc = crc32(data);

        // Local file header
        const local = new Uint8Array(30 + nameBytes.length);
        const dv = new DataView(local.buffer);
        dv.setUint32(0, 0x04034b50, true); // PK\x03\x04
        dv.setUint16(4, 20, true);          // version needed
        dv.setUint16(6, 0x0800, true);      // UTF-8 -nimet
        dv.setUint16(8, 0, true);           // STORE
        dv.setUint16(10, dosTime, true);
        dv.setUint16(12, dosDate, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, data.length, true);
        dv.setUint32(22, data.length, true);
        dv.setUint16(26, nameBytes.length, true);
        dv.setUint16(28, 0, true);          // extra
        local.set(nameBytes, 30);

        chunks.push(local, data);
        central.push({ nameBytes, crc, size: data.length, offset });
        offset += local.length + data.length;
    }

    // Central directory
    const centralStart = offset;
    for (const c of central) {
        const rec = new Uint8Array(46 + c.nameBytes.length);
        const dv = new DataView(rec.buffer);
        dv.setUint32(0, 0x02014b50, true); // PK\x01\x02
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 20, true);
        dv.setUint16(8, 0x0800, true);
        dv.setUint16(10, 0, true);          // STORE
        dv.setUint16(12, dosTime, true);
        dv.setUint16(14, dosDate, true);
        dv.setUint32(16, c.crc, true);
        dv.setUint32(20, c.size, true);
        dv.setUint32(24, c.size, true);
        dv.setUint16(28, c.nameBytes.length, true);
        dv.setUint16(30, 0, true);
        dv.setUint16(32, 0, true);
        dv.setUint16(34, 0, true);
        dv.setUint16(36, 0, true);
        dv.setUint32(38, 0, true);
        dv.setUint32(42, c.offset, true);
        rec.set(c.nameBytes, 46);
        chunks.push(rec);
        offset += rec.length;
    }

    // End of central directory
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true); // PK\x05\x06
    dv.setUint16(4, 0, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, central.length, true);
    dv.setUint16(10, central.length, true);
    dv.setUint32(12, offset - centralStart, true);
    dv.setUint32(16, centralStart, true);
    dv.setUint16(20, 0, true);
    chunks.push(eocd);

    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
        out.set(c, p);
        p += c.length;
    }
    return out;
}

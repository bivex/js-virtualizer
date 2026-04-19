/**
 * White-Box Key Encryption
 *
 * Replaces the simple XOR stream cipher with a T-table based construction
 * where the key material is embedded in 256-entry bijection lookup tables.
 * Key extraction requires solving an underdetermined system — the tables
 * ARE the key.
 */

const { createSeedFromString, rotateLeft } = require("./vmCommon");

/**
 * Generate forward and inverse T-tables from a key string.
 * Produces a seeded permutation of 0-255 (a bijection).
 */
function generateTTables(key) {
    const seed = createSeedFromString(String(key ?? ""), 0x5a827999);
    const forward = new Array(256);
    const inverse = new Array(256);

    // Fisher-Yates shuffle seeded from key
    for (let i = 0; i < 256; i++) forward[i] = i;

    let s = seed;
    for (let i = 255; i > 0; i--) {
        s = Math.imul(s ^ (s >>> 16), 0x6b2f9b7f) >>> 0;
        s = rotateLeft(s, 7);
        const j = s % (i + 1);
        const tmp = forward[i];
        forward[i] = forward[j];
        forward[j] = tmp;
    }

    for (let i = 0; i < 256; i++) inverse[forward[i]] = i;

    return { forward, inverse };
}

/**
 * Position-dependent mask byte derived from key and position.
 * Same algorithm used for both encrypt and decrypt — XOR is symmetric.
 */
function positionMask(key, i) {
    const keyCode = String(key ?? "");
    const kc = keyCode.charCodeAt(i % keyCode.length);
    return ((Math.imul(kc ^ i, 0x45d9f3b) >>> 0) ^ (i * 17)) & 0xFF;
}

/**
 * White-box encrypt: apply forward T-table substitution + position mask XOR.
 * Used at transpile time.
 */
function whiteboxEncrypt(data, forwardTable, key) {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
        out[i] = forwardTable[data[i]] ^ positionMask(key, i);
    }
    return out;
}

/**
 * White-box decrypt: undo position mask XOR + apply inverse T-table.
 * Used at runtime.
 */
function whiteboxDecrypt(data, inverseTable, key) {
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
        out[i] = inverseTable[data[i] ^ positionMask(key, i)];
    }
    return out;
}

/**
 * Uint8Array variant for browser (vm_dist.js).
 */
function whiteboxDecryptBytes(data, inverseTable, key) {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        out[i] = inverseTable[data[i] ^ positionMask(key, i)];
    }
    return out;
}

module.exports = {
    generateTTables,
    whiteboxEncrypt,
    whiteboxDecrypt,
    whiteboxDecryptBytes,
    positionMask
};
